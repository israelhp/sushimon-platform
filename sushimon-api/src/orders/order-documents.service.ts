import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { BranchOffersService } from '../branch-products/branch-offers.service.js';
import {
  BRANCH_AVAILABILITY_PORT,
  type BranchAvailabilityPort,
} from '../branch-schedule/branch-availability.port.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import type { DbGate } from '../common/concurrency/db-gate.js';
import { ModifierSelectionService } from '../modifiers/modifier-selection.service.js';
import { ProductsQueryService } from '../products/products-query.service.js';
import { adminBranchNotFound } from './admin/order-admin-errors.js';
import { displayNumberOf } from './order-mapper.js';
import { authorizedRead, guestHashOf, orderNotFound, runOrdersRead } from './order-read-access.js';
import { OrderSourceRepository, type OrderSource } from './order-source.repository.js';
import { ORDERS_DB_GATE } from './orders-errors.js';
import type { OrderReceiptDto } from './receipt/dto/order-receipt.dto.js';
import { toOrderReceipt } from './receipt/order-receipt.mapper.js';
import type {
  OrderReorderPreviewDto,
  OrderReorderRequestDto,
} from './reorder/dto/order-reorder.dto.js';
import { diagnoseReorder, type ReorderCatalog } from './reorder/order-reorder.diagnose.js';

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

/**
 * Recibo NO fiscal y vista previa de «Volver a pedir» (F23, spec 024, ADR-0029). SOLO lectura: ninguna operación escribe, exige
 * `Idempotency-Key`, cotiza ni llama a PedidosYa/Neonet. Autorización IDÉNTICA a `getOrder` (token de invitado y luego dueño
 * por JWT, ambos EN la consulta; todo lo demás => el mismo 404). Una sola adquisición del gate por solicitud (con admisión de
 * lectura). Logs sin PII (`orderId`, estado y conteos).
 */
@Injectable()
export class OrderDocumentsService {
  private readonly logger = new Logger(OrderDocumentsService.name);

  constructor(
    @Inject(OrderSourceRepository) private readonly repo: OrderSourceRepository,
    @Inject(BranchOffersService) private readonly offers: BranchOffersService,
    @Inject(ModifierSelectionService) private readonly modifiers: ModifierSelectionService,
    @Inject(ProductsQueryService) private readonly products: ProductsQueryService,
    @Inject(BRANCH_AVAILABILITY_PORT) private readonly availability: BranchAvailabilityPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  /** `GET /v1/orders/{id}/receipt`: 1 sentencia por intento de autorización (token, dueño). */
  async receipt(
    principal: Principal | undefined,
    id: string,
    rawToken: string | undefined,
  ): Promise<OrderReceiptDto> {
    const hash = guestHashOf(rawToken);
    const now = this.clock.now();
    const source = await runOrdersRead(this.gate, () => this.authorize(principal, id, hash, now));
    if (!source) throw orderNotFound();
    this.logger.debug(`order.receipt orderId=${source.id} status=${source.status}`);
    return toOrderReceipt(source, now);
  }

  /** `POST /v1/orders/{id}/reorder-preview`: presupuesto <= 8 sentencias, independiente del número de líneas. */
  async previewReorder(
    principal: Principal | undefined,
    id: string,
    rawToken: string | undefined,
    body: OrderReorderRequestDto | undefined,
  ): Promise<OrderReorderPreviewDto> {
    const hash = guestHashOf(rawToken);
    const now = this.clock.now();
    const preview = await runOrdersRead(this.gate, async () => {
      const source = await this.authorize(principal, id, hash, now);
      if (!source) return null;
      // `BRANCH_NOT_FOUND` SOLO tras autorizar el pedido: no sirve para sondear pedidos.
      return this.build(source, body?.branchId ?? source.branchId, now);
    });
    if (!preview) throw orderNotFound();
    this.logger.debug(
      `order.reorder lines=${preview.summary.lines} available=${preview.summary.available}`,
    );
    return preview;
  }

  private authorize(
    principal: Principal | undefined,
    id: string,
    hash: Buffer | undefined,
    now: Date,
  ): Promise<OrderSource | null> {
    return authorizedRead<OrderSource>(principal, hash, now, {
      byToken: (h, at) => this.repo.findForGuestToken(id, h, at),
      byOwner: (authUserId) => this.repo.findForOwner(id, authUserId),
    });
  }

  /**
   * Una sola adquisición del gate, en TRES pasos con como mucho 3 conexiones simultáneas cada uno:
   * 1) disponibilidad de la sucursal pedida (1) y, solo si es distinta a la del pedido, su nombre (1);
   * 2) SOLO con la sucursal activa: `inspect` (2 en paralelo) y ofertas de modificadores (1);
   * 3) presentación de los productos ordenables (2 en paralelo).
   * Una sucursal DISTINTA inexistente o inactiva => el mismo 404 `BRANCH_NOT_FOUND` (no sirve para sondear sucursales); la
   * inactiva solo bloquea las líneas cuando es la ORIGINAL del pedido. Sentencias: típico 7, sucursal distinta 8 y peor caso
   * 9 (token que falla + dueño + sucursal distinta; `findForGuestToken` y `findForOwner` suman 2 en la autorización).
   */
  private async build(
    source: OrderSource,
    requestedBranchId: string,
    now: Date,
  ): Promise<OrderReorderPreviewDto> {
    const sameBranch = requestedBranchId.toLowerCase() === source.branchId.toLowerCase();
    const productIds = [
      ...new Set(source.lines.flatMap((l) => (l.productId === null ? [] : [l.productId]))),
    ];
    const [availability, otherName] = await Promise.all([
      settle(this.availability.canAcceptOrderNow(requestedBranchId)),
      sameBranch
        ? Promise.resolve<Settled<string | null>>({ ok: true, value: source.branchName })
        : settle(this.repo.findBranchName(requestedBranchId)),
    ]);
    if (!availability.ok) {
      throw availability.error instanceof NotFoundException
        ? adminBranchNotFound()
        : availability.error;
    }
    if (!otherName.ok) throw otherName.error;
    if (otherName.value === null) throw adminBranchNotFound();
    const active = availability.value.reason !== 'INACTIVE';
    if (!active && !sameBranch) throw adminBranchNotFound();

    let catalog: ReorderCatalog;
    if (!active || productIds.length === 0) {
      // Sucursal original inactiva: bloquea todas las líneas SIN evaluar el catálogo (ni `inspect` ni ofertas).
      catalog = {
        branchActive: active,
        offers: new Map(),
        groups: new Map(),
        presentation: new Map(),
      };
    } else {
      const [offers, groups] = await Promise.all([
        this.offers.inspect(requestedBranchId, productIds),
        this.modifiers.findOffers(productIds),
      ]);
      const orderable = [...offers].filter(([, o]) => o.state === 'OK').map(([pid]) => pid);
      catalog = {
        branchActive: true,
        offers,
        groups,
        presentation:
          orderable.length > 0 ? await this.products.findPresentationByIds(orderable) : new Map(),
      };
    }

    const { lines, summary } = diagnoseReorder(source.lines, catalog);
    return {
      generatedAt: now.toISOString(),
      source: {
        displayNumber: displayNumberOf(source.orderNumber),
        status: source.status,
        fulfillmentType: source.fulfillmentType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
        deliveryProvider:
          source.deliveryProvider === 'OWN' || source.deliveryProvider === 'PEDIDOSYA'
            ? source.deliveryProvider
            : null,
        placedAt: source.placedAt.toISOString(),
      },
      branch: {
        originalBranchId: source.branchId,
        requestedBranchId,
        sameBranch,
        name: otherName.value,
        active,
        acceptingOrders: availability.value.accepted,
        reason: availability.value.reason,
        nextOpensAt: availability.value.nextOpensAt?.toISOString() ?? null,
      },
      lines,
      summary,
    };
  }
}

import type { DataClient } from '@/lib/data-access/types';
import type {
  CardPaymentRequest,
  CreateIncidentRequest,
  DraftCreateOrderRequest,
  DraftOrder,
  Incident,
  MyOrderPage,
  OrderCreateRequest,
  OrderCreated,
  OrderDetail,
  OrderLifecycleStatus,
  OrderLookupRequest,
  OrderReceipt,
  OrderReorderPreview,
  OrderReorderRequest,
  OrderTracking,
  PaymentResult,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Pedidos de la tienda: crear (F20), consultar, seguir (simulado), consultar como invitado, pagar e incidencias. */

/**
 * F20 — `POST /v1/orders` (`createOrder`). Cuerpo `OrderCreateRequest`: la cotización aceptada (`quoteToken`) + contacto +
 * dirección + preferencia de pago; NUNCA importes. `idempotencyKey` es obligatoria (cabecera `Idempotency-Key`) y debe ser la
 * MISMA ante cualquier reintento del mismo envío (ver `features/checkout/order-attempt.ts`). El 200 (repetición idempotente) y
 * el 201 devuelven el mismo `OrderCreated`; `access.guestToken` solo viene para invitados y es una credencial: no se registra.
 * Lectura/escritura PRIVADA: con sesión viaja `Authorization`.
 */
export const createOrder = (
  client: DataClient,
  input: OrderCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  client.request<OrderCreated>(paths.orders(), {
    method: 'POST',
    body: input,
    signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/**
 * F20 — `GET /v1/orders/{id}` (`getOrder`): `id` es el UUID del pedido. Dueño por sesión (JWT) o invitado con la credencial
 * `X-Order-Token` (cabecera, nunca en la URL). Cualquier otro caso es el mismo 404.
 */
export const getOrder = (
  client: DataClient,
  id: string,
  options: { guestToken?: string | null; signal?: AbortSignal } = {},
) =>
  client.request<OrderDetail>(paths.order(id), {
    method: 'GET',
    signal: options.signal,
    ...(options.guestToken ? { headers: { 'X-Order-Token': options.guestToken } } : {}),
  });

/**
 * F21 — `GET /v1/orders/{id}/tracking` (`getOrderTracking`): seguimiento ligero para polling. Misma autorización que `getOrder`
 * (sesión del dueño o `X-Order-Token`; cualquier otro caso es el mismo 404). La credencial viaja SOLO en la cabecera, jamás en la
 * URL, y nunca es una lectura pública (`public: true` omitiría la sesión): con sesión también viaja `Authorization`.
 */
export const getOrderTracking = (
  client: DataClient,
  id: string,
  options: { guestToken?: string | null; signal?: AbortSignal } = {},
) =>
  client.request<OrderTracking>(paths.orderTracking(id), {
    method: 'GET',
    signal: options.signal,
    ...(options.guestToken ? { headers: { 'X-Order-Token': options.guestToken } } : {}),
  });

/**
 * 🎭 Solo mock: pedido BORRADOR que usan el seguimiento y el backoffice simulados. En `http` no existe (404): el pedido real es
 * `createOrder`. Se retira con F21/F22.
 */
export const createDraftOrder = (client: DataClient, input: DraftCreateOrderRequest) =>
  client.post<DraftOrder>(paths.demoDraftOrders(), input);

/** 🎭 Seguimiento SIMULADO (borrador `DraftOrder`, id `MON-…`). En `http` el seguimiento es F21. */
export const getDraftOrder = (client: DataClient, id: string) =>
  client.get<DraftOrder>(paths.order(id));

/** 🎭 Solo mock: prepara el pedido borrador para la pasarela NeoNet SIMULADA. */
export const prepareDraftCardOrder = (client: DataClient, id: string) =>
  client.post<DraftOrder>(paths.demoPrepareCardOrder(id));

export const lookupOrder = (client: DataClient, input: OrderLookupRequest) =>
  client.post<DraftOrder>(paths.orderLookup(), input);

/**
 * Pago con tarjeta — pasarela NeoNet SIMULADA (solo tarjetas de prueba). La integración real
 * tokenizará la tarjeta en el navegador (pendiente de documentación y credenciales).
 */
export const payWithCard = (client: DataClient, input: CardPaymentRequest) =>
  client.post<PaymentResult>(paths.cardPayment(), input);

export const createIncident = (client: DataClient, input: CreateIncidentRequest) =>
  client.post<Incident>(paths.incidents(), input);

/** 🎭 Solo mock: "Ver siguiente estado (simulación)". En http no existe (404). */
export const advanceOrderDemo = (client: DataClient, id: string) =>
  client.post<DraftOrder>(paths.demoAdvanceOrder(id));

// ── F23 (spec 024): historial, recibo y «Volver a pedir» ────────────────────────────────────────────────────────────────────────

export interface MyOrderFilters {
  /** Estados del catálogo `OrderLifecycleStatus` (se envían como lista separada por comas). */
  status?: readonly OrderLifecycleStatus[];
  branchId?: string;
  /** Instantes ISO 8601 CON zona (la web los calcula en America/Guatemala). `from` inclusivo, `to` exclusivo. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * F23 — `GET /v1/me/orders` (`listMyOrders`): historial del cliente autenticado, orden fijo `placed_at DESC, id DESC`, paginado por
 * cursor opaco (`nextCursor`). Requiere sesión (401 sin ella; la web ni siquiera la emite). Los filtros los aplica el servidor.
 */
export const listMyOrders = (
  client: DataClient,
  filters: MyOrderFilters = {},
  cursor?: string | null,
  signal?: AbortSignal,
) =>
  client.get<MyOrderPage>(paths.myOrders(), {
    signal,
    query: {
      status: filters.status?.length ? filters.status.join(',') : undefined,
      branchId: filters.branchId,
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      cursor: cursor ?? undefined,
    },
  });

/**
 * F23 — `GET /v1/orders/{id}/receipt` (`getOrderReceipt`): datos del recibo NO fiscal desde los snapshots del pedido. Misma
 * autorización que `getOrder` (dueño por sesión o `X-Order-Token`, nunca en la URL; cualquier otro caso es el mismo 404).
 */
export const getOrderReceipt = (
  client: DataClient,
  id: string,
  options: { guestToken?: string | null; signal?: AbortSignal } = {},
) =>
  client.request<OrderReceipt>(paths.orderReceipt(id), {
    method: 'GET',
    signal: options.signal,
    ...(options.guestToken ? { headers: { 'X-Order-Token': options.guestToken } } : {}),
  });

/**
 * F23 — `POST /v1/orders/{id}/reorder-preview` (`previewOrderReorder`): vista previa de SOLO LECTURA contra el catálogo vigente.
 * No crea pedidos ni guarda nada y no lleva `Idempotency-Key`. El cuerpo es opcional (`{}` = sucursal del pedido original); jamás
 * lleva precios, líneas ni cantidades.
 */
export const previewOrderReorder = (
  client: DataClient,
  id: string,
  options: { branchId?: string | null; guestToken?: string | null; signal?: AbortSignal } = {},
) => {
  const body: OrderReorderRequest = options.branchId ? { branchId: options.branchId } : {};
  return client.request<OrderReorderPreview>(paths.orderReorderPreview(id), {
    method: 'POST',
    body,
    signal: options.signal,
    ...(options.guestToken ? { headers: { 'X-Order-Token': options.guestToken } } : {}),
  });
};

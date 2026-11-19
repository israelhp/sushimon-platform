import { NotFoundException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import type { BranchOffersService } from '../branch-products/branch-offers.service.js';
import type { BranchAvailabilityPort } from '../branch-schedule/branch-availability.port.js';
import type { Clock } from '../branch-schedule/clock.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import type { ModifierSelectionService } from '../modifiers/modifier-selection.service.js';
import type { OfferGroup } from '../modifiers/modifiers.types.js';
import type { ProductsQueryService } from '../products/products-query.service.js';
import { source } from '../../test/support/order-source-fixtures.js';
import { issueGuestToken } from './order-access-token.js';
import { OrderDocumentsService } from './order-documents.service.js';
import type { OrderSource, OrderSourceRepository } from './order-source.repository.js';
import { ordersBusy } from './orders-errors.js';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const USER = '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';
const principal = (authUserId = USER) => ({ authUserId }) as Principal;
const BRANCH = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b';
const OTHER_BRANCH = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a99';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER_ID = '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c';

interface World {
  owner: string | null;
  guestHash: string | null;
  src: OrderSource;
  availability: { accepted: boolean; reason: string; nextOpensAt: Date | null };
  missingBranch: boolean;
}

function setup(over: Partial<World> = {}, gate = new DbGate(4, 8, 1_500, ordersBusy)) {
  const world: World = {
    owner: USER,
    guestHash: null,
    src: source(),
    availability: { accepted: true, reason: 'OPEN', nextOpensAt: null },
    missingBranch: false,
    ...over,
  };
  /** Contador de SENTENCIAS SQL equivalentes (cada lector documenta su coste). */
  const stmts = { n: 0 };
  const log: string[] = [];
  const repo = {
    findForOwner: (oid: string, authUserId: string) => {
      stmts.n += 1;
      log.push('owner');
      return Promise.resolve(oid === world.src.id && authUserId === world.owner ? world.src : null);
    },
    findForGuestToken: (oid: string, hash: Buffer) => {
      stmts.n += 1;
      log.push('guest');
      return Promise.resolve(
        oid === world.src.id && hash.toString('hex') === world.guestHash ? world.src : null,
      );
    },
    findBranchName: (bid: string) => {
      stmts.n += 1;
      log.push('branchName');
      return Promise.resolve(
        bid === OTHER_BRANCH && !world.missingBranch ? 'Sucursal Mixco' : null,
      );
    },
  } as unknown as OrderSourceRepository;
  const offers = {
    inspect: (_b: string, ids: string[]) => {
      stmts.n += 2;
      log.push('inspect');
      return Promise.resolve(
        new Map(ids.map((p) => [p, { state: 'OK' as const, price: '50.00' }])),
      );
    },
  } as unknown as BranchOffersService;
  const modifiers = {
    findOffers: (ids: string[]) => {
      stmts.n += 1;
      log.push('findOffers');
      return Promise.resolve(new Map<string, OfferGroup[]>(ids.map((p) => [p, []])));
    },
  } as unknown as ModifierSelectionService;
  const products = {
    findPresentationByIds: (ids: string[]) => {
      stmts.n += 2;
      log.push('presentation');
      return Promise.resolve(
        new Map(
          ids.map((p) => [
            p,
            { slug: `p-${p.slice(-3)}`, name: `Prod ${p.slice(-3)}`, imageUrl: null },
          ]),
        ),
      );
    },
  } as unknown as ProductsQueryService;
  const availability = {
    canAcceptOrderNow: (bid: string) => {
      stmts.n += 1;
      log.push('availability');
      if (bid === OTHER_BRANCH && world.missingBranch) {
        return Promise.reject(new NotFoundException('Sucursal no encontrada'));
      }
      return Promise.resolve(world.availability);
    },
  } as unknown as BranchAvailabilityPort;
  const clock: Clock = { now: () => NOW };
  const service = new OrderDocumentsService(
    repo,
    offers,
    modifiers,
    products,
    availability,
    clock,
    gate,
  );
  return { service, world, stmts, log, gate };
}

const failure = async (p: Promise<unknown>) => {
  const e = (await p.then(
    () => null,
    (err: unknown) => err,
  )) as { status?: number; response?: { code?: string; message?: unknown } } | null;
  return e ? { status: e.status, code: e.response?.code, message: e.response?.message } : null;
};

describe('OrderDocumentsService.receipt (spec 024 §4.2, §5)', () => {
  it('dueño: 200 construido de snapshots, 1 sentencia, sin tocar el catálogo', async () => {
    const { service, stmts, log } = setup();
    const r = await service.receipt(principal(), ORDER_ID, undefined);
    expect(r).toMatchObject({ fiscalStatus: 'NOT_FISCAL', displayNumber: 'MON-001042' });
    expect(stmts.n).toBe(1);
    expect(log).toEqual(['owner']);
  });

  it('invitado con token vigente: 200 por la ruta del token (1 sentencia)', async () => {
    const issued = issueGuestToken(NOW);
    const { service, stmts, log } = setup({ owner: null, guestHash: issued.hash.toString('hex') });
    await service.receipt(undefined, ORDER_ID, issued.token);
    expect(log).toEqual(['guest']);
    expect(stmts.n).toBe(1);
  });

  it('token con formato inválido => 400 ANTES de la BD', async () => {
    const { service, stmts } = setup();
    expect(await failure(service.receipt(undefined, ORDER_ID, 'smo_corto'))).toMatchObject({
      status: 400,
    });
    expect(stmts.n).toBe(0);
  });

  it('inexistente, ajeno, sin credenciales y pedido de invitado con JWT: el MISMO 404 (cuerpo idéntico)', async () => {
    const issued = issueGuestToken(NOW);
    const unknown = '00000000-0000-4000-8000-000000000999';
    const cases = [
      setup().service.receipt(principal(), unknown, undefined), // inexistente
      setup().service.receipt(principal(OTHER), ORDER_ID, undefined), // ajeno
      setup().service.receipt(undefined, ORDER_ID, undefined), // sin token ni JWT
      setup({ owner: null }).service.receipt(principal(), ORDER_ID, undefined), // invitado con JWT
      setup({ guestHash: 'otro' }).service.receipt(undefined, ORDER_ID, issued.token), // token ajeno/vencido
    ];
    const results = await Promise.all(cases.map(failure));
    for (const r of results)
      expect(r).toEqual({ status: 404, code: undefined, message: 'Pedido no encontrado' });
  });

  it('token inválido + JWT del dueño: cae al dueño (misma regla que getOrder) y un ajeno obtiene el mismo 404', async () => {
    const issued = issueGuestToken(NOW);
    const own = setup({ guestHash: 'otro' });
    await own.service.receipt(principal(), ORDER_ID, issued.token);
    expect(own.log).toEqual(['guest', 'owner']);
    const other = setup({ guestHash: 'otro' });
    expect(
      await failure(other.service.receipt(principal(OTHER), ORDER_ID, issued.token)),
    ).toMatchObject({ status: 404 });
  });

  it('gate saturado => 503 ORDERS_BUSY y libera el cupo', async () => {
    const gate = new DbGate(1, 8, 5_000, ordersBusy);
    let release: () => void = () => undefined;
    const hold = gate.run(() => new Promise<void>((r) => (release = r)));
    const waiting = [gate.run(() => Promise.resolve()), gate.run(() => Promise.resolve())];
    const { service } = setup({}, gate);
    expect(await failure(service.receipt(principal(), ORDER_ID, undefined))).toMatchObject({
      status: 503,
      code: 'ORDERS_BUSY',
    });
    release();
    await Promise.all([hold, ...waiting]);
    expect(gate.inFlight).toBe(0);
  });

  it('logs sin PII: solo orderId y estado', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'debug').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    try {
      await setup().service.receipt(principal(), ORDER_ID, undefined);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual([`order.receipt orderId=${ORDER_ID} status=delivered`]);
    expect(lines.join()).not.toMatch(/Ana|5555|pérez|calle/i);
  });
});

describe('OrderDocumentsService.previewReorder (spec 024 §8)', () => {
  const thirtyLines = (): OrderSource => {
    const base = source();
    return {
      ...base,
      lines: Array.from({ length: 30 }, (_, i) => ({
        ...(base.lines[0] as OrderSource['lines'][number]),
        lineNo: i + 1,
        productId: id(1000 + i),
        modifiers: [],
      })),
    };
  };

  it('#43 pedido de 30 líneas y 30 productos: 7 sentencias (<= 8), sin consultas por línea ni por producto', async () => {
    const { service, stmts, log } = setup({ src: thirtyLines() });
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(p.lines).toHaveLength(30);
    expect(stmts.n).toBe(7);
    expect(log.filter((l) => l === 'inspect')).toHaveLength(1);
    expect(log.filter((l) => l === 'findOffers')).toHaveLength(1);
    expect(log.filter((l) => l === 'presentation')).toHaveLength(1);
  });

  it('#43 con sucursal distinta: 8 sentencias (+ nombre de la sucursal)', async () => {
    const { service, stmts } = setup({ src: thirtyLines() });
    await service.previewReorder(principal(), ORDER_ID, undefined, { branchId: OTHER_BRANCH });
    expect(stmts.n).toBe(8);
  });

  it('#27 dueño e invitado con token => 200; sin cuerpo y con `{}` usan la sucursal del pedido', async () => {
    const issued = issueGuestToken(NOW);
    const guest = setup({ owner: null, guestHash: issued.hash.toString('hex') });
    const g = await guest.service.previewReorder(undefined, ORDER_ID, issued.token, {});
    expect(g.branch).toMatchObject({
      requestedBranchId: BRANCH,
      sameBranch: true,
      name: 'Sushi Mon Zona 10',
    });
    const owner = await setup().service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(owner.branch.sameBranch).toBe(true);
  });

  it('#27 pedido ajeno/inexistente/token inválido => mismo 404 sin code; `branchId` inexistente NO se evalúa antes de autorizar', async () => {
    const body = { branchId: id(77777) };
    const ajeno = setup({ missingBranch: true });
    expect(
      await failure(ajeno.service.previewReorder(principal(OTHER), ORDER_ID, undefined, body)),
    ).toEqual({
      status: 404,
      code: undefined,
      message: 'Pedido no encontrado',
    });
    // Ni siquiera se consultó la sucursal: no sirve para sondear pedidos.
    expect(ajeno.log).toEqual(['owner']);
  });

  it('#27 `branchId` inexistente tras autorizar => 404 BRANCH_NOT_FOUND', async () => {
    const { service } = setup({ missingBranch: true });
    expect(
      await failure(
        service.previewReorder(principal(), ORDER_ID, undefined, { branchId: OTHER_BRANCH }),
      ),
    ).toMatchObject({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });

  it('#40 otra sucursal: nombre, precios y disponibilidad de ESA sucursal (sameBranch=false)', async () => {
    const { service } = setup();
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, {
      branchId: OTHER_BRANCH,
    });
    expect(p.branch).toMatchObject({
      originalBranchId: BRANCH,
      requestedBranchId: OTHER_BRANCH,
      sameBranch: false,
      name: 'Sucursal Mixco',
    });
  });

  it('#39 sucursal inactiva => todas las líneas UNAVAILABLE con BRANCH_UNAVAILABLE y sin presentación', async () => {
    const { service, log } = setup({
      availability: { accepted: false, reason: 'INACTIVE', nextOpensAt: null },
    });
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(p.branch).toMatchObject({ active: false, acceptingOrders: false, reason: 'INACTIVE' });
    expect(
      p.lines.every(
        (l) => l.status === 'UNAVAILABLE' && l.issues[0]?.code === 'BRANCH_UNAVAILABLE',
      ),
    ).toBe(true);
    expect(p.summary.canAddAny).toBe(false);
    expect(log).not.toContain('presentation');
    expect(log).not.toContain('inspect');
    expect(log).not.toContain('findOffers');
  });

  it('sucursal DISTINTA inactiva => el mismo 404 BRANCH_NOT_FOUND que una inexistente (sin nombre ni INACTIVE) y sin leer el catálogo', async () => {
    const { service, log } = setup({
      availability: { accepted: false, reason: 'INACTIVE', nextOpensAt: null },
    });
    const e = await failure(
      service.previewReorder(principal(), ORDER_ID, undefined, { branchId: OTHER_BRANCH }),
    );
    const missing = await failure(
      setup({ missingBranch: true }).service.previewReorder(principal(), ORDER_ID, undefined, {
        branchId: OTHER_BRANCH,
      }),
    );
    expect(e).toEqual(missing);
    expect(e).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(JSON.stringify(e)).not.toMatch(/Mixco|INACTIVE/);
    expect(log).not.toContain('inspect');
    expect(log).not.toContain('findOffers');
  });

  it('presupuesto real: típico 7, sucursal distinta 8, peor caso (token que falla + dueño + sucursal distinta) 9', async () => {
    const issued = issueGuestToken(NOW);
    const typical = setup({ src: thirtyLines() });
    await typical.service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(typical.stmts.n).toBe(7);
    const other = setup({ src: thirtyLines() });
    await other.service.previewReorder(principal(), ORDER_ID, undefined, {
      branchId: OTHER_BRANCH,
    });
    expect(other.stmts.n).toBe(8);
    const worst = setup({ src: thirtyLines(), guestHash: 'otro' });
    await worst.service.previewReorder(principal(), ORDER_ID, issued.token, {
      branchId: OTHER_BRANCH,
    });
    expect(worst.stmts.n).toBe(9);
  });

  it('#39 cerrada por horario: solo avisa (acceptingOrders=false) y las líneas se evalúan con normalidad', async () => {
    const next = new Date('2026-11-20T13:00:00.000Z');
    const base = source();
    const { service } = setup({
      src: { ...base, lines: base.lines.map((l) => ({ ...l, modifiers: [] })) },
      availability: { accepted: false, reason: 'OUTSIDE_BUSINESS_HOURS', nextOpensAt: next },
    });
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(p.branch).toMatchObject({
      active: true,
      acceptingOrders: false,
      reason: 'OUTSIDE_BUSINESS_HOURS',
      nextOpensAt: next.toISOString(),
    });
    expect(p.lines[0]?.status).toBe('AVAILABLE');
  });

  it('#42 PEDIDOSYA/DELIVERY originales: source informativo, sin tarifa, proveedor ni dirección en la respuesta', async () => {
    const { service } = setup({ src: source({ deliveryProvider: 'PEDIDOSYA' }) });
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(p.source).toEqual({
      displayNumber: 'MON-001042',
      status: 'delivered',
      fulfillmentType: 'DELIVERY',
      deliveryProvider: 'PEDIDOSYA',
      placedAt: '2026-11-18T19:42:10.000Z',
    });
    const json = JSON.stringify(p);
    for (const forbidden of [
      'deliveryFee',
      'portón',
      'municipality',
      'Ana',
      '5555',
      ORDER_ID,
      'paymentMethod',
      'Martes 2x1',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('#47 sin fuga: ni ids de pedido/líneas ni datos del cliente', async () => {
    const { service } = setup();
    const json = JSON.stringify(
      await service.previewReorder(principal(), ORDER_ID, undefined, undefined),
    );
    expect(json).not.toContain(ORDER_ID);
    expect(json).not.toMatch(/customer|phone|email|token/i);
  });

  it('pedido sin líneas con producto (todo product_id nulo): sin lecturas de catálogo por lote', async () => {
    const base = source();
    const { service, stmts } = setup({
      src: { ...base, lines: base.lines.map((l) => ({ ...l, productId: null })) },
    });
    const p = await service.previewReorder(principal(), ORDER_ID, undefined, undefined);
    expect(p.lines[0]?.issues[0]?.code).toBe('PRODUCT_REMOVED');
    expect(stmts.n).toBe(2); // pedido + sucursal; nada de catálogo
  });
});

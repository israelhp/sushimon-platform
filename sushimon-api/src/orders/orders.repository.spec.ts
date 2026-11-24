import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import { OrdersRepository } from './orders.repository.js';
import type { NewOrder } from './orders.types.js';

const claim = {
  scope: 'guest',
  keyHash: Buffer.alloc(32, 1),
  requestHash: Buffer.alloc(32, 2),
  expiresAt: new Date('2026-11-17T00:00:00Z'),
};
const order = (over: Partial<NewOrder> = {}): NewOrder => ({
  orderId: '00000000-0000-4000-8000-0000000000aa',
  customerId: null,
  branchId: '00000000-0000-4000-8000-0000000000bb',
  customerName: 'Ana',
  customerPhone: '+50255551234',
  customerEmail: null,
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  notes: null,
  subtotal: '170.00',
  extrasTotal: '0.00',
  discountTotal: '0.00',
  deliveryFee: '0.00',
  total: '170.00',
  paymentMethodPreference: null,
  address: null,
  lines: [
    {
      lineNo: 1,
      productId: 'p1',
      productName: 'Roll',
      quantity: 2,
      unitPrice: '85.00',
      extrasPerUnit: '0.00',
      lineDiscount: '0.00',
      modifiers: [],
    },
  ],
  promotions: [],
  guestToken: { hash: Buffer.alloc(32, 3), expiresAt: new Date('2026-12-01T00:00:00Z') },
  itemCount: 1,
  ...over,
});

/** Cliente transaccional que registra el ORDEN de las sentencias. */
function fakeTx(
  claimCount: number,
  stored: { requestHash: Uint8Array; orderId: string } | null = null,
  excessTokens: { id: string }[] = [],
) {
  const log: string[] = [];
  const state = { paymentRows: 1 };
  const rec = <T>(name: string, value: T) =>
    vi.fn<(...args: unknown[]) => Promise<T>>(() => {
      log.push(name);
      return Promise.resolve(value);
    });
  const tx = {
    $executeRawUnsafe: vi.fn((statement: string) => {
      log.push(`raw:${statement}`);
      return Promise.resolve(0);
    }),
    orderIdempotencyKey: {
      createMany: rec('claim', { count: claimCount }),
      findFirst: rec('claim.read', stored),
    },
    order: {
      create: rec('order', {
        orderNumber: 1001n,
        placedAt: new Date('2026-11-16T22:00:00Z'),
        updatedAt: new Date('2026-11-16T22:00:00Z'),
      }),
    },
    orderAddress: { create: rec('address', {}) },
    orderItem: { createMany: rec('items', { count: 1 }) },
    orderItemModifier: { createMany: rec('modifiers', { count: 1 }) },
    orderPromotion: { createMany: rec('promotions', { count: 1 }) },
    orderStatusHistory: { create: rec('history', {}) },
    // F24: CTE `payments` + `payment_events` en UNA sentencia; devuelve las filas insertadas (1 = pago creado).
    $executeRaw: vi.fn((_strings: unknown, ..._values: unknown[]) => {
      void _values;
      log.push('payment');
      return Promise.resolve(state.paymentRows);
    }),
    orderAccessToken: {
      create: rec('token', {}),
      updateMany: rec('token.revoke', { count: 1 }),
      findMany: rec('token.excess', excessTokens),
    },
  };
  const audit = {
    record: vi.fn((_tx: unknown, event: Record<string, unknown>) => {
      log.push('audit');
      return Promise.resolve(event as never);
    }),
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
      log.push(`tx:${JSON.stringify(opts)}`);
      return fn(tx);
    }),
  };
  const repo = new OrdersRepository(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { repo, tx, audit, log, prisma, state };
}

describe('OrdersRepository.createOrder (F20: orden y alcance de la transacción)', () => {
  it('lock_timeout local PRIMERO; luego reclama la clave y SOLO después escribe pedido, líneas, historial, token y auditoría', async () => {
    const { repo, log, tx } = fakeTx(1);
    const out = await repo.createOrder(claim, order());
    expect(out).toMatchObject({ kind: 'created', orderNumber: 1001n });
    const steps = log.filter((l) => !l.startsWith('tx:'));
    expect(steps).toEqual([
      "raw:SET LOCAL lock_timeout = '2s'",
      'claim',
      'order',
      'items',
      'history',
      'payment',
      'token',
      'audit',
    ]);
    // El reclamo es `INSERT … ON CONFLICT DO NOTHING` (skipDuplicates) y guarda hashes, nunca la clave.
    const data = tx.orderIdempotencyKey.createMany.mock.calls[0]?.[0] as {
      skipDuplicates: boolean;
      data: { scope: string; orderId: string }[];
    };
    expect(data.skipDuplicates).toBe(true);
    expect(data.data[0]).toMatchObject({ scope: 'guest', orderId: order().orderId });
  });

  it('F24: el pago CASH pendiente se inserta en la MISMA transacción, DESPUÉS del pedido y SOLO en la ruta de creación (1 sentencia)', async () => {
    const { repo, tx, log } = fakeTx(1);
    await repo.createOrder(claim, order());
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(log.indexOf('payment')).toBeGreaterThan(log.indexOf('order'));
    const sql = (tx.$executeRaw.mock.calls[0]?.[0] as readonly string[]).join('?');
    expect(sql).toContain('INSERT INTO app.payments');
    expect(sql).toContain('INSERT INTO app.payment_events');
    expect(sql).toContain("'created'");
    expect(sql).toContain('o.total'); // el importe sale del pedido DENTRO de la sentencia (nunca del cliente)
  });

  it('F24: sin el método `cash` activo (0 filas) revierte TODO con 503 ORDERS_UNAVAILABLE (fail-closed)', async () => {
    const h = fakeTx(1);
    h.state.paymentRows = 0;
    await expect(h.repo.createOrder(claim, order())).rejects.toMatchObject({
      response: { code: 'ORDERS_UNAVAILABLE' },
    });
    expect(h.log).not.toContain('audit'); // la auditoría (posterior) nunca se escribe: la transacción lanza y revierte
  });

  it('F24: la repetición idempotente NO inserta pago (retorna antes de escribir)', async () => {
    const h = fakeTx(0, { requestHash: claim.requestHash, orderId: 'otro-pedido' });
    await h.repo.createOrder(claim, order());
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('READ COMMITTED explícito', async () => {
    const { repo, prisma } = fakeTx(1);
    await repo.createOrder(claim, order());
    expect(JSON.stringify(prisma.$transaction.mock.calls[0]?.[1])).toContain('ReadCommitted');
  });

  it('DELIVERY escribe la dirección; extras y promociones por lote solo si existen; autenticado no crea token', async () => {
    const { repo, log, tx } = fakeTx(1);
    await repo.createOrder(
      claim,
      order({
        customerId: '00000000-0000-4000-8000-0000000000cc',
        guestToken: null,
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        address: {
          municipalityName: 'Guatemala',
          zone: 'Zona 10',
          addressLine: 'Calle 1-23',
          referenceNote: null,
          latitude: null,
          longitude: null,
        },
        lines: [
          {
            lineNo: 1,
            productId: 'p1',
            productName: 'Roll',
            quantity: 1,
            unitPrice: '85.00',
            extrasPerUnit: '5.00',
            lineDiscount: '8.50',
            modifiers: [{ modifierId: 'm1', modifierName: 'Aguacate', unitExtraPrice: '5.00' }],
          },
        ],
        promotions: [{ promotionId: 'x1', promotionName: 'Diez', amount: '8.50' }],
      }),
    );
    expect(log.filter((l) => !l.startsWith('tx:') && !l.startsWith('raw:'))).toEqual([
      'claim',
      'order',
      'address',
      'items',
      'modifiers',
      'promotions',
      'history',
      'payment',
      'audit',
    ]);
    expect(tx.orderAccessToken.create).not.toHaveBeenCalled();
  });

  it('la clave ya existe (otro concurrente confirmó): NO escribe nada; mismo cuerpo => replay, otro => reused', async () => {
    const same = fakeTx(0, { requestHash: claim.requestHash, orderId: 'otro-pedido' });
    expect(await same.repo.createOrder(claim, order())).toEqual({
      kind: 'replay',
      orderId: 'otro-pedido',
    });
    expect(
      same.log.filter((l) =>
        ['order', 'items', 'history', 'payment', 'token', 'audit'].includes(l),
      ),
    ).toEqual([]);

    const other = fakeTx(0, { requestHash: Buffer.alloc(32, 9), orderId: 'otro-pedido' });
    expect(await other.repo.createOrder(claim, order())).toEqual({ kind: 'reused' });
  });

  it('la clave desapareció entre el conflicto y la lectura (el ganador revirtió) => 503 ORDERS_BUSY (reintentable)', async () => {
    const { repo } = fakeTx(0, null);
    await expect(repo.createOrder(claim, order())).rejects.toMatchObject({ status: 503 });
  });

  it('la auditoría order.created lleva actor NULL y NO lleva PII', async () => {
    const { repo, audit } = fakeTx(1);
    await repo.createOrder(claim, order({ notes: 'sin wasabi', customerEmail: 'ana@example.com' }));
    const event = audit.record.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(event).toMatchObject({
      actorId: null,
      entityType: 'order',
      action: 'order.created',
      newValues: { status: 'pending', total: '170.00', itemCount: 1, actor: 'guest' },
    });
    expect(JSON.stringify(event)).not.toMatch(/Ana|5555|wasabi|ana@example/);
  });

  it('si una sentencia falla la excepción se propaga (Prisma revierte la transacción completa)', async () => {
    const { repo, tx } = fakeTx(1);
    tx.orderItem.createMany.mockRejectedValueOnce(new Error('falla items'));
    await expect(repo.createOrder(claim, order())).rejects.toThrow('falla items');
  });
});

describe('OrdersRepository: lecturas y emisión de token', () => {
  it('issueGuestToken emite uno ADICIONAL sin revocar el vigente (solo acota por encima de 5)', async () => {
    const { repo, log, tx } = fakeTx(1);
    await repo.issueGuestToken(
      'o1',
      { hash: Buffer.alloc(32, 4), expiresAt: new Date('2026-12-01T00:00:00Z') },
      new Date('2026-11-16T22:00:00Z'),
    );
    // Sin excedentes: no hay revocación alguna.
    expect(log.filter((l) => !l.startsWith('tx:'))).toEqual([
      "raw:SET LOCAL lock_timeout = '2s'",
      'token',
      'token.excess',
    ]);
    const find = tx.orderAccessToken.findMany.mock.calls[0]?.[0] as {
      where: unknown;
      orderBy: unknown;
      skip: number;
    };
    expect(find).toMatchObject({
      where: { orderId: 'o1', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      skip: 5,
    });
  });

  it('issueGuestToken revoca solo los activos que exceden los 5 más recientes', async () => {
    const { repo, log, tx } = fakeTx(1, null, [{ id: 't6' }, { id: 't7' }]);
    await repo.issueGuestToken(
      'o1',
      { hash: Buffer.alloc(32, 4), expiresAt: new Date('2026-12-01T00:00:00Z') },
      new Date('2026-11-16T22:00:00Z'),
    );
    expect(log.filter((l) => !l.startsWith('tx:'))).toContain('token.revoke');
    expect(tx.orderAccessToken.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: ['t6', 't7'] } },
    });
  });

  it('findForGuestToken exige hash, no revocado y no vencido en UNA consulta; findForCustomer exige customerId', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = new OrdersRepository(
      { order: { findFirst } } as unknown as PrismaService,
      {} as AuditService,
    );
    const now = new Date('2026-11-16T22:00:00Z');
    await repo.findForGuestToken('o1', Buffer.alloc(32, 5), now);
    const where = (findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      id: 'o1',
      accessTokens: { some: { revokedAt: null, expiresAt: { gt: now } } },
    });
    await repo.findForCustomer('o1', 'c1');
    expect((findFirst.mock.calls[1]?.[0] as { where: unknown }).where).toEqual({
      id: 'o1',
      customerId: 'c1',
    });
    // La selección no incluye correo ni coordenadas.
    const select = (findFirst.mock.calls[0]?.[0] as { select: Record<string, unknown> }).select;
    expect(JSON.stringify(select)).not.toMatch(/customerEmail|latitude|longitude/);
  });

  it('countPending: solo clientes autenticados (customer_id), con ventana y estado pending; nunca por teléfono', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repo = new OrdersRepository(
      { order: { count } } as unknown as PrismaService,
      {} as AuditService,
    );
    const since = new Date('2026-11-15T22:00:00Z');
    expect(await repo.countPending('c1', since)).toBe(2);
    expect(count.mock.calls[0]?.[0]).toEqual({
      where: { status: 'pending', placedAt: { gte: since }, customerId: 'c1' },
    });
    expect(JSON.stringify(count.mock.calls[0]?.[0])).not.toContain('customerPhone');
  });

  it('findIdempotent devuelve la fila vigente o vencida con su bandera `expired`', async () => {
    const now = new Date('2026-11-16T22:00:00Z');
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        requestHash: Buffer.alloc(32, 1),
        orderId: 'o1',
        expiresAt: new Date(now.getTime() + 1000),
      })
      .mockResolvedValueOnce({
        requestHash: Buffer.alloc(32, 1),
        orderId: 'o1',
        expiresAt: new Date(now.getTime() - 1000),
      })
      .mockResolvedValueOnce(null);
    const repo = new OrdersRepository(
      { orderIdempotencyKey: { findFirst } } as unknown as PrismaService,
      {} as AuditService,
    );
    expect((await repo.findIdempotent('guest', Buffer.alloc(32, 1), now))?.expired).toBe(false);
    expect((await repo.findIdempotent('guest', Buffer.alloc(32, 1), now))?.expired).toBe(true);
    expect(await repo.findIdempotent('guest', Buffer.alloc(32, 1), now)).toBeNull();
  });

  it('purgeExpired: la fila de ESTA clave solo si se vio vencida; el lote (1/50) es independiente y acotado', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const $executeRaw = vi.fn().mockResolvedValue(0);
    const repo = new OrdersRepository(
      { orderIdempotencyKey: { deleteMany }, $executeRaw } as unknown as PrismaService,
      {} as AuditService,
    );
    const rnd = vi.spyOn(Math, 'random');
    const now = new Date('2026-11-16T22:00:00Z');
    rnd.mockReturnValue(0.5);
    await repo.purgeExpired('guest', Buffer.alloc(32, 1), now, false);
    expect(deleteMany).not.toHaveBeenCalled(); // sin fila vencida vista: cero consultas extra
    expect($executeRaw).not.toHaveBeenCalled();
    await repo.purgeExpired('guest', Buffer.alloc(32, 1), now, true);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0]?.[0]).toMatchObject({
      where: { scope: 'guest', expiresAt: { lte: now } },
    });
    rnd.mockReturnValue(0.001);
    await repo.purgeExpired('guest', Buffer.alloc(32, 1), now, false);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    rnd.mockRestore();
  });

  it('constantes: lock_timeout de 2 s alineado con maxWait de la transacción', async () => {
    const { LOCK_TIMEOUT, TX_MAX_WAIT_MS } = await import('./orders.repository.js');
    expect([LOCK_TIMEOUT, TX_MAX_WAIT_MS]).toEqual(['2s', 2000]);
    const { repo, prisma } = fakeTx(1);
    await repo.createOrder(claim, order());
    expect((prisma.$transaction.mock.calls[0]?.[1] as { maxWait: number }).maxWait).toBe(2000);
  });
});

describe('OrdersRepository: seguimiento (F21)', () => {
  const row = {
    id: 'o1',
    orderNumber: 1001n,
    branchId: 'b1',
    fulfillmentType: 'PICKUP',
    deliveryProvider: null,
    status: 'accepted',
    placedAt: new Date('2026-11-18T10:00:00Z'),
    updatedAt: new Date('2026-11-18T10:00:00Z'),
    // Prisma los entrega en el orden de la consulta: los más RECIENTES primero (desc).
    statusHistory: [
      { newStatus: 'accepted', changedAt: new Date('2026-11-18T10:05:00Z') },
      { newStatus: 'pending', changedAt: new Date('2026-11-18T10:00:00Z') },
    ],
  };
  const make = (found: unknown) => {
    const findFirst = vi.fn().mockResolvedValue(found);
    const repo = new OrdersRepository(
      { order: { findFirst } } as unknown as PrismaService,
      {} as AuditService,
    );
    return { repo, findFirst };
  };

  it('findTrackingForGuestToken: UNA consulta con hash, no revocado, no vencido; select mínimo e historial de los 51 más recientes', async () => {
    const { repo, findFirst } = make(row);
    const now = new Date('2026-11-18T11:00:00Z');
    const record = await repo.findTrackingForGuestToken('o1', Buffer.alloc(32, 5), now);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0]?.[0] as {
      where: { id: string; accessTokens: { some: Record<string, unknown> } };
      select: Record<string, unknown> & {
        statusHistory: { orderBy: unknown; take: number; select: Record<string, boolean> };
      };
    };
    expect(arg.where.id).toBe('o1');
    expect(arg.where.accessTokens.some).toMatchObject({
      revokedAt: null,
      expiresAt: { gt: now },
    });
    expect(arg.select.statusHistory.orderBy).toEqual([{ changedAt: 'desc' }, { id: 'desc' }]);
    expect(arg.select.statusHistory.take).toBe(51);
    expect(Object.keys(arg.select.statusHistory.select).sort()).toEqual(['changedAt', 'newStatus']);
    // Se devuelven en orden CRONOLÓGICO ascendente.
    expect(record?.history.map((h) => h.newStatus)).toEqual(['pending', 'accepted']);
    expect(record).not.toHaveProperty('statusHistory');
  });

  it('findTrackingForOwnerAuthUser: UNA consulta con join por auth_user_id (sin leer al cliente); SELECT sin contacto, dirección, notas, importes, líneas ni customerId', async () => {
    const { repo, findFirst } = make(null);
    expect(await repo.findTrackingForOwnerAuthUser('o1', 'auth-1')).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0]?.[0] as { where: unknown; select: Record<string, unknown> };
    expect(arg.where).toEqual({ id: 'o1', customer: { authUserId: 'auth-1' } });
    expect(Object.keys(arg.select).sort()).toEqual(
      [
        'branchId',
        'delivery',
        'deliveryProvider',
        'fulfillmentType',
        'id',
        'orderNumber',
        'payment',
        'placedAt',
        'status',
        'statusHistory',
        'updatedAt',
      ].sort(),
    );
  });
});

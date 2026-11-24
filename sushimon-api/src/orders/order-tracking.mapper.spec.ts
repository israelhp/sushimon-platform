import {
  buildSteps,
  flowFor,
  isTerminalStatus,
  MAX_TRACKING_EVENTS,
  pollAfterSeconds,
  toOrderTracking,
  toPublicStatus,
} from './order-tracking.mapper.js';
import type { OrderTrackingRecord } from './order-tracking.types.js';

const T0 = new Date('2026-11-18T16:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOW = at(90);
const ev = (newStatus: string, minutes: number) => ({ newStatus, changedAt: at(minutes) });

const record = (over: Partial<OrderTrackingRecord> = {}): OrderTrackingRecord => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  orderNumber: 1042n,
  branchId: '00000000-0000-4000-8000-0000000000bb',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  status: 'pending',
  placedAt: T0,
  updatedAt: T0,
  history: [ev('pending', 0)],
  ...over,
});
const phases = (steps: { phase: string }[]) => steps.map((s) => s.phase);

describe('toPublicStatus / isTerminalStatus (spec 022 §3)', () => {
  it.each([
    ['pending', 'received', false],
    ['accepted', 'accepted', false],
    ['preparing', 'preparing', false],
    ['ready', 'ready', false],
    ['on_the_way', 'on_the_way', false],
    ['delivered', 'completed', true],
    ['picked_up', 'completed', true],
    ['rejected', 'rejected', true],
    ['cancelled', 'cancelled', true],
  ])('%s => %s (terminal=%s)', (status, publicStatus, terminal) => {
    expect(toPublicStatus(status)).toBe(publicStatus);
    expect(isTerminalStatus(status)).toBe(terminal);
  });

  it('un estado desconocido no revienta: received y NO terminal', () => {
    expect(toPublicStatus('paid')).toBe('received');
    expect(isTerminalStatus('paid')).toBe(false);
    expect(() => toOrderTracking(record({ status: 'paid' }), NOW)).not.toThrow();
  });
});

describe('pollAfterSeconds (P63)', () => {
  it.each([
    ['pending', 15],
    ['accepted', 20],
    ['preparing', 30],
    ['ready', 15],
    ['on_the_way', 15],
    ['delivered', null],
    ['picked_up', null],
    ['rejected', null],
    ['cancelled', null],
    ['desconocido', 30],
  ])('%s => %s', (status, expected) => {
    expect(pollAfterSeconds(status)).toBe(expected);
  });

  it('siempre dentro del rango del contrato 5..300 o null', () => {
    for (const s of ['pending', 'accepted', 'preparing', 'ready', 'on_the_way', 'x']) {
      const n = pollAfterSeconds(s) as number;
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(300);
    }
  });
});

describe('flowFor y steps por modalidad', () => {
  it('PICKUP: received -> accepted -> preparing -> ready -> completed (sin on_the_way)', () => {
    expect(flowFor('PICKUP')).toEqual(['received', 'accepted', 'preparing', 'ready', 'completed']);
  });
  it('DELIVERY: incluye on_the_way antes de completed', () => {
    expect(flowFor('DELIVERY')).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'completed',
    ]);
  });

  it('en curso: todas las fases; las futuras con reachedAt null (nunca una hora estimada)', () => {
    const t = toOrderTracking(
      record({
        status: 'preparing',
        history: [ev('pending', 0), ev('accepted', 3), ev('preparing', 8)],
      }),
      NOW,
    );
    expect(t.steps).toEqual([
      { phase: 'received', reachedAt: at(0).toISOString() },
      { phase: 'accepted', reachedAt: at(3).toISOString() },
      { phase: 'preparing', reachedAt: at(8).toISOString() },
      { phase: 'ready', reachedAt: null },
      { phase: 'completed', reachedAt: null },
    ]);
  });

  it('DELIVERY completo: delivered cierra en `completed` con hora', () => {
    const history = [
      ev('pending', 0),
      ev('accepted', 1),
      ev('preparing', 2),
      ev('ready', 3),
      ev('on_the_way', 4),
      ev('delivered', 5),
    ];
    const t = toOrderTracking(
      record({
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        status: 'delivered',
        history,
      }),
      NOW,
    );
    expect(phases(t.steps)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'completed',
    ]);
    expect(t.steps.every((s) => s.reachedAt !== null)).toBe(true);
    expect(t.terminal).toBe(true);
    expect(t.publicStatus).toBe('completed');
    expect(t.pollAfterSeconds).toBeNull();
  });

  it('PICKUP picked_up => completed; sin on_the_way en steps', () => {
    const t = toOrderTracking(
      record({
        status: 'picked_up',
        history: [
          ev('pending', 0),
          ev('accepted', 1),
          ev('preparing', 2),
          ev('ready', 3),
          ev('picked_up', 4),
        ],
      }),
      NOW,
    );
    expect(phases(t.steps)).not.toContain('on_the_way');
    expect(t.steps.at(-1)).toEqual({ phase: 'completed', reachedAt: at(4).toISOString() });
  });

  it('on_the_way en un PICKUP (inconsistente): aparece en events pero NO en steps', () => {
    const t = toOrderTracking(
      record({ status: 'ready', history: [ev('pending', 0), ev('on_the_way', 1), ev('ready', 2)] }),
      NOW,
    );
    expect(t.events.map((e) => e.publicStatus)).toContain('on_the_way');
    expect(phases(t.steps)).not.toContain('on_the_way');
  });
});

describe('rejected / cancelled cortan el recorrido', () => {
  it('rejected desde pending: [received, rejected]', () => {
    const t = toOrderTracking(
      record({ status: 'rejected', history: [ev('pending', 0), ev('rejected', 2)] }),
      NOW,
    );
    expect(t.steps).toEqual([
      { phase: 'received', reachedAt: at(0).toISOString() },
      { phase: 'rejected', reachedAt: at(2).toISOString() },
    ]);
    expect(t.terminal).toBe(true);
    expect(t.pollAfterSeconds).toBeNull();
  });

  it.each([
    ['accepted', ['received', 'accepted', 'cancelled']],
    ['preparing', ['received', 'accepted', 'preparing', 'cancelled']],
    ['ready', ['received', 'accepted', 'preparing', 'ready', 'cancelled']],
  ])('cancelled tras %s: solo fases alcanzadas + cancelled', (last, expected) => {
    const chain = ['pending', 'accepted', 'preparing', 'ready'];
    const history = chain.slice(0, chain.indexOf(last) + 1).map((s, i) => ev(s, i));
    history.push(ev('cancelled', 10));
    const t = toOrderTracking(record({ status: 'cancelled', history }), NOW);
    expect(phases(t.steps)).toEqual(expected);
    expect(t.steps.every((s) => s.reachedAt !== null)).toBe(true);
  });

  it('cancelled en DELIVERY tras on_the_way incluye on_the_way', () => {
    const t = toOrderTracking(
      record({
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        status: 'cancelled',
        history: [
          ev('pending', 0),
          ev('accepted', 1),
          ev('preparing', 2),
          ev('ready', 3),
          ev('on_the_way', 4),
          ev('cancelled', 5),
        ],
      }),
      NOW,
    );
    expect(phases(t.steps)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'cancelled',
    ]);
  });

  it('cancelled sin historial: solo la fase terminal sin hora', () => {
    const t = toOrderTracking(record({ status: 'cancelled', history: [] }), NOW);
    expect(t.steps).toEqual([{ phase: 'cancelled', reachedAt: null }]);
  });
});

describe('historial inconsistente (se entrega tal cual)', () => {
  it('salto pending -> preparing: `accepted` queda con reachedAt null (no se inventa)', () => {
    const t = toOrderTracking(
      record({ status: 'preparing', history: [ev('pending', 0), ev('preparing', 5)] }),
      NOW,
    );
    expect(t.steps.find((s) => s.phase === 'accepted')).toEqual({
      phase: 'accepted',
      reachedAt: null,
    });
    expect(t.events.map((e) => e.status)).toEqual(['pending', 'preparing']);
  });

  it('eventos duplicados: events los conserva y steps usa el PRIMERO de cada fase', () => {
    const t = toOrderTracking(
      record({
        status: 'accepted',
        history: [ev('pending', 0), ev('accepted', 2), ev('accepted', 4), ev('pending', 5)],
      }),
      NOW,
    );
    expect(t.events).toHaveLength(4);
    expect(t.steps[1]).toEqual({ phase: 'accepted', reachedAt: at(2).toISOString() });
    expect(t.steps[0]).toEqual({ phase: 'received', reachedAt: at(0).toISOString() });
  });

  it('orders.status manda sobre el último evento', () => {
    const t = toOrderTracking(
      record({ status: 'ready', history: [ev('pending', 0), ev('accepted', 1)] }),
      NOW,
    );
    expect(t.status).toBe('ready');
    expect(t.publicStatus).toBe('ready');
    expect(t.events.at(-1)?.status).toBe('accepted');
  });

  it('sin historial: events [], steps derivados del estado sin horas, sin error', () => {
    const t = toOrderTracking(record({ status: 'accepted', history: [] }), NOW);
    expect(t.events).toEqual([]);
    expect(t.eventsTruncated).toBe(false);
    expect(t.steps.every((s) => s.reachedAt === null)).toBe(true);
    expect(t.publicStatus).toBe('accepted');
  });

  it('empates de changed_at conservan el orden de entrada (id); se ordena por changed_at', () => {
    const t = toOrderTracking(
      record({
        status: 'accepted',
        history: [ev('accepted', 5), ev('pending', 0), ev('preparing', 5), ev('ready', 5)],
      }),
      NOW,
    );
    expect(t.events.map((e) => e.status)).toEqual(['pending', 'accepted', 'preparing', 'ready']);
    expect(t.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('tope de eventos (se conservan los MÁS RECIENTES)', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ev(i % 2 ? 'accepted' : 'pending', i));

  it('exactamente 50 => sin truncar', () => {
    const t = toOrderTracking(record({ history: many(MAX_TRACKING_EVENTS) }), NOW);
    expect(t.events).toHaveLength(50);
    expect(t.eventsTruncated).toBe(false);
    expect(t.events[0]?.occurredAt).toBe(at(0).toISOString());
  });

  it('51 filas leídas => 50 más recientes + eventsTruncated; seq 1..50 y se conserva el ÚLTIMO evento', () => {
    const t = toOrderTracking(record({ history: many(51) }), NOW);
    expect(t.events).toHaveLength(50);
    expect(t.eventsTruncated).toBe(true);
    expect(t.events[0]?.seq).toBe(1);
    expect(t.events[0]?.occurredAt).toBe(at(1).toISOString()); // el más antiguo (índice 0) se omite
    expect(t.events.at(-1)?.seq).toBe(50);
    expect(t.events.at(-1)?.occurredAt).toBe(at(50).toISOString());
  });

  it('60 eventos => el último sigue presente y en orden cronológico', () => {
    const history = [...many(60)];
    history[59] = ev('cancelled', 59);
    const t = toOrderTracking(record({ status: 'cancelled', history }), NOW);
    expect(t.events.at(-1)?.status).toBe('cancelled');
    expect(t.events.map((e) => e.occurredAt)).toEqual(
      [...t.events.map((e) => e.occurredAt)].sort(),
    );
    expect(t.terminal).toBe(true);
  });

  it('steps con truncado: la fase cuyo evento se omitió queda con reachedAt null (sin inventar hora); la actual conserva la suya', () => {
    const history = [
      ev('pending', 0), // omitido por antiguo
      ...Array.from({ length: 50 }, (_, i) => ev('accepted', 1 + i)),
    ];
    const t = toOrderTracking(record({ status: 'accepted', history }), NOW);
    expect(t.eventsTruncated).toBe(true);
    expect(t.steps[0]).toEqual({ phase: 'received', reachedAt: null });
    expect(t.steps[1]).toEqual({ phase: 'accepted', reachedAt: at(1).toISOString() });
  });
});

describe('valores fuera de catálogo (nunca se exponen crudos)', () => {
  it('un evento desconocido se omite (seq se renumera) y no cuenta para el tope', () => {
    const t = toOrderTracking(
      record({
        status: 'accepted',
        history: [ev('pending', 0), ev('paid', 1), ev('accepted', 2)],
      }),
      NOW,
    );
    expect(t.events.map((e) => [e.seq, e.status])).toEqual([
      [1, 'pending'],
      [2, 'accepted'],
    ]);
    expect(JSON.stringify(t.events)).not.toContain('paid');
  });

  it('un orders.status desconocido se presenta como pending/received, no terminal', () => {
    const t = toOrderTracking(record({ status: 'refunded', history: [] }), NOW);
    expect(t).toMatchObject({ status: 'pending', publicStatus: 'received', terminal: false });
    expect(JSON.stringify(t)).not.toContain('refunded');
  });
});

describe('R34 delivery.status público (F28, spec 029 §12)', () => {
  const own = (delivery: OrderTrackingRecord['delivery']) =>
    toOrderTracking(record({ fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN', delivery }), NOW)
      .delivery;

  it.each([
    ['pending', 'PENDING'],
    ['assigned', 'ASSIGNED'],
    ['picked_up', 'PICKED_UP'],
    ['delivered', 'DELIVERED'],
    ['returned', 'DELIVERED'],
  ])('entrega %s => status %s', (status, expected) => {
    expect(own({ status })).toEqual({ provider: 'OWN', status: expected });
  });

  it('sin entrega, cancelada o estado desconocido => status null', () => {
    expect(own(null)).toEqual({ provider: 'OWN', status: null });
    expect(own(undefined)).toEqual({ provider: 'OWN', status: null });
    expect(own({ status: 'cancelled' })).toEqual({ provider: 'OWN', status: null });
    expect(own({ status: 'otro' })).toEqual({ provider: 'OWN', status: null });
  });

  it('PEDIDOSYA => null aunque exista una fila (F29, BLOCKED_EXTERNAL); PICKUP => delivery null', () => {
    expect(
      toOrderTracking(
        record({
          fulfillmentType: 'DELIVERY',
          deliveryProvider: 'PEDIDOSYA',
          delivery: { status: 'assigned' },
        }),
        NOW,
      ).delivery,
    ).toEqual({ provider: 'PEDIDOSYA', status: null });
    expect(toOrderTracking(record({ delivery: { status: 'assigned' } }), NOW).delivery).toBeNull();
  });

  it('NUNCA expone datos del motorista, ids ni quién/por qué: la respuesta solo lleva provider y status', () => {
    const t = toOrderTracking(
      record({
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        delivery: {
          status: 'picked_up',
          riderId: 'RIDER-SECRETO',
          riderName: 'NOMBRE-SECRETO',
        } as never,
      }),
      NOW,
    );
    expect(Object.keys(t.delivery ?? {}).sort()).toEqual(['provider', 'status']);
    expect(JSON.stringify(t)).not.toMatch(/SECRETO|rider|phone|vehicle/i);
  });
});

describe('delivery y forma de la respuesta', () => {
  it('PICKUP => null; OWN y PEDIDOSYA => solo proveedor con status null', () => {
    expect(toOrderTracking(record(), NOW).delivery).toBeNull();
    for (const provider of ['OWN', 'PEDIDOSYA'] as const) {
      const t = toOrderTracking(
        record({ fulfillmentType: 'DELIVERY', deliveryProvider: provider }),
        NOW,
      );
      expect(t.delivery).toEqual({ provider, status: null });
    }
  });

  it('DELIVERY sin proveedor reconocido => null (no se inventa)', () => {
    expect(
      toOrderTracking(record({ fulfillmentType: 'DELIVERY', deliveryProvider: null }), NOW)
        .delivery,
    ).toBeNull();
  });

  it('claves exactas del contrato, displayNumber y fechas UTC; generatedAt = now', () => {
    const t = toOrderTracking(record(), NOW);
    expect(Object.keys(t).sort()).toEqual(
      [
        'orderId',
        'displayNumber',
        'branchId',
        'fulfillmentType',
        'status',
        'publicStatus',
        'terminal',
        'placedAt',
        'updatedAt',
        'generatedAt',
        'steps',
        'events',
        'eventsTruncated',
        'delivery',
        'payment',
        'pollAfterSeconds',
      ].sort(),
    );
    expect(t.displayNumber).toBe('MON-001042');
    expect(t.generatedAt).toBe(NOW.toISOString());
    expect(t.pollAfterSeconds).toBe(15);
    expect(Object.keys(t.events[0] ?? {}).sort()).toEqual([
      'occurredAt',
      'publicStatus',
      'seq',
      'status',
    ]);
  });

  it('es pura: no muta el registro de entrada', () => {
    const input = record({ history: [ev('accepted', 5), ev('pending', 0)] });
    const copy = structuredClone(input);
    toOrderTracking(input, NOW);
    expect(input).toEqual(copy);
  });

  it('buildSteps nunca excede 8 fases', () => {
    expect(buildSteps('DELIVERY', 'pending', []).length).toBeLessThanOrEqual(8);
  });
});

import {
  availableDeliveryActionsFor,
  COMMAND_SPECS,
  DELIVERY_STATUSES,
  deliveryTransitionAllowed,
  INVALID_REASON,
  normalizeDeliveryReason,
  OCCUPYING_STATUSES,
  OPEN_STATUSES,
  orderEligibilityViolations,
  ORDER_BLOCKING_STATUSES,
  publicDeliveryStatus,
  type DeliveryStatus,
} from './delivery-policy.js';

const all = () => true;
const none = () => false;
const names = (s: ReturnType<typeof availableDeliveryActionsFor>) => s.map((a) => a.action);

describe('R02 grafo de estados de la entrega (misma tabla que el trigger deliveries_guard)', () => {
  /** Lista EXACTA de pares del trigger de la migración 0022 (`deliveries_guard`) + la reasignación. */
  const TRIGGER_PAIRS = new Set([
    'pending>assigned',
    'assigned>pending',
    'assigned>picked_up',
    'picked_up>delivered',
    'delivered>returned',
    'pending>cancelled',
    'assigned>cancelled',
    'cancelled>pending',
  ]);

  it('barre los 36 pares: la API acepta exactamente los del trigger (y assigned→assigned solo con OTRO motorista)', () => {
    let accepted = 0;
    for (const from of DELIVERY_STATUSES) {
      for (const to of DELIVERY_STATUSES) {
        const expected =
          TRIGGER_PAIRS.has(`${from}>${to}`) || (from === 'assigned' && to === 'assigned');
        const actual =
          from === 'assigned' && to === 'assigned'
            ? deliveryTransitionAllowed(from, to, true)
            : deliveryTransitionAllowed(from, to);
        expect([from, to, actual]).toEqual([from, to, expected]);
        if (actual) accepted += 1;
      }
    }
    expect(accepted).toBe(9);
    expect(deliveryTransitionAllowed('assigned', 'assigned', false)).toBe(false);
  });

  it('los terminales no avanzan (returned) y cancelled solo se reabre; no hay saltos ni retrocesos', () => {
    for (const to of DELIVERY_STATUSES)
      expect(deliveryTransitionAllowed('returned', to)).toBe(false);
    expect(deliveryTransitionAllowed('cancelled', 'pending')).toBe(true);
    expect(deliveryTransitionAllowed('pending', 'picked_up')).toBe(false);
    expect(deliveryTransitionAllowed('picked_up', 'cancelled')).toBe(false);
    expect(deliveryTransitionAllowed('delivered', 'picked_up')).toBe(false);
    expect(deliveryTransitionAllowed('delivered', 'cancelled')).toBe(false);
  });

  it('conjuntos de estados: abiertos, que ocupan al motorista y que bloquean cancelar el pedido', () => {
    expect([...OPEN_STATUSES]).toEqual(['pending', 'assigned', 'picked_up', 'delivered']);
    expect([...OCCUPYING_STATUSES]).toEqual(['assigned', 'picked_up', 'delivered']);
    expect([...ORDER_BLOCKING_STATUSES]).toEqual(['pending', 'assigned', 'picked_up']);
  });

  it('tabla de comandos (spec §3.2): origen, destino, evento, permiso y pedido', () => {
    const row = (c: keyof typeof COMMAND_SPECS) => {
      const s = COMMAND_SPECS[c];
      return [s.route, [...s.from], s.to, s.event, [...s.permissions], s.order?.to ?? null];
    };
    expect(row('assign')).toEqual([
      'assign-own-rider',
      ['pending', 'assigned'],
      'assigned',
      'rider_assigned',
      ['deliveries.assign', 'riders.assign'],
      null,
    ]);
    expect(row('unassign')).toEqual([
      'unassign-rider',
      ['assigned'],
      'pending',
      'rider_unassigned',
      ['deliveries.assign'],
      null,
    ]);
    expect(row('mark_picked_up')).toEqual([
      'mark-picked-up',
      ['assigned'],
      'picked_up',
      'picked_up',
      ['deliveries.update'],
      'on_the_way',
    ]);
    expect(row('mark_delivered')).toEqual([
      'mark-delivered',
      ['picked_up'],
      'delivered',
      'delivered',
      ['deliveries.update'],
      'delivered',
    ]);
    expect(row('return_to_branch')).toEqual([
      'return-to-branch',
      ['delivered'],
      'returned',
      'returned',
      ['deliveries.update'],
      null,
    ]);
    expect(row('cancel')).toEqual([
      'cancel',
      ['pending', 'assigned'],
      'cancelled',
      'cancelled',
      ['deliveries.update'],
      null,
    ]);
    expect(COMMAND_SPECS.cancel.reason).toBe('required');
    expect(COMMAND_SPECS.unassign.reason).toBe('optional');
    expect(COMMAND_SPECS.mark_picked_up.order).toEqual({
      expected: 'ready',
      to: 'on_the_way',
      auditAction: 'order.dispatched',
    });
    expect(COMMAND_SPECS.mark_delivered.order?.auditAction).toBe('order.delivered');
  });
});

describe('R01 availableDeliveryActionsFor', () => {
  const of = (status: string, order = 'ready', canDo: (p: string) => boolean = all) =>
    availableDeliveryActionsFor({ status }, order, canDo);

  it('lista solo las acciones que existen para cada estado (misma tabla que los comandos)', () => {
    expect(names(of('pending'))).toEqual(['assign_rider', 'cancel']);
    expect(names(of('assigned'))).toEqual([
      'reassign_rider',
      'unassign_rider',
      'mark_picked_up',
      'cancel',
    ]);
    expect(names(of('picked_up'))).toEqual(['mark_delivered']);
    expect(names(of('delivered'))).toEqual(['return_to_branch']);
    expect(of('returned')).toEqual([]);
    expect(of('cancelled')).toEqual([]);
    expect(of('desconocido')).toEqual([]);
  });

  it('con permisos todo habilitado', () => {
    for (const status of DELIVERY_STATUSES) {
      for (const a of of(status)) expect(a).toMatchObject({ enabled: true, disabledReason: null });
    }
  });

  it('sin permiso => NO_PERMISSION (la web oculta); `staff` con solo deliveries.read no habilita nada', () => {
    const readOnly = (p: string) => p === 'deliveries.read';
    for (const status of ['pending', 'assigned', 'picked_up', 'delivered']) {
      for (const a of of(status, 'ready', readOnly)) {
        expect(a).toMatchObject({ enabled: false, disabledReason: 'NO_PERMISSION' });
      }
    }
  });

  it('asignar exige AMBOS permisos: deliveries.assign y riders.assign', () => {
    const only = (p: string) => p === 'deliveries.assign';
    expect(of('pending', 'ready', only)[0]).toEqual({
      action: 'assign_rider',
      enabled: false,
      disabledReason: 'NO_PERMISSION',
    });
    const both = (p: string) => p === 'deliveries.assign' || p === 'riders.assign';
    expect(of('pending', 'ready', both)[0]).toMatchObject({ enabled: true });
    expect(of('pending', 'ready', both)[1]).toMatchObject({ action: 'cancel', enabled: false });
  });

  it('desasignar usa deliveries.assign; recoger/entregar/retorno/cancelar usan deliveries.update', () => {
    const assignOnly = (p: string) => p === 'deliveries.assign';
    expect(of('assigned', 'ready', assignOnly).map((a) => [a.action, a.enabled])).toEqual([
      ['reassign_rider', false],
      ['unassign_rider', true],
      ['mark_picked_up', false],
      ['cancel', false],
    ]);
    const updateOnly = (p: string) => p === 'deliveries.update';
    expect(of('assigned', 'ready', updateOnly).map((a) => [a.action, a.enabled])).toEqual([
      ['reassign_rider', false],
      ['unassign_rider', false],
      ['mark_picked_up', true],
      ['cancel', true],
    ]);
  });

  it('ORDER_NOT_READY: recoger con el pedido aún en accepted|preparing queda deshabilitada (NO_PERMISSION tiene prioridad)', () => {
    for (const orderStatus of ['accepted', 'preparing']) {
      const pick = of('assigned', orderStatus).find((a) => a.action === 'mark_picked_up');
      expect(pick).toEqual({
        action: 'mark_picked_up',
        enabled: false,
        disabledReason: 'ORDER_NOT_READY',
      });
    }
    expect(of('assigned', 'ready').find((a) => a.action === 'mark_picked_up')?.enabled).toBe(true);
    expect(of('assigned', 'preparing', none).find((a) => a.action === 'mark_picked_up')).toEqual({
      action: 'mark_picked_up',
      enabled: false,
      disabledReason: 'NO_PERMISSION',
    });
  });
});

describe('elegibilidad del pedido y motivo', () => {
  it('orderEligibilityViolations', () => {
    const ok = { status: 'ready', fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN' };
    expect(orderEligibilityViolations(ok)).toEqual([]);
    expect(orderEligibilityViolations({ ...ok, status: 'pending' })).toEqual([
      'ORDER_STATUS_NOT_DISPATCHABLE',
    ]);
    expect(orderEligibilityViolations({ ...ok, deliveryProvider: 'PEDIDOSYA' })).toEqual([
      'ORDER_PROVIDER_NOT_OWN',
    ]);
    expect(
      orderEligibilityViolations({
        status: 'ready',
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
      }),
    ).toEqual(['ORDER_NOT_DELIVERY']);
    expect(
      orderEligibilityViolations({
        status: 'delivered',
        fulfillmentType: 'DELIVERY',
        deliveryProvider: null,
      }),
    ).toEqual(['ORDER_STATUS_NOT_DISPATCHABLE', 'ORDER_PROVIDER_NOT_OWN']);
  });

  it('normalizeDeliveryReason: obligatorio/opcional, recorte, 3..280 y sin caracteres de control o de formato', () => {
    expect(normalizeDeliveryReason('  hola  ', 'required')).toBe('hola');
    expect(normalizeDeliveryReason(undefined, 'optional')).toBeNull();
    expect(normalizeDeliveryReason(undefined, 'required')).toBe(INVALID_REASON);
    for (const bad of ['', '  ', 'ab', 'x'.repeat(281), 'a\u0000b', 'a\nb', 'a​b', 'a‮b', 'a b']) {
      expect([bad, normalizeDeliveryReason(bad, 'required')]).toEqual([bad, INVALID_REASON]);
      expect([bad, normalizeDeliveryReason(bad, 'optional')]).toEqual([bad, INVALID_REASON]);
    }
    expect(normalizeDeliveryReason('x'.repeat(280), 'required')).toHaveLength(280);
    expect(normalizeDeliveryReason('abc', 'optional')).toBe('abc');
  });
});

describe('R34 publicDeliveryStatus (F21): estado grueso sin datos del motorista', () => {
  it.each([
    ['pending', 'PENDING'],
    ['assigned', 'ASSIGNED'],
    ['picked_up', 'PICKED_UP'],
    ['delivered', 'DELIVERED'],
    ['returned', 'DELIVERED'],
    ['cancelled', null],
    ['otro', null],
    [null, null],
    [undefined, null],
  ])('%s => %s', (status, expected) => {
    expect(publicDeliveryStatus(status as DeliveryStatus | null | undefined)).toBe(expected);
  });
});

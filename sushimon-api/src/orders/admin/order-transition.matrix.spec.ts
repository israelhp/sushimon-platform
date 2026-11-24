import {
  availableActionsFor,
  COMMAND_SPECS,
  evaluateTransition,
  ORDER_STATUSES,
  type OrderCommand,
  type ViolationCode,
} from './order-transition.matrix.js';

const PICKUP = { fulfillmentType: 'PICKUP', deliveryProvider: null };
const OWN = { fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN' };
const PYA = { fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA' };
const MODES = { PICKUP, OWN, PEDIDOSYA: PYA } as const;
type Mode = keyof typeof MODES;

type Expect = 'ok' | ViolationCode;
const ALL: Mode[] = ['PICKUP', 'OWN', 'PEDIDOSYA'];
const same = (e: Expect): Record<Mode, Expect> => ({ PICKUP: e, OWN: e, PEDIDOSYA: e });

/** Tabla EXACTA del spec §3.2 (fila por par origen → destino; los pares no listados son ORDER_SOURCE_INVALID). */
const TABLE: [string, string, Record<Mode, Expect>][] = [
  ['pending', 'accepted', same('ok')],
  ['pending', 'rejected', same('ok')],
  ['pending', 'cancelled', same('ok')],
  ['accepted', 'preparing', same('ok')],
  ['accepted', 'cancelled', same('ok')],
  ['preparing', 'ready', same('ok')],
  ['preparing', 'cancelled', same('ok')],
  ['ready', 'cancelled', same('ok')],
  [
    'ready',
    'picked_up',
    { PICKUP: 'ok', OWN: 'ORDER_FULFILLMENT_MISMATCH', PEDIDOSYA: 'ORDER_FULFILLMENT_MISMATCH' },
  ],
  [
    'ready',
    'on_the_way',
    {
      PICKUP: 'ORDER_FULFILLMENT_MISMATCH',
      OWN: 'ORDER_DISPATCH_NOT_AVAILABLE',
      PEDIDOSYA: 'ORDER_PROVIDER_BLOCKED_EXTERNAL',
    },
  ],
  [
    'on_the_way',
    'delivered',
    {
      PICKUP: 'ORDER_SOURCE_INVALID',
      OWN: 'ORDER_DISPATCH_NOT_AVAILABLE',
      PEDIDOSYA: 'ORDER_PROVIDER_BLOCKED_EXTERNAL',
    },
  ],
  [
    'on_the_way',
    'cancelled',
    {
      PICKUP: 'ORDER_SOURCE_INVALID',
      OWN: 'ORDER_CANCEL_NOT_ALLOWED',
      PEDIDOSYA: 'ORDER_CANCEL_NOT_ALLOWED',
    },
  ],
];

describe('matriz de transiciones (spec 023 §3.2, fila 1)', () => {
  const listed = new Set(TABLE.map(([f, t]) => `${f}>${t}`));

  for (const [from, to, expected] of TABLE) {
    for (const mode of ALL) {
      it(`${from} -> ${to} en ${mode}: ${expected[mode]}`, () => {
        const verdict = evaluateTransition(from, to, MODES[mode]);
        if (expected[mode] === 'ok') expect(verdict).toEqual({ ok: true });
        else expect(verdict).toEqual({ ok: false, code: expected[mode] });
      });
    }
  }

  it('cualquier origen terminal => ORDER_TERMINAL para todo destino y modalidad', () => {
    for (const from of ['delivered', 'picked_up', 'rejected', 'cancelled']) {
      for (const to of ORDER_STATUSES) {
        for (const mode of ALL) {
          expect(evaluateTransition(from, to, MODES[mode])).toEqual({
            ok: false,
            code: 'ORDER_TERMINAL',
          });
        }
      }
    }
  });

  it('cualquier otro par (salto, retroceso, idéntico) => ORDER_SOURCE_INVALID en toda modalidad', () => {
    for (const from of ['pending', 'accepted', 'preparing', 'ready', 'on_the_way']) {
      for (const to of ORDER_STATUSES) {
        if (listed.has(`${from}>${to}`)) continue;
        for (const mode of ALL) {
          expect(evaluateTransition(from, to, MODES[mode])).toEqual({
            ok: false,
            code: 'ORDER_SOURCE_INVALID',
          });
        }
      }
    }
  });

  it('estados fuera del catálogo nunca se permiten', () => {
    expect(evaluateTransition('hacked', 'accepted', PICKUP)).toEqual({
      ok: false,
      code: 'ORDER_SOURCE_INVALID',
    });
    expect(evaluateTransition('pending', 'hacked', PICKUP)).toEqual({
      ok: false,
      code: 'ORDER_SOURCE_INVALID',
    });
  });

  it('F28: con allowOwnDispatch la entrega propia despacha y entrega; PEDIDOSYA sigue bloqueado', () => {
    const opt = { allowOwnDispatch: true };
    expect(evaluateTransition('ready', 'on_the_way', OWN, opt)).toEqual({ ok: true });
    expect(evaluateTransition('on_the_way', 'delivered', OWN, opt)).toEqual({ ok: true });
    expect(evaluateTransition('ready', 'on_the_way', PYA, opt)).toEqual({
      ok: false,
      code: 'ORDER_PROVIDER_BLOCKED_EXTERNAL',
    });
  });
});

describe('comandos de F22 contra la matriz (cada comando × estado × modalidad)', () => {
  const expectedOk: Record<OrderCommand, Record<string, Mode[]>> = {
    accept: { pending: ALL },
    reject: { pending: ALL },
    start_preparing: { accepted: ALL },
    mark_ready: { preparing: ALL },
    complete: { ready: ['PICKUP'] },
    cancel: { pending: ALL, accepted: ALL, preparing: ALL, ready: ALL },
  };
  for (const command of Object.keys(COMMAND_SPECS) as OrderCommand[]) {
    it(`${command}: permitido SOLO donde el spec lo indica`, () => {
      for (const from of ORDER_STATUSES) {
        for (const mode of ALL) {
          const ok = evaluateTransition(from, COMMAND_SPECS[command].to, MODES[mode]).ok;
          expect(ok).toBe(expectedOk[command][from]?.includes(mode) ?? false);
        }
      }
    });
  }

  it('permisos por comando (sin permisos legados) y motivo solo en reject/cancel', () => {
    expect(
      Object.values(COMMAND_SPECS).map((s) => [s.command, s.permission, s.reasonRequired]),
    ).toEqual([
      ['accept', 'orders.accept', false],
      ['reject', 'orders.reject', true],
      ['start_preparing', 'orders.prepare', false],
      ['mark_ready', 'orders.prepare', false],
      ['complete', 'orders.complete', false],
      ['cancel', 'orders.cancel', true],
    ]);
  });
});

describe('availableActionsFor (fila 2)', () => {
  const all = () => true;
  const none = () => false;
  const names = (s: ReturnType<typeof availableActionsFor>) => s.map((a) => a.action);

  it('lista solo las acciones que existen para el estado y la modalidad', () => {
    const of = (
      status: string,
      f: { fulfillmentType: string; deliveryProvider: string | null } = PICKUP,
    ) => names(availableActionsFor({ status, ...f }, all));
    expect(of('pending')).toEqual(['accept', 'reject', 'cancel']);
    expect(of('accepted')).toEqual(['start_preparing', 'cancel']);
    expect(of('preparing')).toEqual(['mark_ready', 'cancel']);
    expect(of('ready')).toEqual(['complete', 'cancel']);
    expect(of('ready', OWN)).toEqual(['cancel', 'dispatch']);
    expect(of('ready', PYA)).toEqual(['cancel', 'dispatch']);
    for (const s of ['on_the_way', 'delivered', 'picked_up', 'rejected', 'cancelled']) {
      expect(of(s, OWN)).toEqual([]);
    }
  });

  it('sin permiso => enabled=false con NO_PERMISSION; con permiso => enabled', () => {
    expect(availableActionsFor({ status: 'pending', ...PICKUP }, none)).toEqual([
      { action: 'accept', enabled: false, disabledReason: 'NO_PERMISSION' },
      { action: 'reject', enabled: false, disabledReason: 'NO_PERMISSION' },
      { action: 'cancel', enabled: false, disabledReason: 'NO_PERMISSION' },
    ]);
    const kitchen = (p: string) => p !== 'orders.cancel';
    expect(availableActionsFor({ status: 'pending', ...PICKUP }, kitchen)).toEqual([
      { action: 'accept', enabled: true, disabledReason: null },
      { action: 'reject', enabled: true, disabledReason: null },
      { action: 'cancel', enabled: false, disabledReason: 'NO_PERMISSION' },
    ]);
  });

  // R34/R33 (F28, spec 029 §11 F22-5b): `dispatch` pasa a HABILITADA para OWN con `deliveries.assign`.
  describe('dispatch (F28)', () => {
    const d = (
      f: { fulfillmentType: string; deliveryProvider: string | null },
      canDo: (p: string) => boolean,
    ) => availableActionsFor({ status: 'ready', ...f }, canDo).find((a) => a.action === 'dispatch');

    it('OWN con deliveries.assign => habilitada', () => {
      expect(d(OWN, all)).toEqual({ action: 'dispatch', enabled: true, disabledReason: null });
    });

    it('OWN sin deliveries.assign => NO_PERMISSION aunque tenga el resto de permisos de pedidos', () => {
      expect(d(OWN, (p) => p !== 'deliveries.assign')).toEqual({
        action: 'dispatch',
        enabled: false,
        disabledReason: 'NO_PERMISSION',
      });
      expect(d(OWN, none)).toEqual({
        action: 'dispatch',
        enabled: false,
        disabledReason: 'NO_PERMISSION',
      });
    });

    it('el permiso se consulta con el nombre exacto `deliveries.assign` (no con orders.*)', () => {
      const asked: string[] = [];
      d(OWN, (p) => {
        asked.push(p);
        return true;
      });
      expect(asked).toContain('deliveries.assign');
      expect(asked.filter((p) => p.startsWith('orders.dispatch'))).toEqual([]);
    });

    it('PEDIDOSYA sigue deshabilitada con PROVIDER_BLOCKED_EXTERNAL, tenga o no permiso', () => {
      for (const canDo of [all, none]) {
        expect(d(PYA, canDo)).toEqual({
          action: 'dispatch',
          enabled: false,
          disabledReason: 'PROVIDER_BLOCKED_EXTERNAL',
        });
      }
    });

    it('proveedor desconocido (null) => DISPATCH_NOT_AVAILABLE (valor heredado)', () => {
      expect(d({ fulfillmentType: 'DELIVERY', deliveryProvider: null }, all)).toEqual({
        action: 'dispatch',
        enabled: false,
        disabledReason: 'DISPATCH_NOT_AVAILABLE',
      });
    });

    it('solo existe en `ready` y en DELIVERY: el resto de acciones no cambia', () => {
      for (const status of ['pending', 'accepted', 'preparing', 'on_the_way', 'delivered']) {
        expect(names(availableActionsFor({ status, ...OWN }, all)).includes('dispatch')).toBe(
          false,
        );
      }
      expect(names(availableActionsFor({ status: 'ready', ...PICKUP }, all))).toEqual([
        'complete',
        'cancel',
      ]);
    });
  });
});

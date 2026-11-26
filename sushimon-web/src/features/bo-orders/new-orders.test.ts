import { describe, expect, it } from 'vitest';
import type { AdminOrderBoard, AdminOrderSummary } from '@/lib/data-access/models';
import { clearFresh, initialNewOrders, nextNewOrders } from './new-orders';

const item = (id: string): AdminOrderSummary => ({
  id,
  orderNumber: 1,
  displayNumber: `MON-${id}`,
  status: 'pending',
  branchId: 'b',
  branchName: 'B',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  customerName: 'X',
  itemCount: 1,
  total: '1.00',
  paymentMethodPreference: null,
  paymentStatus: 'PENDING',
  placedAt: '2026-11-18T18:00:00.000Z',
  updatedAt: '2026-11-18T18:00:00.000Z',
  availableActions: [],
});
const board = (generatedAt: string, ids: string[]): AdminOrderBoard => ({
  generatedAt,
  branchId: null,
  terminalWindowHours: 24,
  pollAfterSeconds: 15,
  summary: { pending: ids.length, active: ids.length, oldestPendingAt: null },
  columns: [{ status: 'pending', count: ids.length, hasMore: false, items: ids.map(item) }],
});

describe('detección de pedidos nuevos entre sondeos', () => {
  it('el PRIMER sondeo fija la línea base y no avisa', () => {
    const s = nextNewOrders(initialNewOrders('k'), 'k', board('t1', ['a', 'b']));
    expect(s.fresh.size).toBe(0);
    expect(s.batch).toBe(0);
    expect(s.known).toEqual(new Set(['a', 'b']));
  });

  it('sin datos todavía no cambia nada', () => {
    const initial = initialNewOrders('k');
    expect(nextNewOrders(initial, 'k', undefined)).toBe(initial);
  });

  it('ids nuevos → resaltado, tanda y números de la tanda', () => {
    let s = nextNewOrders(initialNewOrders('k'), 'k', board('t1', ['a']));
    s = nextNewOrders(s, 'k', board('t2', ['a', 'b', 'c']));
    expect([...s.fresh].sort()).toEqual(['b', 'c']);
    expect(s.batch).toBe(1);
    expect(s.lastBatch).toEqual(['MON-b', 'MON-c']);
  });

  it('el mismo sondeo (mismo generatedAt) no cuenta dos veces', () => {
    let s = nextNewOrders(initialNewOrders('k'), 'k', board('t1', ['a']));
    s = nextNewOrders(s, 'k', board('t2', ['a', 'b']));
    const again = nextNewOrders(s, 'k', board('t2', ['a', 'b']));
    expect(again).toBe(s);
  });

  it('un pedido ya marcado no vuelve a marcarse como nuevo (aunque salga y reaparezca)', () => {
    let s = nextNewOrders(initialNewOrders('k'), 'k', board('t1', ['a']));
    s = nextNewOrders(s, 'k', board('t2', ['a', 'b']));
    s = clearFresh(s);
    expect(s.fresh.size).toBe(0);
    s = nextNewOrders(s, 'k', board('t3', ['a']));
    s = nextNewOrders(s, 'k', board('t4', ['a', 'b']));
    expect(s.fresh.size).toBe(0);
    expect(s.batch).toBe(1);
  });

  it('un nuevo que ya no está pendiente deja de estar resaltado', () => {
    let s = nextNewOrders(initialNewOrders('k'), 'k', board('t1', ['a']));
    s = nextNewOrders(s, 'k', board('t2', ['a', 'b']));
    s = nextNewOrders(s, 'k', board('t3', ['a']));
    expect(s.fresh.size).toBe(0);
  });

  it('cambiar de persona o sucursal (clave) reinicia la línea base: no avisa por los pedidos de la otra', () => {
    let s = nextNewOrders(initialNewOrders('p1|all'), 'p1|all', board('t1', ['a']));
    s = nextNewOrders(s, 'p1|all', board('t2', ['a', 'b']));
    expect(s.batch).toBe(1);
    s = nextNewOrders(s, 'p1|suc2', board('t3', ['x', 'y']));
    expect(s.key).toBe('p1|suc2');
    expect(s.batch).toBe(0);
    expect(s.fresh.size).toBe(0);
  });
});

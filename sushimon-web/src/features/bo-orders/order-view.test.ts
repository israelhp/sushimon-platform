import { describe, expect, it } from 'vitest';
import { grantsForRole } from '@/mocks/testing';
import type { Order } from '@/lib/data-access/models';
import { createFixedClock } from '@/mocks/clock';
import { createSeedStore } from '@/mocks/seed';
import {
  countByColumn,
  dispatchBlockedForRole,
  filterOrders,
  groupByColumn,
  isActive,
  isLate,
  itemCount,
  matchesSearch,
  minutesSince,
  nextAction,
  progressSteps,
  sortForTable,
  trackSteps,
  waitParts,
} from './order-view';

const now = createFixedClock().now();
const orders = createSeedStore().orders;
const byId = (id: string): Order => {
  const order = orders.find((o) => o.id === id);
  if (!order) throw new Error(`Pedido de prueba inexistente: ${id}`);
  return order;
};

describe('tiempo transcurrido', () => {
  it('cuenta minutos desde la creación con el reloj de la demo y nunca es negativo', () => {
    expect(minutesSince(byId('MON-307057'), now)).toBe(8);
    expect(
      minutesSince({ createdAt: new Date(now.getTime() + 5 * 60_000).toISOString() }, now),
    ).toBe(0);
    expect(minutesSince(byId('MON-307057'), null)).toBe(0);
  });

  it('marca como atrasado un pedido nuevo con más de 5 minutos', () => {
    expect(isLate(byId('MON-307057'), now)).toBe(true); // 8 min
    expect(isLate(byId('MON-307058'), now)).toBe(false); // 3 min
    expect(isLate(byId('MON-307055'), now)).toBe(false); // aceptado: no aplica
  });

  it('descompone la espera como el prototipo (ahora · min · h min)', () => {
    expect(waitParts(0)).toEqual({ kind: 'now' });
    expect(waitParts(45)).toEqual({ kind: 'minutes', minutes: 45 });
    expect(waitParts(75)).toEqual({ kind: 'hours', hours: 1, minutes: 15 });
  });
});

describe('tablero y tabla', () => {
  const live = orders.filter((o) => o.id.startsWith('MON-3070'));

  it('agrupa por columna del prototipo y ordena lo más antiguo primero', () => {
    const groups = groupByColumn(live);
    expect(groups.nuevo.map((o) => o.id)).toEqual(['MON-307057', 'MON-307058']);
    expect(groups.listo.length).toBe(3);
    expect(countByColumn(live).nuevo).toBe(2);
  });

  it('ordena la tabla con lo más reciente primero', () => {
    const rows = sortForTable(live);
    expect(rows[0]?.id).toBe('MON-307058');
  });

  it('busca por número o cliente sin distinguir mayúsculas', () => {
    expect(matchesSearch(byId('MON-307057'), '307057')).toBe(true);
    expect(matchesSearch(byId('MON-307057'), 'pablo')).toBe(true);
    expect(matchesSearch(byId('MON-307057'), 'zzz')).toBe(false);
    expect(matchesSearch(byId('MON-307057'), '  ')).toBe(true);
  });

  it('filtra por tipo y sucursal', () => {
    const delivery = filterOrders(live, { query: '', type: 'delivery', branchId: undefined });
    expect(delivery.every((o) => o.fulfillment === 'delivery')).toBe(true);
    const s1 = filterOrders(live, { query: '', type: 'todos', branchId: 'sucursal-1' });
    expect(s1.length).toBeGreaterThan(0);
    expect(s1.every((o) => o.branchId === 'sucursal-1')).toBe(true);
  });

  it('suma productos y distingue pedidos en curso', () => {
    expect(itemCount(byId('MON-307057'))).toBe(4);
    expect(isActive(byId('MON-307057'))).toBe(true);
  });
});

describe('detalle del pedido', () => {
  it('omite "En camino" en la barra de avance de recoger en tienda', () => {
    const pickup = progressSteps(byId('MON-307057')).map((s) => s.column);
    expect(pickup).not.toContain('en_camino');
    const delivery = progressSteps(byId('MON-307058')).map((s) => s.column);
    expect(delivery).toContain('en_camino');
    expect(progressSteps(byId('MON-307057'))[0]?.state).toBe('cur');
  });

  it('dibuja la línea logística de PedidosYa (6 pasos) y del repartidor propio (3)', () => {
    const withDelivery = orders.filter((o) => o.delivery);
    const py = withDelivery.find((o) => o.delivery?.provider === 'pedidosya');
    expect(py && trackSteps(py.delivery!).length).toBe(6);
    const own = withDelivery.find((o) => o.delivery?.provider === 'own');
    if (own) expect(trackSteps(own.delivery!).length).toBe(3);
  });
});

describe('acciones por rol', () => {
  const ready = byId('MON-307052'); // listo, delivery, sin repartidor
  const accepted = byId('MON-307055');

  it('el encargado despacha; cocina solo ve un bloqueo informativo', () => {
    expect(nextAction(ready, grantsForRole('manager'))).toBe('dispatch');
    expect(nextAction(ready, grantsForRole('kitchen'))).toBeNull();
    expect(dispatchBlockedForRole(ready, grantsForRole('kitchen'))).toBe(true);
    expect(dispatchBlockedForRole(ready, grantsForRole('manager'))).toBe(false);
  });

  it('cocina avanza preparación pero no entrega a domicilio', () => {
    expect(nextAction(accepted, grantsForRole('kitchen'))).toBe('prepare');
    expect(nextAction(byId('MON-307050'), grantsForRole('kitchen'))).toBe('deliver'); // recoger en tienda
  });
});

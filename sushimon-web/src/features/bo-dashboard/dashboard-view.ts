import type { DashboardAlert, Order } from '@/lib/data-access/models';

/** Tono del ícono de cada alerta (a-red / a-amber / a-blue del prototipo). */
export function alertTone(type: DashboardAlert['type']): 'a-red' | 'a-amber' | 'a-blue' {
  return type === 'unaccepted' ? 'a-red' : type === 'no_rider' ? 'a-amber' : 'a-blue';
}

/** Los N pedidos más recientes (los más nuevos primero), como "Últimos pedidos" del prototipo. */
export function latestOrders(orders: readonly Order[], limit: number): Order[] {
  return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

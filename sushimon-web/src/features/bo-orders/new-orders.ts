import type { AdminOrderBoard } from '@/lib/data-access/models';

/**
 * F22 (spec 023 §10.4) — Detección PURA de pedidos nuevos entre sondeos. El primer sondeo de una clave (persona + sucursal) fija la
 * LÍNEA BASE y no avisa; después, solo los ids `pending` que nunca se habían visto cuentan como nuevos (un mismo pedido no se vuelve
 * a marcar). Todo en memoria: nada se persiste.
 */
export interface NewOrdersState {
  key: string;
  /** Marca del último sondeo procesado (`null` = aún sin datos): cambia en cada respuesta, aunque el servidor repita `generatedAt`. */
  stamp: string | number | null;
  known: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  /** Cambia (sube) solo cuando llega una tanda con pedidos nuevos. */
  batch: number;
  /** Números visibles de la última tanda (para el aviso de lectura). */
  lastBatch: readonly string[];
}

export const initialNewOrders = (key: string): NewOrdersState => ({
  key,
  stamp: null,
  known: new Set(),
  fresh: new Set(),
  batch: 0,
  lastBatch: [],
});

const pendingOf = (board: AdminOrderBoard) =>
  board.columns.find((c) => c.status === 'pending')?.items ?? [];

export function nextNewOrders(
  prev: NewOrdersState,
  key: string,
  board: AdminOrderBoard | undefined,
  /** Identifica el sondeo (p. ej. `dataUpdatedAt`); por defecto `generatedAt`. Un mismo valor no se procesa dos veces. */
  stamp: string | number | undefined = board?.generatedAt,
): NewOrdersState {
  if (prev.key !== key) return nextNewOrders(initialNewOrders(key), key, board, stamp);
  if (!board || stamp === undefined || stamp === prev.stamp) return prev;
  const pending = pendingOf(board);
  const ids = new Set(pending.map((o) => o.id));
  if (prev.stamp === null) {
    return { ...prev, stamp, known: ids, fresh: new Set() };
  }
  const added = pending.filter((o) => !prev.known.has(o.id));
  const known = new Set([...prev.known, ...ids]);
  // Un pedido que ya no está pendiente deja de estar resaltado.
  const fresh = new Set([...prev.fresh, ...added.map((o) => o.id)].filter((id) => ids.has(id)));
  return {
    key,
    stamp,
    known,
    fresh,
    batch: added.length > 0 ? prev.batch + 1 : prev.batch,
    lastBatch: added.length > 0 ? added.map((o) => o.displayNumber) : prev.lastBatch,
  };
}

export const clearFresh = (state: NewOrdersState): NewOrdersState =>
  state.fresh.size === 0 ? state : { ...state, fresh: new Set() };

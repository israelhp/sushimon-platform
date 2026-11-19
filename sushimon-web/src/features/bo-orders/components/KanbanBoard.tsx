'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useBoardFeed } from '../board-feed';
import type { BoardGroup, BoardGroupKey } from '../admin-orders-model';
import { OrderCard } from './OrderCard';

/** Punto de color de cada columna del tablero (ST_DOT del prototipo). */
const GROUP_DOT: Record<BoardGroupKey, string> = {
  nuevo: 'k-coral',
  aceptado: 'k-neutral',
  preparacion: 'k-amber',
  listo: 'k-violet',
  en_camino: 'k-blue',
  finalizados: 'k-green',
};

/**
 * Tablero kanban real: Nuevo · Aceptado · Preparación · Listo · En camino · Finalizados. Los conteos son los REALES del servidor y
 * «+N más» apunta a la tabla filtrada. El orden de cada columna lo decide el servidor (activas: más antiguas primero).
 */
export function KanbanBoard({
  groups,
  onShowAll,
}: {
  groups: readonly BoardGroup[];
  onShowAll: (group: BoardGroup) => void;
}) {
  const t = useTranslations('backoffice.orders.live');
  const feed = useBoardFeed();
  const oldestPendingId = feed.board?.columns.find((c) => c.status === 'pending')?.items[0]?.id;

  return (
    <>
      <div className="board">
        {groups.map((group) => {
          const hidden = Math.max(0, group.count - group.items.length);
          return (
            <section
              key={group.key}
              className={cn('kcol', group.key === 'nuevo' && group.count > 0 && 'hot')}
              aria-label={t(`board.groups.${group.key}`)}
            >
              <div className="kcol-h">
                <span className={cn('kdot', GROUP_DOT[group.key])} aria-hidden="true" />
                <span className="kcol-t">{t(`board.groups.${group.key}`)}</span>
                {group.key === 'nuevo' && feed.freshCount > 0 ? (
                  <span className="count-chip fresh-chip">
                    {t('board.freshCount', { count: feed.freshCount })}
                  </span>
                ) : null}
                <span className="count-chip">{group.count}</span>
              </div>
              <div className="kcol-hint">{t(`board.hints.${group.key}`)}</div>
              {group.items.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  serverNow={feed.serverNow}
                  fresh={feed.fresh.has(order.id)}
                  oldest={order.id === oldestPendingId && group.key === 'nuevo' && group.count > 1}
                />
              ))}
              {group.count === 0 ? (
                <div className="kempty">{t(`board.empties.${group.key}`)}</div>
              ) : null}
              {hidden > 0 || (group.hasMore && group.items.length > 0) ? (
                <button type="button" className="link-btn" onClick={() => onShowAll(group)}>
                  {t('board.more', { count: Math.max(1, hidden) })}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="sm" style={{ fontWeight: 600 }}>
        {t('board.hint')}
      </div>
    </>
  );
}

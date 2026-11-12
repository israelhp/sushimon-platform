'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { Order } from '@/lib/data-access/models';
import { BACKOFFICE_COLUMNS } from '@/lib/order-status';
import { groupByColumn } from '../order-view';
import { COLUMN_DOT } from '../use-order-text';
import { OrderCard } from './OrderCard';

/** Tablero kanban: Nuevo · Aceptado · Preparación · Listo · En camino · Entregado. */
export function KanbanBoard({ orders, now }: { orders: readonly Order[]; now: Date | null }) {
  const t = useTranslations('backoffice.orders');
  const groups = groupByColumn(orders);
  const DELIVERED_LIMIT = 10;
  return (
    <>
      <div className="board">
        {BACKOFFICE_COLUMNS.map((column) => {
          const all = groups[column];
          // "Entregado" acumula todo el día: se muestran los más recientes y el resto queda en la tabla.
          const items = column === 'entregado' ? all.slice(0, DELIVERED_LIMIT) : all;
          return (
            <section
              key={column}
              className={cn('kcol', column === 'nuevo' && all.length > 0 && 'hot')}
              aria-label={t(`columns.${column}`)}
            >
              <div className="kcol-h">
                <span className={cn('kdot', COLUMN_DOT[column])} aria-hidden="true" />
                <span className="kcol-t">{t(`columns.${column}`)}</span>
                <span className="count-chip">{all.length}</span>
              </div>
              <div className="kcol-hint">{t(`hints.${column}`)}</div>
              {items.map((order) => (
                <OrderCard key={order.id} order={order} now={now} />
              ))}
              {all.length === 0 ? <div className="kempty">{t(`empties.${column}`)}</div> : null}
              {all.length > items.length ? (
                <div className="kempty">
                  {t('moreDelivered', { shown: items.length, total: all.length })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="sm" style={{ fontWeight: 600 }}>
        {t('boardHint')}
      </div>
    </>
  );
}

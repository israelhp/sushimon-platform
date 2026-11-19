'use client';

import { useTranslations } from 'next-intl';
import { IconCheck } from '@/components/icons/bo';
import { cn } from '@/lib/cn';
import type { AdminOrderActionState, AdminOrderSummary } from '@/lib/data-access/models';
import { dispatchInfo, primaryAction } from '../admin-orders-model';
import { useAdminOrderActions, type ActionResult } from '../use-admin-order-actions';
import { ACTION_CLASS, useAdminOrderText } from '../use-admin-order-text';

/**
 * Botón de la acción de avance del pedido (aceptar, iniciar preparación, marcar listo, completar). La acción sale de
 * `availableActions` del servidor: si la persona no tiene permiso o no aplica, no hay botón. Mientras la solicitud está en vuelo
 * queda deshabilitado con `aria-busy` (anti doble clic; el servidor además compara `expectedStatus`).
 */
export function PrimaryActionButton({
  order,
  short = false,
  block = false,
  withIcon = false,
  onResult,
}: {
  order: AdminOrderSummary;
  short?: boolean;
  block?: boolean;
  withIcon?: boolean;
  /** El resultado (éxito o error explicado) para quien necesite dejarlo visible, p. ej. el detalle. */
  onResult?: (result: ActionResult) => void;
}) {
  const text = useAdminOrderText();
  const actions = useAdminOrderActions();
  const action = primaryAction(order);
  if (!action) return null;
  const busy = actions.pending && actions.pendingId === order.id;
  return (
    <button
      type="button"
      className={cn('btn sm', block && 'block', ACTION_CLASS[action])}
      disabled={busy}
      aria-busy={busy}
      onClick={() => void actions.run(order, action).then((r) => onResult?.(r))}
    >
      {withIcon ? <IconCheck /> : null}
      {text.actionLabel(action as AdminOrderActionState['action'], short)}
    </button>
  );
}

/**
 * «Despachar» SIEMPRE deshabilitada y con la explicación honesta (reparto propio → F28; PedidosYa → integración pendiente). Nunca
 * simula éxito ni llama a ningún proveedor.
 */
export function DispatchNotice({
  order,
  compact = false,
}: {
  order: AdminOrderSummary;
  compact?: boolean;
}) {
  const t = useTranslations('backoffice.orders.live');
  const text = useAdminOrderText();
  const info = dispatchInfo(order);
  if (!info) return null;
  const note = text.dispatchNote(info);
  return (
    <div className={compact ? 'dispatch-note' : undefined}>
      <button type="button" className="btn sm block" disabled aria-disabled="true" title={note}>
        {t('actions.dispatch')}
      </button>
      <span className="xs muted" style={{ fontWeight: 600, display: 'block', marginTop: 4 }}>
        {compact ? text.dispatchNote(info) : note}
      </span>
    </div>
  );
}

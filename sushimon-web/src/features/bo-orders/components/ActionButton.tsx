'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { IconCheck } from '@/components/icons/bo';
import { cn } from '@/lib/cn';
import type { AdminOrderActionState, AdminOrderSummary } from '@/lib/data-access/models';
import { dispatchEnabled, dispatchInfo, primaryAction } from '../admin-orders-model';
import { DELIVERY_PARAM } from '@/features/bo-deliveries/components/OwnDeliveriesView';
import { useDeliveryActions } from '@/features/bo-deliveries/use-delivery-actions';
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
 * «Despachar» (F28, spec 029 §11 F22-5b): con reparto PROPIO y `deliveries.assign` el servidor la habilita y la web solo ABRE
 * Entregas (crea la entrega, idempotente, y asigna allí al motorista). Con PedidosYa sigue deshabilitada con la explicación honesta
 * (integración pendiente): nunca simula éxito ni llama a ningún proveedor.
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
  if (dispatchEnabled(order)) return <OwnDispatchButton order={order} compact={compact} />;
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

/** Crea (o recupera, idempotente) la entrega del pedido y abre Entregas con su detalle para asignar al motorista. */
function OwnDispatchButton({ order, compact }: { order: AdminOrderSummary; compact: boolean }) {
  const t = useTranslations('backoffice.orders.live');
  const td = useTranslations('backoffice.orders.live.dispatchOwn');
  const router = useRouter();
  const actions = useDeliveryActions();
  const [error, setError] = useState<string | null>(null);
  const busy = actions.pending;

  const dispatch = async () => {
    setError(null);
    const result = await actions.run({ kind: 'create', orderId: order.id }, order.displayNumber);
    if (result.ok) {
      // El id de la entrega no es un dato personal; el contacto nunca viaja por la URL.
      router.push(
        `/backoffice/entregas?${DELIVERY_PARAM}=${encodeURIComponent(result.result.delivery.id)}`,
      );
    } else if (result.text) setError(td('error', { message: result.text }));
  };

  return (
    <div className={compact ? 'dispatch-note' : undefined}>
      <button
        type="button"
        className="btn sm block btn-primary"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void dispatch()}
      >
        {busy ? td('creating') : t('actions.dispatch')}
      </button>
      <span className="xs muted" style={{ fontWeight: 600, display: 'block', marginTop: 4 }}>
        {td('hint')}
      </span>
      {error ? (
        <span role="alert" className="xs" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { IconAlert, IconBike, IconPhone } from '@/components/icons/bo';
import { StatusPill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useRiders } from '@/features/backoffice/hooks';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { localTime } from '@/lib/time';
import { toBackofficeLogistics, trackSteps } from '../order-view';
import { useOrderActions } from '../use-order-actions';
import { usePastOrder } from '../use-past-order';
import { useScopedOrders } from '../use-scoped-orders';
import { LOGISTICS_TONE, useOrderText } from '../use-order-text';

const phoneHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/**
 * SOLO MOCK (`MOCK_ONLY`, fuera del alcance de F22): seguimiento logístico SIMULADO del pedido borrador cuando ya se despachó desde
 * Entregas/Panel (PedidosYa simulado o repartidor propio). El pedido REAL (`AdminOrderDetail`) no trae entrega hasta F28/F29; en
 * `http` este componente no se monta. No despacha nada desde Pedidos: el despacho de F22 está deshabilitado.
 */
export function LegacyLogisticsSection({ orderId, day }: { orderId: string; day: string | null }) {
  const orders = useScopedOrders();
  const today = orders.data?.find((o) => o.id === orderId);
  const past = usePastOrder(orderId, day, !today && orders.isSuccess);
  const order = today ?? past.order;
  if (!order?.delivery) return null;
  return <LogisticsSection order={order} />;
}

function LogisticsSection({ order }: { order: DraftOrder }) {
  const t = useTranslations('backoffice.orders');
  const td = useTranslations('backoffice.orders.drawer');
  const { can } = useShell();
  const text = useOrderText();
  const actions = useOrderActions();
  const delivery = order.delivery;
  const isOwn = delivery?.provider === 'own';
  const isPedidosYa = delivery?.provider === 'pedidosya';
  const providerLabel = delivery
    ? td(isOwn ? 'providerOwn' : 'providerPedidosya')
    : td('providerNone');
  const logisticsKey = toBackofficeLogistics(order);
  const canAdvance =
    !!delivery &&
    delivery.status !== 'delivered' &&
    delivery.status !== 'failed' &&
    can('deliveries.update', order.branchId);

  return (
    <section>
      <div className="sect-t">
        {td('courier', { provider: providerLabel })}{' '}
        {isPedidosYa ? <SimulationBadge kind="simulation" zone="bo" /> : null}
      </div>
      {delivery ? (
        <>
          <div className="info-card">
            <div
              className="avatar"
              style={{ background: 'var(--bo-secondary-soft)', color: 'var(--bo-secondary)' }}
            >
              <IconBike />
            </div>
            <div className="grow">
              <div className="strong">{delivery.riderName ?? td('pending')}</div>
              <div
                className="muted xs"
                style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}
              >
                {delivery.reference ?? '—'}
              </div>
            </div>
            {isOwn ? <RiderCallButton order={order} /> : null}
            <StatusPill zone="bo" tone={LOGISTICS_TONE[logisticsKey]}>
              {text.logisticsLabel(order)}
            </StatusPill>
          </div>
          <div className="times" style={{ marginTop: 10 }}>
            <div>
              <span className="xs muted" style={{ fontWeight: 700 }}>
                {td('requested')}
              </span>
              <b className="num">{localTime(new Date(delivery.requestedAt))}</b>
            </div>
            <div>
              <span className="xs muted" style={{ fontWeight: 700 }}>
                {td('eta')}
              </span>
              <b className="num">
                {delivery.status === 'delivered'
                  ? t('status.entregado')
                  : delivery.etaAt
                    ? localTime(new Date(delivery.etaAt))
                    : td('etaPending')}
              </b>
            </div>
            <div>
              <span className="xs muted" style={{ fontWeight: 700 }}>
                {isOwn ? td('costOwn') : td('costPedidosya')}
              </span>
              <b className="num">
                {isOwn
                  ? formatMoney(order.deliveryFee)
                  : delivery.cost != null
                    ? formatMoney(delivery.cost)
                    : '—'}
              </b>
            </div>
          </div>
          <div className="track" style={{ marginTop: 10 }}>
            {trackSteps(delivery).map((s) => (
              <div key={s.key} className={cn('trk', s.state)}>
                <span className="tdot" />
                {t(`logisticsStatus.${s.key}`)}
              </div>
            ))}
          </div>
          {canAdvance && isPedidosYa ? (
            <button
              type="button"
              className="btn sm btn-ghost block mt8"
              style={{ border: '1px dashed var(--bo-line-strong)' }}
              disabled={actions.pending}
              onClick={() => actions.advanceDelivery(order)}
            >
              {td('advance')}
            </button>
          ) : null}
          {canAdvance && isOwn ? (
            <button
              type="button"
              className="btn btn-primary block mt8"
              disabled={actions.pending}
              onClick={() => actions.advanceDelivery(order)}
            >
              {delivery.status === 'assigned' ? td('ownDepart') : td('ownDeliver')}
            </button>
          ) : null}
          <div className="xs muted mt8" style={{ fontWeight: 700 }}>
            {isPedidosYa ? td('etaNotePedidosya') : td('etaNoteOwn')}
          </div>
        </>
      ) : (
        <div className="empty-mini">
          <IconAlert size="sm" /> {td('noRider')}
        </div>
      )}
    </section>
  );
}

/** Llamar al repartidor propio (el teléfono viene del listado de repartidores de la sucursal). */
function RiderCallButton({ order }: { order: DraftOrder }) {
  const td = useTranslations('backoffice.orders.drawer');
  const riders = useRiders(order.branchId);
  const phone = riders.data?.find((r) => r.id === order.delivery?.riderId)?.phone;
  if (!phone) return null;
  return (
    <a className="btn sm" href={phoneHref(phone)} aria-label={td('callRider')}>
      <IconPhone />
    </a>
  );
}

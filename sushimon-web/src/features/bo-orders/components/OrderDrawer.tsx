'use client';

import { useTranslations } from 'next-intl';
import {
  IconAlert,
  IconBike,
  IconCheck,
  IconFileText,
  IconMapPin,
  IconPhone,
} from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Drawer } from '@/components/ui/Drawer';
import { StatusPill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useRiders } from '@/features/backoffice/hooks';
import { formatTopbarDate } from '@/features/backoffice-shell/staff-display';
import { useNow } from '@/features/backoffice-shell/use-now';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { Order, OrderStatusEvent } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toBackofficeColumn } from '@/lib/order-status';
import { can } from '@/lib/permissions';
import { localDate, localTime } from '@/lib/time';
import { useOrderDetail } from '../order-detail-context';
import {
  dispatchBlockedForRole,
  historyNewestFirst,
  initials,
  isLate,
  nextAction,
  orderCode,
  orderTime,
  progressSteps,
  toBackofficeLogistics,
  trackSteps,
} from '../order-view';
import { useOrderActions } from '../use-order-actions';
import { usePastOrder } from '../use-past-order';
import { useScopedOrders } from '../use-scoped-orders';
import { COLUMN_TONE, LOGISTICS_TONE, useOrderText } from '../use-order-text';

const phoneHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/** Drawer de detalle del pedido: productos, notas, totales, historial, entrega/logística y acciones por rol. */
export function OrderDrawer({ orderId }: { orderId: string }) {
  const detail = useOrderDetail();
  const orders = useScopedOrders();
  const todayOrder = orders.data?.find((o) => o.id === orderId);
  // Pedido de un día anterior (abierto desde Entregas): se consulta ese día.
  const past = usePastOrder(orderId, detail.day, !todayOrder && orders.isSuccess);
  const order = todayOrder ?? past.order;
  const t = useTranslations('backoffice.orders.drawer');

  if (!order) {
    // Cargando (o el pedido ya no está en la lista de hoy): panel mínimo para no dejar el foco perdido.
    return (
      <Drawer open zone="bo" title={`#${orderId}`} onClose={detail.close}>
        <div className="empty-mini" role="status">
          {orders.isError ? t('title') : '…'}
        </div>
      </Drawer>
    );
  }
  return <OrderDrawerContent order={order} onClose={detail.close} />;
}

function OrderDrawerContent({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useTranslations('backoffice.orders');
  const td = useTranslations('backoffice.orders.drawer');
  const { role, branchById } = useShell();
  const detail = useOrderDetail();
  const now = useNow();
  const text = useOrderText();
  const actions = useOrderActions();

  const column = toBackofficeColumn(order);
  const isDelivery = order.fulfillment === 'delivery';
  const branch = branchById(order.branchId);
  const late = isLate(order, now);
  const action = nextAction(order, role);
  const blocked = dispatchBlockedForRole(order, role);
  const steps = progressSteps(order);
  const canAcceptReject = action === 'accept' && can(role, 'orders.accept');
  const hasActions = action !== null || blocked;

  const eyebrow = td('eyebrow', {
    day:
      now && localDate(new Date(order.createdAt)) !== localDate(now)
        ? formatTopbarDate(new Date(order.createdAt))
        : td('today'),
    time: orderTime(order),
    branch: branch?.name ?? order.branchId,
  });

  const headerExtra = (
    <>
      <div className="row gap8 wrap">
        <StatusPill zone="bo" tone={COLUMN_TONE[column]}>
          {text.statusLabel(order)}
        </StatusPill>
        {late ? <span className="late">{td('late')}</span> : null}
        <span className="sm" style={{ fontWeight: 700 }}>
          {td('summary', {
            type: text.typeLong(order),
            items: text.itemsLabel(order),
            total: formatMoney(order.total),
            wait: text.waitText(order, now),
          })}
        </span>
      </div>
      {column !== 'cancelado' ? (
        <div className="steps">
          {steps.map((s) => (
            <div key={s.column} className={cn('step', s.state)}>
              <div className="sb" />
              <span className="trunc">{t(`columns.${s.column}`)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {column === 'cancelado' ? (
        <Banner zone="bo" tone="neutral">
          {td('rejected', { reason: order.rejectionReason ?? '—' })}
        </Banner>
      ) : null}
      {column === 'entregado' ? (
        <Banner zone="bo" tone="success">
          {td('delivered')}
        </Banner>
      ) : null}
    </>
  );

  const footer = hasActions ? (
    <>
      {action === 'accept' ? (
        <>
          <button
            type="button"
            className="btn btn-primary grow"
            disabled={actions.pending}
            onClick={() => actions.run(order, 'accept')}
          >
            <IconCheck />
            {t('actions.accept')}
          </button>
          {canAcceptReject ? (
            <button type="button" className="btn btn-ghost danger" onClick={detail.openReject}>
              {t('actions.reject')}
            </button>
          ) : null}
        </>
      ) : null}
      {action === 'prepare' ? (
        <button
          type="button"
          className="btn btn-primary grow"
          disabled={actions.pending}
          onClick={() => actions.run(order, 'prepare')}
        >
          {t('actions.prepare')}
        </button>
      ) : null}
      {action === 'ready' ? (
        <button
          type="button"
          className="btn btn-primary grow"
          disabled={actions.pending}
          onClick={() => actions.run(order, 'ready')}
        >
          <IconCheck />
          {t('actions.ready')}
        </button>
      ) : null}
      {action === 'dispatch' ? (
        <button
          type="button"
          className="btn btn-primary grow lg"
          onClick={() => actions.run(order, 'dispatch')}
        >
          <IconBike />
          {t('actions.dispatch').toUpperCase()}
        </button>
      ) : null}
      {blocked ? (
        <Banner zone="bo" tone="warning" className="grow" role="status">
          {t('actions.dispatchBlocked')}
        </Banner>
      ) : null}
      {action === 'deliver' ? (
        <button
          type="button"
          className="btn btn-green grow"
          disabled={actions.pending}
          onClick={() => actions.run(order, 'deliver')}
        >
          <IconCheck />
          {t('actions.handover')}
        </button>
      ) : null}
    </>
  ) : undefined;

  return (
    <Drawer
      open
      zone="bo"
      title={orderCode(order)}
      eyebrow={eyebrow}
      headerExtra={headerExtra}
      footer={footer}
      onClose={onClose}
    >
      <section>
        <div className="sect-t">{td('customer')}</div>
        <div className="info-card">
          <div
            className="avatar"
            style={{ background: 'var(--bo-muted)', color: 'var(--bo-on-primary)' }}
          >
            {initials(order.customer.name)}
          </div>
          <div className="grow">
            <div className="strong">{order.customer.name}</div>
            <div className="muted sm num" style={{ fontWeight: 600 }}>
              {order.customer.phone}
            </div>
          </div>
          <a className="btn sm" href={phoneHref(order.customer.phone)}>
            <IconPhone />
            {td('call')}
          </a>
        </div>
      </section>

      <section>
        <div className="sect-t">{isDelivery ? td('deliverTitle') : td('pickupTitle')}</div>
        <div className="info-list">
          <div className="info-row">
            <IconMapPin />
            <div className="grow">
              <div className="strong">
                {isDelivery && order.address
                  ? `${order.address.line}${order.address.zone ? ` · ${order.address.zone}` : ''}`
                  : `${branch?.name ?? order.branchId}${branch ? ` · ${branch.zoneLabel}` : ''}`}
              </div>
              <div className="muted sm" style={{ fontWeight: 600 }}>
                {isDelivery ? (order.address?.municipality ?? td('city')) : td('city')}
              </div>
            </div>
            <span className="zone-tag">{text.typeShort(order)}</span>
          </div>
          {order.note ? (
            <div className="info-row">
              <IconFileText />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {td('notes')}
                </div>
                <div style={{ fontWeight: 600 }}>{order.note}</div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isDelivery ? <LogisticsSection order={order} /> : null}

      <section>
        <div className="sect-t">{td('products')}</div>
        <div className="items">
          {order.lines.map((line, i) => (
            <div key={`${line.productId}-${i}`} className="item">
              <span className="qty">{line.quantity}×</span>
              <span className="grow">
                {line.name}
                {line.note ? (
                  <>
                    <br />
                    <span className="note-tag">{td('note', { note: line.note })}</span>
                  </>
                ) : null}
              </span>
              <span className="num">{formatMoney(line.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="totals">
          <div className="tline">
            <span>{td('subtotal')}</span>
            <span className="num">{formatMoney(order.subtotal)}</span>
          </div>
          {order.discount > 0 ? (
            <div className="tline">
              <span>{td('discount')}</span>
              <span className="num">-{formatMoney(order.discount)}</span>
            </div>
          ) : null}
          {isDelivery ? (
            <div className="tline">
              <span>{td('shipping')}</span>
              <span className="num">{formatMoney(order.deliveryFee)}</span>
            </div>
          ) : null}
          <div className="tline total">
            <span>{td('total')}</span>
            <span className="num">{formatMoney(order.total)}</span>
          </div>
        </div>
      </section>

      <section>
        <div className="sect-t">{td('history')}</div>
        <div className="hist">
          {historyNewestFirst(order).map((event, i) => (
            <div key={`${event.at}-${i}`}>
              <span className="num strong">{localTime(new Date(event.at))}</span>
              <span>{historyLabel(event, t)}</span>
            </div>
          ))}
        </div>
      </section>
    </Drawer>
  );
}

type Translator = ReturnType<typeof useTranslations<'backoffice.orders'>>;

/** Etiqueta del evento del historial (pedido, pago o logística). */
function historyLabel(event: OrderStatusEvent, t: Translator): string {
  if (event.kind === 'order') {
    const base = t(`history.${event.status as 'received'}`);
    return event.reason ? t('history.withReason', { label: base, reason: event.reason }) : base;
  }
  if (event.kind === 'payment') return t('history.payment', { status: event.status });
  return t('history.delivery', { status: event.status });
}

function LogisticsSection({ order }: { order: Order }) {
  const t = useTranslations('backoffice.orders');
  const td = useTranslations('backoffice.orders.drawer');
  const { role } = useShell();
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
    can(role, 'orders.dispatch');

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
function RiderCallButton({ order }: { order: Order }) {
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

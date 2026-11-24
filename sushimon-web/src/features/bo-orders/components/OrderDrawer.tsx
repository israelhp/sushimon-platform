'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { IconBike, IconFileText, IconMapPin, IconPhone } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Drawer } from '@/components/ui/Drawer';
import { StatusPill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatTopbarDate } from '@/features/backoffice-shell/staff-display';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { useDataClient } from '@/lib/data-access/provider';
import { cn } from '@/lib/cn';
import type {
  AdminOrderDetail,
  AdminOrderPendingAction,
  AdminOrderSummary,
} from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { localDate, localTime } from '@/lib/time';
import {
  LATE_MINUTES,
  classifyCommandError,
  isLatePending,
  progressSteps,
  reasonActions,
  type CommandError,
} from '../admin-orders-model';
import { useBoardFeed } from '../board-feed';
import { useAdminOrderDetail } from '../hooks';
import { useOrderDetail } from '../order-detail-context';
import { useAdminOrderActions, type ActionResult } from '../use-admin-order-actions';
import { STATUS_TONE, useAdminOrderText } from '../use-admin-order-text';
import { DispatchNotice, PrimaryActionButton } from './ActionButton';
import { LegacyLogisticsSection } from './LegacyLogistics';
import { PaymentPanel } from './PaymentPanel';
import { ActiveDeliveryModal } from './ActiveDeliveryModal';
import { ReasonModal, type ReasonKind } from './ReasonModal';

const phoneHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;
const money = (value: string) => formatMoney(Number(value));

/**
 * Drawer de detalle del pedido REAL: líneas, totales, contacto, historial y las acciones que el servidor permite. Es UN solo
 * diálogo en todos los estados (cargando, error, con datos): así el foco y la trampa de foco no se pierden al llegar la respuesta.
 */
export function OrderDrawer({ orderId }: { orderId: string }) {
  const detail = useOrderDetail();
  const feed = useBoardFeed();
  const query = useAdminOrderDetail(orderId);
  const t = useTranslations('backoffice.orders.live.drawer');
  const actions = useAdminOrderActions();
  const [reasonKind, setReasonKind] = useState<ReasonKind | null>(null);
  // F28: 409 `ORDER_HAS_ACTIVE_DELIVERY` al cancelar/rechazar: se ofrece cancelar primero la entrega (dos pasos explícitos).
  const [blocked, setBlocked] = useState<{ kind: ReasonKind; reason: string } | null>(null);
  const [pending, setPending] = useState<readonly AdminOrderPendingAction[]>([]);
  // Texto visible (además del aviso del toast) de la última acción que falló: estado actual y qué hacer.
  const [note, setNote] = useState<string | null>(null);
  const onResult = (r: ActionResult) => {
    if (r.ok) setNote(null);
    else if (r.text) setNote(r.text);
  };
  const card = feed.board?.columns.flatMap((c) => c.items).find((o) => o.id === orderId);
  const order = query.data;

  // La tarjeta cambió en el tablero (otra persona actuó): el detalle abierto se vuelve a leer (sin bucle: solo si la tarjeta es más nueva).
  const { refetch } = query;
  const known = order?.updatedAt;
  const fetching = query.isFetching;
  useEffect(() => {
    if (card && known && !fetching && card.updatedAt > known) void refetch();
  }, [card, known, fetching, refetch]);

  const error = !order && query.isError ? classifyCommandError(query.error) : null;
  const busy = actions.pending && actions.pendingId === orderId;

  return (
    <>
      <Drawer
        open
        zone="bo"
        title={`#${order?.displayNumber ?? card?.displayNumber ?? orderId}`}
        eyebrow={order ? <DrawerEyebrow order={order} /> : undefined}
        headerExtra={order ? <DrawerHeader order={order} /> : undefined}
        footer={
          order ? (
            <DrawerFooter order={order} busy={busy} onReason={setReasonKind} onResult={onResult} />
          ) : undefined
        }
        onClose={detail.close}
      >
        {order ? (
          <DrawerBody order={order} pending={pending} note={note} />
        ) : error ? (
          <Banner zone="bo" tone={error.kind === 'notFound' ? 'neutral' : 'danger'} role="alert">
            {t(`error.${errorKey(error)}`)}{' '}
            {error.kind === 'network' || error.kind === 'unknown' || error.kind === 'busy' ? (
              <button type="button" className="link-btn" onClick={() => void query.refetch()}>
                {t('retry')}
              </button>
            ) : null}
          </Banner>
        ) : (
          <div role="status" aria-busy="true" className="col gap8">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton zone="bo" style={{ height: 64, borderRadius: 12 }} />
            <Skeleton zone="bo" style={{ height: 120, borderRadius: 12 }} />
            <Skeleton zone="bo" style={{ height: 160, borderRadius: 12 }} />
          </div>
        )}
      </Drawer>

      {order && reasonKind ? (
        <ReasonModal
          kind={reasonKind}
          order={order}
          pending={busy}
          onSubmit={async (reason) => {
            const result = await actions.run(order, reasonKind, reason);
            onResult(result);
            if (!result.ok && result.error.code === 'ORDER_HAS_ACTIVE_DELIVERY') {
              setBlocked({ kind: reasonKind, reason });
            }
            if (result.ok) setPending(result.outcome.pending);
            return result;
          }}
          onClose={() => {
            setReasonKind(null);
            // Si el botón que abrió el modal ya no existe (el pedido cambió), el foco va al encabezado del detalle.
            setTimeout(() => {
              const active = document.activeElement;
              if (!active || active === document.body) {
                document
                  .querySelector<HTMLElement>('aside.drawer, [data-zone="bo"] .drawer')
                  ?.focus();
              }
            }, 0);
          }}
        />
      ) : null}
      {order && blocked ? (
        <ActiveDeliveryModal
          order={order}
          kind={blocked.kind}
          initialReason={blocked.reason}
          onClose={() => setBlocked(null)}
        />
      ) : null}
    </>
  );
}

function errorKey(error: CommandError): 'notFound' | 'forbidden' | 'auth' | 'mfa' | 'network' {
  switch (error.kind) {
    case 'notFound':
      return 'notFound';
    case 'forbidden':
      return 'forbidden';
    case 'auth':
      return 'auth';
    case 'mfa':
      return 'mfa';
    default:
      return 'network';
  }
}

function DrawerEyebrow({ order }: { order: AdminOrderDetail }) {
  const td = useTranslations('backoffice.orders.live.drawer');
  const feed = useBoardFeed();
  const placed = new Date(order.placedAt);
  return (
    <>
      {td('eyebrow', {
        day:
          feed.serverNow !== null && localDate(placed) === localDate(new Date(feed.serverNow))
            ? td('today')
            : formatTopbarDate(placed),
        time: localTime(placed),
        branch: order.branchName,
      })}
    </>
  );
}

function DrawerHeader({ order }: { order: AdminOrderDetail }) {
  const td = useTranslations('backoffice.orders.live.drawer');
  const feed = useBoardFeed();
  const text = useAdminOrderText();
  const late = feed.serverNow !== null && isLatePending(order, feed.serverNow);
  const steps = progressSteps(order);
  const lastReason = [...order.history].reverse().find((h) => h.reason)?.reason ?? null;
  return (
    <>
      <div className="row gap8 wrap">
        <StatusPill zone="bo" tone={STATUS_TONE[order.status]}>
          {text.statusLabel(order.status)}
        </StatusPill>
        {late ? <span className="late">{td('late', { minutes: LATE_MINUTES })}</span> : null}
        <span className="sm" style={{ fontWeight: 700 }}>
          {td('summary', {
            type: text.typeLabel(order, true),
            items: text.itemsLabel(order.itemCount),
            total: money(order.total),
            wait: text.waitText(order.placedAt, feed.serverNow),
          })}
        </span>
      </div>
      {steps.length > 0 ? (
        <div className="steps">
          {steps.map((s) => (
            <div key={s.status} className={cn('step', s.state)}>
              <div className="sb" />
              <span className="trunc">{text.statusLabel(s.status)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {order.status === 'rejected' || order.status === 'cancelled' ? (
        <Banner zone="bo" tone="neutral">
          {td(order.status === 'rejected' ? 'rejected' : 'cancelled', {
            reason: lastReason ?? '—',
          })}
        </Banner>
      ) : null}
      {order.status === 'delivered' || order.status === 'picked_up' ? (
        <Banner zone="bo" tone="success">
          {td('completed')}
        </Banner>
      ) : null}
    </>
  );
}

function DrawerFooter({
  order,
  busy,
  onReason,
  onResult,
}: {
  order: AdminOrderDetail;
  busy: boolean;
  onReason: (kind: ReasonKind) => void;
  onResult: (result: ActionResult) => void;
}) {
  const t = useTranslations('backoffice.orders.live');
  const reasons = reasonActions(order);
  const summary: AdminOrderSummary = order;
  if (
    reasons.length === 0 &&
    !order.availableActions.some((a) => a.enabled || a.action === 'dispatch')
  ) {
    return null;
  }
  return (
    <>
      <PrimaryActionButton order={summary} block withIcon onResult={onResult} />
      {reasons.map((action) => (
        <button
          key={action}
          type="button"
          className="btn btn-ghost danger"
          disabled={busy}
          onClick={() => onReason(action)}
        >
          {t(`actions.${action}`)}
        </button>
      ))}
      <DispatchNotice order={summary} />
    </>
  );
}

function DrawerBody({
  order,
  pending,
  note,
}: {
  order: AdminOrderDetail;
  pending: readonly AdminOrderPendingAction[];
  note: string | null;
}) {
  const t = useTranslations('backoffice.orders.live');
  const td = useTranslations('backoffice.orders.live.drawer');
  const { branchById } = useShell();
  const client = useDataClient();
  const detail = useOrderDetail();
  const text = useAdminOrderText();
  const isDelivery = order.fulfillmentType === 'DELIVERY';
  const branch = branchById(order.branchId);

  return (
    <>
      {note ? (
        // Sin `role`: el aviso (toast) ya tiene su región live; esto deja el texto visible en el detalle.
        <Banner zone="bo" tone="warning">
          {note} {td('noteHint')}
        </Banner>
      ) : null}
      {pending.length > 0 ? (
        <Banner zone="bo" tone="warning" role="status">
          {pending.map((p) => t(`pending.${p}`)).join(' ')}
        </Banner>
      ) : null}

      <section>
        <div className="sect-t">{td('customer')}</div>
        <div className="info-card">
          <div className="grow">
            <div className="strong">{order.contact.fullName}</div>
            <div className="muted sm num" style={{ fontWeight: 600 }}>
              {order.contact.phone}
            </div>
          </div>
          <a className="btn sm" href={phoneHref(order.contact.phone)}>
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
                  ? `${order.address.addressLine}${order.address.zone ? ` · ${td('zone', { zone: order.address.zone })}` : ''}`
                  : `${order.branchName}${branch ? ` · ${branchShortName(branch)}` : ''}`}
              </div>
              <div className="muted sm" style={{ fontWeight: 600 }}>
                {isDelivery && order.address
                  ? [order.address.municipalityName, order.address.referenceNote]
                      .filter(Boolean)
                      .join(' · ')
                  : td('city')}
              </div>
            </div>
            <span className="zone-tag">{text.typeLabel(order)}</span>
          </div>
          {order.notes ? (
            <div className="info-row">
              <IconFileText />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {td('notes')}
                </div>
                <div style={{ fontWeight: 600 }}>{order.notes}</div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isDelivery ? (
        <section>
          <div className="sect-t">
            {td('courier', { provider: text.typeLabel(order) })}{' '}
            {order.deliveryProvider === 'PEDIDOSYA' ? (
              <SimulationBadge kind="simulation" zone="bo" />
            ) : null}
          </div>
          <div className="empty-mini">
            <IconBike size="sm" />{' '}
            {text.dispatchNote(
              order.deliveryProvider === 'PEDIDOSYA'
                ? 'PROVIDER_BLOCKED_EXTERNAL'
                : 'DISPATCH_NOT_AVAILABLE',
            )}
          </div>
        </section>
      ) : null}

      {isDelivery && client.kind === 'mock' ? (
        <LegacyLogisticsSection orderId={order.id} day={detail.day} />
      ) : null}

      <section>
        <div className="sect-t">{td('products')}</div>
        <div className="items">
          {order.lines.map((line, i) => (
            <div key={`${line.productName}-${i}`} className="item">
              <span className="qty">{line.quantity}×</span>
              <span className="grow">
                {line.productName}
                {line.modifiers.map((m, j) => (
                  <span key={`${m.name}-${j}`} className="muted xs" style={{ display: 'block' }}>
                    + {m.name}
                  </span>
                ))}
                {line.notes ? (
                  <>
                    <br />
                    <span className="note-tag">{td('note', { note: line.notes })}</span>
                  </>
                ) : null}
              </span>
              <span className="num">{money(line.lineTotal)}</span>
            </div>
          ))}
        </div>
        {order.promotions.length > 0 ? (
          <div className="totals">
            {order.promotions.map((p, i) => (
              <div key={`${p.name}-${i}`} className="tline">
                <span>{td('promotion', { name: p.name })}</span>
                <span className="num">-{money(p.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="totals">
          <div className="tline">
            <span>{td('subtotal')}</span>
            <span className="num">{money(order.subtotal)}</span>
          </div>
          {Number(order.extrasTotal) > 0 ? (
            <div className="tline">
              <span>{td('extras')}</span>
              <span className="num">{money(order.extrasTotal)}</span>
            </div>
          ) : null}
          {Number(order.discountTotal) > 0 ? (
            <div className="tline">
              <span>{td('discount')}</span>
              <span className="num">-{money(order.discountTotal)}</span>
            </div>
          ) : null}
          {isDelivery ? (
            <div className="tline">
              <span>{td('shipping')}</span>
              <span className="num">{money(order.deliveryFee)}</span>
            </div>
          ) : null}
          <div className="tline total">
            <span>{td('total')}</span>
            <span className="num">{money(order.total)}</span>
          </div>
        </div>
      </section>

      <PaymentPanel order={order} />

      <section>
        <div className="sect-t">{td('history')}</div>
        <div className="hist">
          {[...order.history].reverse().map((entry) => (
            <div key={entry.seq}>
              <span className="num strong">
                {localDate(new Date(entry.at))} {localTime(new Date(entry.at))}
              </span>
              <span>
                {text.statusLabel(entry.status)}
                {entry.actorName ? ` · ${td('by', { name: entry.actorName })}` : ''}
                {entry.reason ? ` · ${td('reasonLabel', { reason: entry.reason })}` : ''}
              </span>
            </div>
          ))}
        </div>
        {order.historyTruncated ? (
          <div className="xs muted" style={{ fontWeight: 600 }}>
            {td('historyTruncated')}
          </div>
        ) : null}
      </section>
    </>
  );
}

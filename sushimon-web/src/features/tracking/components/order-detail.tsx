'use client';

import {
  ArrowLeft,
  Clock,
  CreditCard,
  FileText,
  MapPin,
  Phone,
  RotateCcw,
  Store,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/data-access/errors';
import type { Incident, DraftOrder } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { isOrderInProgress, toStoreOrderState, toStoreTrackingStep } from '@/lib/order-status';
import { localDate } from '@/lib/time';
import { formatWhen } from '@/features/order-mode/when';
import { OrderStatusChip } from '@/features/orders/components/order-status-chip';
import { ReorderDialog } from '@/features/orders/components/reorder-dialog';
import { useAdvanceOrderDemo, useIsSimulation, useOrder } from '@/features/orders/hooks';
import { WhatsappReportButton } from '@/features/incidents/components/whatsapp-report-button';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useBranches, useStoreConfig } from '@/features/store/hooks';
import { formatOrderAddress } from '../format-address';
import { OrderReceivedScreen } from '@/features/checkout/components/OrderReceivedScreen';
import { TrackingProgress } from './tracking-progress';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un pedido real se identifica por UUID; `MON-…` es el borrador del seguimiento simulado (solo mock). */
export const isOrderUuid = (id: string): boolean => UUID.test(id);

/** Cada cuántos ms se refresca el estado de un pedido en curso. */
export const TRACKING_POLL_MS = 15_000;

/** Ruta de consulta de invitado a la que se vuelve si el servidor no entrega el pedido. */
export const lookupHref = (orderId: string) =>
  `/consultar?pedido=${encodeURIComponent(orderId)}&notfound=1`;

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-subtle text-secondary"
        aria-hidden="true"
      >
        {icon}
      </span>
      <dt className="w-[34%] flex-none text-[13px] font-bold text-muted">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 break-words text-[15px] font-bold">{value}</dd>
    </div>
  );
}

function IncidentStatusPill({ status }: { status: Incident['status'] }) {
  const t = useTranslations('incidents.status');
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[12px] font-extrabold',
        status === 'resolved'
          ? 'bg-success-soft text-success'
          : status === 'in_review'
            ? 'bg-accent-soft text-fg'
            : 'bg-secondary-soft text-secondary',
      )}
    >
      {t(status)}
    </span>
  );
}

function DemoAdvance({ order }: { order: DraftOrder }) {
  const t = useTranslations('status');
  const tt = useTranslations('tracking');
  const advance = useAdvanceOrderDemo();
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-dashed border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-[12px] text-muted">
        <SimulationBadge kind="simulation" className="mr-1.5 sm:hidden" />
        {t('demoNote')}
      </p>
      <div className="flex flex-col gap-2 sm:items-end">
        <button
          type="button"
          className="btn !min-h-[40px] !px-4 text-sm"
          disabled={advance.isPending}
          aria-busy={advance.isPending}
          onClick={() => advance.mutate(order.id)}
        >
          {t('nextDemo')}
        </button>
        {advance.isError ? (
          <p role="alert" className="m-0 text-[12px] font-bold text-primary">
            {tt('advanceError')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Seguimiento y detalle de UN pedido (`/pedidos/[id]`): cabecera con número y estado, progreso de 6 (domicilio)
 * o 5 (recoger) pasos, reclamos, datos de entrega/pago, productos y totales, "Volver a pedir" y llamar.
 * Presentacional: recibe el pedido ya cargado; úsalo desde el contenedor `OrderDetail` o, con otro
 * origen de datos (p. ej. la lista de Mi cuenta), directamente.
 */
export function OrderDetailView({ order }: { order: DraftOrder }) {
  const t = useTranslations('orders');
  const th = useTranslations('orders.history');
  const tc = useTranslations('confirm');
  const tt = useTranslations('tracking');
  const ts = useTranslations('status');
  const tp = useTranslations('payment');
  const tch = useTranslations('checkout');
  const tcom = useTranslations('common');
  const twhen = useTranslations('when');
  const ti = useTranslations('incidents');
  const locale = useLocale();
  const router = useRouter();
  const config = useStoreConfig();
  const branches = useBranches();
  const simulation = useIsSimulation();
  const [reordering, setReordering] = useState(false);

  const branchName = branches.data?.find((b) => b.id === order.branchId)?.name ?? '';
  const step = toStoreTrackingStep(order);
  const state = toStoreOrderState(order);
  const inProgress = isOrderInProgress(order);
  const today = config.data ? localDate(new Date(config.data.serverTime)) : null;
  const delivery = order.fulfillment === 'delivery';
  const paymentLabel = tp('cash');
  const showEta = inProgress && delivery && step.progress >= 4;
  const stateNote = state === 'awaiting_payment' || state === 'payment_review' ? ts(state) : null;
  const openIncidentsLabel = (incident: Incident) => ti(`types.${incident.type}`);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/cuenta/pedidos');
  };

  return (
    <div className="wrap max-w-[760px] pb-12 pt-5 sm:pt-8">
      <button
        type="button"
        onClick={goBack}
        className="mb-3 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-extrabold text-secondary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('back')}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-bold uppercase tracking-[0.14em] text-muted">
            {t('order')}
          </p>
          <h1 className="disp text-[clamp(30px,7vw,44px)]">{order.id}</h1>
          <p className="m-0 text-[14px] text-muted">
            {t('placedOn', { a: formatDateTime(order.createdAt, locale) })}
          </p>
          {stateNote ? (
            <p className="m-0 mt-1 text-[13px] font-bold text-secondary">{stateNote}</p>
          ) : null}
        </div>
        <OrderStatusChip order={order} />
      </div>

      <section
        className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card"
        aria-labelledby="od-track"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="od-track" className="disp text-[20px]">
              {tc('progress')}
            </h2>
            {simulation && inProgress ? (
              <SimulationBadge kind="simulation" className="max-sm:hidden" />
            ) : null}
          </div>
          {showEta ? (
            <span className="text-[13px] font-bold text-secondary">
              {t('eta', { a: 15, b: 25 })}
            </span>
          ) : null}
        </div>
        {step.halted ? (
          <Banner tone="danger" role="status" className="mt-4">
            <strong className="block font-extrabold">
              {order.status === 'rejected' ? tt('rejected') : tt('cancelled')}
            </strong>
            {order.rejectionReason ? (
              <span>
                {tt('reason')}: {order.rejectionReason}
              </span>
            ) : null}
          </Banner>
        ) : (
          <div className="mt-4">
            <TrackingProgress order={order} />
          </div>
        )}
        {simulation && inProgress ? <DemoAdvance order={order} /> : null}
      </section>

      <section
        className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card"
        aria-labelledby="od-inc"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="od-inc" className="disp text-[20px]">
            {t('incidents')}
          </h2>
          <WhatsappReportButton order={order} className="!min-h-[40px] !px-4 text-sm" />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
          {order.incidents.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">{t('noIncidents')}</p>
          ) : (
            <span />
          )}
          <Link
            href={`/incidencias/nuevo?pedido=${encodeURIComponent(order.id)}`}
            className="link-btn !min-h-0 !py-0 text-sm"
          >
            {tt('reportOnline')}
          </Link>
        </div>
        {order.incidents.length > 0 ? (
          <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
            {order.incidents.map((incident) => (
              <li key={incident.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold">
                    {incident.id} · {openIncidentsLabel(incident)}
                  </span>
                  <IncidentStatusPill status={incident.status} />
                </div>
                <p className="m-0 mt-1 text-[12px] text-muted">
                  {formatDateTime(incident.createdAt, locale)} ·{' '}
                  {ti(`resolutions.${incident.resolution}`)}
                </p>
                <p className="m-0 mt-1.5 text-[14px]">{incident.description}</p>
                {incident.answer ? (
                  <p className="m-0 mt-2 rounded-lg bg-success-soft px-3 py-2 text-[13px]">
                    <strong className="block text-[12px] uppercase tracking-wide text-success">
                      {t('restaurantAnswer')}
                    </strong>
                    {incident.answer[locale === 'en' ? 'en' : 'es']}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <dl className="m-0 divide-y divide-line">
          <DetailRow icon={<Store className="h-4 w-4" />} label={tc('branch')} value={branchName} />
          <DetailRow
            icon={delivery ? <Truck className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            label={delivery ? tc('address') : tc('pickupAt')}
            value={
              delivery && order.address
                ? formatOrderAddress(order.address, (zone) => tt('zoneN', { zone }))
                : branchName
            }
          />
          <DetailRow
            icon={<Clock className="h-4 w-4" />}
            label={tch('when')}
            value={formatWhen(order.schedule, today, locale, {
              asap: twhen('asap'),
              today: twhen('today'),
              tomorrow: twhen('tomorrow'),
            })}
          />
          <DetailRow
            icon={<CreditCard className="h-4 w-4" />}
            label={tc('method')}
            value={paymentLabel}
          />
        </dl>
        <div className="border-t border-line px-4 py-3">
          <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-wide text-muted">
            {tc('products')}
          </p>
          <ul className="m-0 list-none p-0">
            {order.lines.map((line) => (
              <li
                key={`${line.productId}|${line.note}`}
                className="flex justify-between gap-3 py-1.5 text-[15px]"
              >
                <span className="min-w-0">
                  <strong>{line.quantity}×</strong> {line.name}
                  {line.note ? (
                    <small className="block text-[13px] text-muted">{line.note}</small>
                  ) : null}
                </span>
                <span className="flex-none font-bold">{formatMoney(line.subtotal, locale)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-dashed border-line pt-2 text-[15px]">
            <div className="flex justify-between">
              <span className="text-muted">{tcom('subtotal')}</span>
              <span>{formatMoney(order.subtotal, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">
                {delivery ? tch('estimatedShipping') : tch('shipping')}
              </span>
              <span>{delivery ? formatMoney(order.deliveryFee, locale) : tch('pickupFree')}</span>
            </div>
            {order.discount > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted">{tt('discount')}</span>
                <span>-{formatMoney(order.discount, locale)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-extrabold">
                {state === 'paid_pending_acceptance' ? tc('totalPaid') : tc('total')}
              </span>
              <span className="font-display text-[26px]">{formatMoney(order.total, locale)}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => setReordering(true)}
          className="btn btn-primary w-full sm:w-auto"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('again')}
        </button>
        <Link href={`/pedidos/${order.id}/recibo`} className="btn w-full no-underline sm:w-auto">
          <FileText className="h-4 w-4" aria-hidden="true" /> {th('receipt')}
        </Link>
        {config.data ? (
          <a href={config.data.phoneHref} className="btn w-full no-underline sm:w-auto">
            <Phone className="h-4 w-4" aria-hidden="true" /> {t('call')}
          </a>
        ) : null}
      </div>
      {reordering ? (
        <ReorderDialog
          orderId={order.id}
          displayNumber={order.id}
          inProgress={inProgress}
          onClose={() => setReordering(false)}
        />
      ) : null}
    </div>
  );
}

function DetailSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="wrap max-w-[760px] pb-12 pt-5 sm:pt-8"
    >
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-3 h-5 w-40" />
      <Skeleton className="mt-5 h-64 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-32 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-72 w-full rounded-2xl" />
    </div>
  );
}

/**
 * Contenedor del seguimiento: carga el pedido (refresca el estado cada {@link TRACKING_POLL_MS} ms mientras
 * está en curso) y resuelve el control de acceso como el prototipo: si el servidor no lo entrega (404:
 * no existe, o no es de esta sesión ni se verificó con número + teléfono) lleva a la consulta de invitado.
 * En esta fase la decisión la toma el adaptador mock imitando a la API; con http la decide el servidor
 * (la sesión/verificación del navegador nunca autoriza nada).
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  // F20/F23: un pedido REAL (UUID) se muestra siempre con `GET /v1/orders/{id}` (http y mock por el MISMO camino: detalle histórico
  // con «Ver recibo» y «Volver a pedir»). Solo el borrador SIMULADO (`MON-…`, mock) conserva el seguimiento simulado heredado.
  const simulation = useIsSimulation();
  return simulation && !isOrderUuid(orderId) ? (
    <SimulatedOrderDetail orderId={orderId} />
  ) : (
    <OrderReceivedScreen orderId={orderId} />
  );
}

function SimulatedOrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('tracking');
  const tu = useTranslations('ui');
  const router = useRouter();
  const [settled, setSettled] = useState(false);
  const query = useOrder(orderId, { refetchInterval: settled ? undefined : TRACKING_POLL_MS });

  const order = query.data;
  const settledNow = !!order && !isOrderInProgress(order);
  // Pedido terminado: deja de refrescar (ajuste de estado durante el render, sin efecto).
  if (settledNow && !settled) setSettled(true);

  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
  useEffect(() => {
    if (denied) router.replace(lookupHref(orderId));
  }, [denied, orderId, router]);

  if (order) return <OrderDetailView order={order} />;
  if (denied) {
    return (
      <div className="wrap max-w-[760px] pb-12 pt-5 sm:pt-8">
        <div role="alert" className="notice notice-warn">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {t('redirecting')}{' '}
            <Link href={lookupHref(orderId)} className="link-btn !min-h-0 text-sm">
              {t('goLookup')}
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="wrap max-w-[760px] pb-12 pt-5 sm:pt-8">
        <ErrorNotice onRetry={() => void query.refetch()} />
      </div>
    );
  }
  return <DetailSkeleton label={tu('loading')} />;
}

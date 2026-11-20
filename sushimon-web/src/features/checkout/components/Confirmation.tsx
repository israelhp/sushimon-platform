'use client';

import {
  Activity,
  Banknote,
  Check,
  Clock,
  Flag,
  ListOrdered,
  MapPin,
  Store,
  TriangleAlert,
  Truck,
  Mail,
  ReceiptText,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toStoreOrderState, toStoreTrackingStep } from '@/lib/order-status';
import { localDate } from '@/lib/time';
import { useAdvanceOrderDemo, useIsSimulation } from '@/features/orders/hooks';
import { formatWhen } from '@/features/order-mode/when';
import { useDemoSession } from '@/features/session/demo-session';
import { MapLinks } from '@/features/store-shell/components/StoreFooter';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useBranches, useStoreConfig } from '@/features/store/hooks';
import { formatAddress } from '../checkout-model';

const PAYMENT_STATUS_KEYS = [
  'awaiting_payment',
  'payment_review',
  'paid_pending_acceptance',
  'pending_acceptance',
] as const;

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-subtle text-secondary"
        aria-hidden="true"
      >
        {icon}
      </span>
      <dt className="w-[34%] flex-none text-[13px] font-bold text-muted">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 text-[15px] font-bold">{children}</dd>
    </div>
  );
}

/**
 * Confirmación del pedido: número `MON-xxxxxx`, estado inicial según el pago (pagado / recibido / pago en
 * verificación), seguimiento por pasos, resumen y enlaces. Los estados salen del pedido que devolvió la API
 * (`toStoreOrderState` / `toStoreTrackingStep`); aquí no se calcula ningún monto.
 */
export function Confirmation({
  order,
  onOrderChange,
  trackingId = null,
}: {
  order: DraftOrder;
  onOrderChange: (order: DraftOrder) => void;
  /** F21 (solo mock): UUID del pedido simulado «real» para abrir `/pedidos/[id]/seguimiento` (la forma `OrderTracking`). */
  trackingId?: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const { customer } = useDemoSession();
  const simulation = useIsSimulation();
  const advance = useAdvanceOrderDemo();
  const config = useStoreConfig().data;
  const branches = useBranches().data ?? [];
  const money = (v: number) => formatMoney(v, locale);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Al confirmar, el foco pasa al título para que lectores de pantalla anuncien el resultado.
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);

  const state = toStoreOrderState(order);
  const step = toStoreTrackingStep(order);
  const labels = [
    ...(t.raw(step.variant === 'delivery' ? 'status.steps' : 'status.stepsPickup') as string[]),
  ];
  if (step.payOnDelivery) labels[1] = t('status.payOnDelivery');
  const paid = state === 'paid_pending_acceptance';
  const statusLabel = (PAYMENT_STATUS_KEYS as readonly string[]).includes(state)
    ? t(`status.${state as (typeof PAYMENT_STATUS_KEYS)[number]}`)
    : (labels[Math.min(step.progress, labels.length - 1)] ?? '');
  const branch = branches.find((b) => b.id === order.branchId);
  const delivery = order.fulfillment === 'delivery';
  const when = formatWhen(
    order.schedule,
    config ? localDate(new Date(config.serverTime)) : null,
    locale,
    {
      asap: t('when.asap'),
      today: t('when.today'),
      tomorrow: t('when.tomorrow'),
    },
  );
  // F24: solo efectivo (el borrador enlazado nunca es de tarjeta).
  const methodLabel = t('payment.cash');
  const MethodIcon = Banknote;
  const canAdvance = simulation && !step.halted && step.progress < step.total;

  return (
    <div className="wrap max-w-[760px] pb-12 pt-7 sm:pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-success text-ondeep shadow-card">
          <Check className="h-10 w-10" aria-hidden="true" />
        </span>
        <p className="font-jp text-sm tracking-[0.2em] text-primary" lang="ja">
          {t('confirm.jp')}
        </p>
        <h1
          ref={titleRef}
          className="disp text-[clamp(32px,7vw,48px)] outline-none"
          tabIndex={-1}
          id="confirm-title"
        >
          {paid ? t('confirm.titlePaid') : t('confirm.title')}
        </h1>
        <div className="mt-1 rounded-2xl border border-line bg-surface px-6 py-3 shadow-card">
          <span className="block text-[12px] font-bold uppercase tracking-[0.14em] text-muted">
            {t('confirm.number')}
          </span>
          <span className="block font-display text-[34px] leading-tight" data-testid="order-number">
            {order.id}
          </span>
        </div>
        <SimulationBadge kind="simulation">{t('common.simulation')}</SimulationBadge>
        <p className="m-0 flex flex-wrap items-center justify-center gap-1.5 text-[15px]">
          <Mail className="h-4 w-4" aria-hidden="true" /> {t('confirm.emailSent')}{' '}
          <strong className="break-all">{order.customer.email}</strong>
        </p>
      </div>

      <section
        className="mt-7 rounded-2xl border border-line bg-surface p-5 shadow-card"
        aria-labelledby="track-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="track-title" className="disp text-[20px]">
            {t('confirm.progress')}
          </h2>
          <span className="rounded-full bg-secondary-soft px-3 py-1 text-[12px] font-extrabold text-secondary">
            {statusLabel}
          </span>
        </div>
        <ol className="m-0 mt-4 grid list-none gap-0 p-0">
          {labels.map((label, i) => {
            const done = i < step.progress;
            const current = i === step.progress;
            return (
              <li key={`${label}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                {i < labels.length - 1 ? (
                  <span
                    className={cn(
                      'absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5',
                      done ? 'bg-success' : 'bg-line',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={cn(
                    'relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-extrabold',
                    done
                      ? 'bg-success text-ondeep'
                      : current
                        ? 'bg-primary text-onprimary ring-4 ring-primary/20'
                        : 'border border-line bg-surface text-muted',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'pt-1 text-[15px]',
                    done || current ? 'font-extrabold text-fg' : 'text-muted',
                  )}
                >
                  {label}
                  <span className="sr-only">{done ? ' ✓' : current ? ' …' : ''}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {simulation ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-dashed border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-[12px] text-muted">{t('status.demoNote')}</p>
            <button
              type="button"
              className="btn !min-h-[40px] !px-4 text-sm"
              disabled={!canAdvance || advance.isPending}
              onClick={() =>
                advance.mutate(order.id, {
                  onSuccess: (next) => onOrderChange(next),
                  onError: () => notify(t('checkoutFlow.advanceError')),
                })
              }
            >
              {t('status.nextDemo')}
            </button>
          </div>
        ) : null}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <dl className="m-0 divide-y divide-line">
          <Fact icon={<Store className="h-4 w-4" />} label={t('confirm.restaurant')}>
            MON SUSHI
          </Fact>
          <Fact icon={<Store className="h-4 w-4" />} label={t('confirm.branch')}>
            {branch?.name ?? order.branchId}
          </Fact>
          <Fact
            icon={delivery ? <Truck className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            label={delivery ? t('confirm.address') : t('confirm.pickupAt')}
          >
            {delivery && order.address
              ? formatAddress(order.address, t('checkoutFlow.zoneInline'))
              : (branch?.name ?? order.branchId)}
          </Fact>
          <Fact icon={<Clock className="h-4 w-4" />} label={t('checkout.when')}>
            {when}
          </Fact>
          <Fact icon={<Flag className="h-4 w-4" />} label={t('confirm.status')}>
            {statusLabel} · {t('delivery.prepTime')}
          </Fact>
          <Fact icon={<MethodIcon className="h-4 w-4" />} label={t('confirm.method')}>
            {order.payment.reference ? `${methodLabel} · ${order.payment.reference}` : methodLabel}
          </Fact>
        </dl>
        <div className="border-t border-line px-4 py-3">
          <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-wide text-muted">
            {t('confirm.products')}
          </p>
          {order.lines.map((line) => (
            <div
              key={`${line.productId}|${line.note}`}
              className="flex justify-between gap-3 py-1.5 text-[15px]"
            >
              <span className="min-w-0">
                <strong>{line.quantity}×</strong> {line.name}
                {line.note ? (
                  <small className="block text-[13px] text-muted">{line.note}</small>
                ) : null}
              </span>
              <span className="flex-none font-bold">{money(line.subtotal)}</span>
            </div>
          ))}
          <div className="mt-2 border-t border-dashed border-line pt-2 text-[15px]">
            <div className="flex justify-between">
              <span className="text-muted">{t('common.subtotal')}</span>
              <span>{money(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">
                {delivery ? t('checkout.estimatedShipping') : t('checkout.shipping')}
              </span>
              <span>{delivery ? money(order.deliveryFee) : t('checkout.pickupFree')}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-extrabold">
                {paid ? t('confirm.totalPaid') : t('confirm.total')}
              </span>
              <span className="font-display text-[26px]">{money(order.total)}</span>
            </div>
          </div>
        </div>
      </section>

      {!delivery && config && branches[0] && order.branchId === branches[0].id ? (
        <div className="mt-5 rounded-2xl border border-dashed border-line p-4">
          <p className="m-0 text-[14px] font-bold">{t('confirm.pickupDirections')}</p>
          <MapLinks config={config} className="mt-2" />
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        {customer ? (
          <Link href="/cuenta/pedidos" className="btn w-full no-underline sm:flex-1">
            <ListOrdered className="h-4 w-4" aria-hidden="true" /> {t('confirm.viewMyOrders')}
          </Link>
        ) : (
          <p className="m-0 rounded-xl bg-subtle px-3.5 py-3 text-[13px] leading-snug text-fg sm:flex-1">
            {t('confirm.trackLater')}
          </p>
        )}
        {trackingId ? (
          <>
            <Link
              href={`/pedidos/${trackingId}/seguimiento`}
              className="btn btn-primary w-full no-underline sm:w-auto"
              data-testid="view-tracking"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />{' '}
              {t('orders.received.viewTracking')}
            </Link>
            <Link href={`/pedidos/${order.id}`} className="btn w-full no-underline sm:w-auto">
              <ReceiptText className="h-4 w-4" aria-hidden="true" /> {t('tracking.viewDetail')}
            </Link>
          </>
        ) : (
          <Link href={`/pedidos/${order.id}`} className="btn w-full no-underline sm:w-auto">
            <ReceiptText className="h-4 w-4" aria-hidden="true" /> {t('confirm.trackOrder')}
          </Link>
        )}
        <Link
          href={`${STORE_ROUTES.incidents}?pedido=${order.id}`}
          className="btn w-full no-underline sm:w-auto"
        >
          <TriangleAlert className="h-4 w-4" aria-hidden="true" /> {t('confirm.reportProblem')}
        </Link>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <Link href={STORE_ROUTES.home} className="btn btn-primary w-full">
          {t('common.backHome')}
        </Link>
        <Link href={STORE_ROUTES.menu} className="link-btn self-center">
          {t('confirm.another')}
        </Link>
      </div>
    </div>
  );
}

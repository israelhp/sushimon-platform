'use client';

import {
  Clock,
  Info,
  Loader2,
  MapPin,
  Pencil,
  RotateCcw,
  Store,
  Truck,
  TriangleAlert,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { formatMoney } from '@/lib/format';
import { BranchHoursDisclosure } from '@/features/branch-schedule/components/BranchHoursPanel';
import { useAvailabilityText } from '@/features/branch-schedule/use-availability-text';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { dateOptions, firstSlot } from '@/features/order-mode/when';
import { MapLinks } from '@/features/store-shell/components/StoreFooter';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { formatAddress, type CheckoutStep } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import { coveringBranch } from '../coverage';
import type { CheckoutData } from '../use-checkout-data';
import { ChoiceCard, useCheckoutSteps } from './parts';

function Notice({
  tone = 'info',
  children,
  role,
}: {
  tone?: 'info' | 'warn';
  children: React.ReactNode;
  role?: 'status' | 'alert';
}) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div className={tone === 'info' ? 'notice notice-info' : 'notice notice-warn'} role={role}>
      <Icon className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Aviso "la sucursal está cerrada": solo se puede programar (escenario `branch-closed`). */
function ClosedBranchNotice({ data, onSchedule }: { data: CheckoutData; onSchedule: () => void }) {
  const t = useTranslations();
  const text = useAvailabilityText();
  if (!data.closedNow || !data.branch) return null;
  const next = data.branchAvailability?.nextOpensAt;
  return (
    <div className="notice notice-warn items-center" role="alert">
      <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span>
          {t('mode.closedNow', { a: data.branch.name })}
          {next && data.branchAvailability
            ? ` ${t('branchSchedule.notice.opensLater', { when: text.when(next, data.branchAvailability.serverTime) })}`
            : ''}
        </span>
        <button type="button" className="link-btn !min-h-0 text-sm" onClick={onSchedule}>
          {t('mode.schedule')}
        </button>
      </div>
    </div>
  );
}

/**
 * Paso 3 · Envío. A domicilio: destino, sucursal de origen (asignada por cobertura, se puede cambiar) y
 * estimación de tarifa y tiempo por zona (simulada). Sin cobertura se ofrece recoger. Al recoger: sucursal.
 */
export function ShippingStep({
  data,
  goTo,
}: {
  data: CheckoutData;
  goTo: (step: CheckoutStep) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const steps = useCheckoutSteps();
  const { draft, dispatch } = useCheckoutDraft();
  const { update } = useOrderMode();
  const { config, now, quote, quoteQuery, branches, branch } = data;
  const zoneWord = t('checkoutFlow.zoneInline');
  const money = (v: number) => formatMoney(v, locale);
  const area = (b: { area: { es: string; en?: string } }) =>
    (locale === 'en' ? b.area.en : undefined) ?? b.area.es;

  /** Cambia a "programar" con el primer horario disponible y vuelve a Entrega. */
  const schedule = () => {
    if (config && now) {
      const first = dateOptions(
        config.schedule,
        data.hours,
        now,
        locale,
        { asap: '', today: '', tomorrow: '' },
        data.closures,
      )[0];
      const time = first
        ? firstSlot(config.schedule, data.hours, first.date, now, data.closures)
        : null;
      if (first && time) update({ when: { kind: 'scheduled', date: first.date, time } });
    }
    goTo(2);
  };

  if (data.type !== 'delivery') {
    const pickupId = data.pickupBranchId;
    return (
      <section aria-label={steps[2]} className="flex flex-col gap-4">
        <fieldset>
          <legend className="lbl flex flex-wrap items-center gap-2">
            {t('delivery.branchPickup')}{' '}
            <SimulationBadge kind="demo">{t('delivery.branchDemo')}</SimulationBadge>
          </legend>
          <div
            className="flex flex-col gap-2.5"
            role="radiogroup"
            aria-label={t('delivery.branchPickup')}
          >
            {branches.map((b) => (
              <ChoiceCard
                key={b.id}
                on={pickupId === b.id}
                onClick={() => dispatch({ type: 'pickup-branch', branchId: b.id })}
                icon={<Store className="h-5 w-5" aria-hidden="true" />}
                title={b.name}
                sub={area(b)}
                badge={
                  data.availability[b.id]?.isAcceptingOrders === false ? (
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-extrabold text-muted">
                      {t('mode.closedBadge')}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
          {pickupId ? (
            <BranchHoursDisclosure
              branchId={pickupId}
              name={branches.find((b) => b.id === pickupId)?.name ?? ''}
            />
          ) : null}
        </fieldset>
        {config && branches[0] && pickupId === branches[0].id ? <MapLinks config={config} /> : null}
        <ClosedBranchNotice data={data} onSchedule={schedule} />
        <Notice>
          {t('delivery.pickupNoFee')} {t('delivery.prepTime')}.
        </Notice>
      </section>
    );
  }

  const autoBranch = coveringBranch(branches, draft.address);
  const loading = data.quoteRequested && quoteQuery.isPending;
  const uncovered = !!quote && !quote.covered;

  return (
    <section aria-label={steps[2]} className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-muted">
            {t('delivery.destination')}
          </p>
          <p className="m-0 font-bold leading-snug">{formatAddress(draft.address, zoneWord)}</p>
        </div>
        <button
          type="button"
          onClick={() => goTo(2)}
          className="inline-flex min-h-[36px] flex-none items-center gap-1 text-sm font-extrabold text-secondary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('common.change')}
        </button>
      </div>

      <fieldset>
        <legend className="lbl flex flex-wrap items-center gap-2">
          {t('delivery.branchOrigin')}{' '}
          <SimulationBadge kind="demo">{t('delivery.branchDemo')}</SimulationBadge>
        </legend>
        <p className="m-0 mb-2.5 text-[13px] text-muted">{t('delivery.branchAuto')}</p>
        <div
          className="flex flex-col gap-2.5"
          role="radiogroup"
          aria-label={t('delivery.branchOrigin')}
        >
          {branches.map((b) => {
            const current = (draft.deliveryBranchId ?? quote?.branchId ?? autoBranch?.id) === b.id;
            return (
              <ChoiceCard
                key={b.id}
                on={current}
                disabled={loading}
                onClick={() =>
                  dispatch({
                    type: 'delivery-branch',
                    branchId: b.id === autoBranch?.id ? null : b.id,
                  })
                }
                icon={<Store className="h-5 w-5" aria-hidden="true" />}
                title={b.name}
                sub={area(b)}
                badge={
                  b.id === autoBranch?.id ? (
                    <span
                      className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-extrabold text-success"
                      title={t('checkoutFlow.autoBranch')}
                    >
                      ★
                    </span>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </fieldset>

      <div aria-live="polite" className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <Loader2 className="anim-spin h-6 w-6 text-secondary" aria-hidden="true" />
            <span className="font-bold">{t('delivery.calculating')}</span>
          </div>
        ) : null}

        {quoteQuery.isError && data.quoteRequested ? (
          <ErrorNotice message={t('validation.quote')} onRetry={() => void quoteQuery.refetch()} />
        ) : null}

        {data.covered && quote && quote.fee !== null && quote.tier ? (
          <div className="rounded-2xl border border-secondary/40 bg-secondary-soft p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted">
                  {t('delivery.estimated')}{' '}
                  {quote.simulated ? (
                    <SimulationBadge kind="demo">{t('common.demo')}</SimulationBadge>
                  ) : null}
                </p>
                <p
                  className="m-0 mt-1 font-display text-[34px] leading-none"
                  data-testid="shipping-fee"
                >
                  {money(quote.fee)}
                </p>
                <p className="m-0 mt-1.5 text-[14px] font-bold">
                  {t(`delivery.tier.${quote.tier}`)} · {branch?.name ?? quote.branchId}
                </p>
                {quote.etaMinMinutes != null && quote.etaMaxMinutes != null ? (
                  <p className="m-0 text-[13px] text-muted">
                    {t('delivery.eta', { a: quote.etaMinMinutes, b: quote.etaMaxMinutes })}
                  </p>
                ) : null}
              </div>
              <Truck className="h-8 w-8 flex-none text-secondary" aria-hidden="true" />
            </div>
            <div className="mt-3 border-t border-dashed border-line pt-3 text-[14px]">
              <div className="flex justify-between">
                <span className="text-muted">{t('common.subtotal')}</span>
                <span>{money(data.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('checkout.estimatedShipping')}</span>
                <span>{money(quote.fee)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-extrabold">{t('checkout.estimatedTotal')}</span>
                <span className="font-display text-[22px]">{money(data.total)}</span>
              </div>
            </div>
          </div>
        ) : null}

        {uncovered ? (
          <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4" role="alert">
            <p className="m-0 flex items-start gap-2 font-bold text-fg">
              <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-danger" aria-hidden="true" />
              {quote?.reason === 'branch_not_covered'
                ? t('delivery.notCoveredBranch')
                : t('delivery.notCovered')}
            </p>
            <p className="m-0 mt-1.5 pl-7 text-[14px] font-bold">{t('addr.notCovered')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn !min-h-[42px] !px-4 text-sm"
                onClick={() => goTo(2)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" /> {t('common.change')}
              </button>
              {draft.deliveryBranchId ? (
                <button
                  type="button"
                  className="btn !min-h-[42px] !px-4 text-sm"
                  onClick={() => dispatch({ type: 'delivery-branch', branchId: null })}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('delivery.recalc')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary !min-h-[42px] !px-4 text-sm"
                onClick={() => {
                  update({ type: 'pickup' });
                  dispatch({ type: 'goto', step: 3 });
                }}
              >
                <Store className="h-4 w-4" aria-hidden="true" /> {t('checkoutFlow.switchToPickup')}
              </button>
            </div>
          </div>
        ) : null}

        <ClosedBranchNotice data={data} onSchedule={schedule} />

        <p className="m-0 mt-1 text-[12px] leading-snug text-muted">{t('delivery.disclaimer')}</p>
        <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] leading-snug text-muted">
          {t('delivery.provider')} <SimulationBadge kind="simulation" />
        </p>
        {!data.quoteRequested && !loading ? (
          <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
            <Clock className="h-4 w-4" aria-hidden="true" /> {t('delivery.needAddress')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

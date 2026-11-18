'use client';

import { Clock, Loader2, MapPin, Pencil, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { BranchHoursDisclosure } from '@/features/branch-schedule/components/BranchHoursPanel';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { MapLinks } from '@/features/store-shell/components/StoreFooter';
import { formatAddress, type CheckoutStep } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import type { CheckoutData } from '../use-checkout-data';
import { CouponField } from './CouponField';
import { DeliveryOptions } from './DeliveryOptions';
import { ChoiceCard, useCheckoutSteps } from './parts';

/**
 * Paso 3 · Envío. La sucursal es la DEL CARRITO (F18, una sola): cambiarla pasa por el flujo de cambio de sucursal del carrito
 * (nada se reasigna ni se vacía en silencio). A domicilio: destino y tipo de entrega con la tarifa AL CLIENTE que devuelve la
 * cotización del servidor (cada proveedor se evalúa por separado; PedidosYa nunca es seleccionable). Al recoger: sucursal.
 * El cupón aplica a ambas modalidades. Los bloqueos y avisos de la cotización se muestran arriba (`QuoteAlerts`).
 */
export function ShippingStep({
  data,
  goTo,
  summary,
}: {
  data: CheckoutData;
  goTo: (step: CheckoutStep) => void;
  /** Resumen de compra (solo móvil/tablet: en escritorio vive en la columna lateral). */
  summary: ReactNode;
}) {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const { draft, dispatch } = useCheckoutDraft();
  const { update } = useOrderMode();
  const { config, branches } = data;
  const zoneWord = t('checkoutFlow.zoneInline');

  const pickBranch = (branchId: string) => {
    dispatch({ type: 'pickup-branch', branchId });
    // El modo de pedido manda: si difiere de la sucursal del carrito, `CartBranchGuard` abre el plan de cambio (F18).
    update({ branchId });
  };

  const branchList = (name: string, sub?: string) => {
    // El radio sigue en la sucursal DEL CARRITO hasta que el cliente confirma el cambio en el flujo de F18 (`CartBranchGuard`).
    const currentId = data.branchId;
    return (
      <fieldset id="checkout-branch-list" tabIndex={-1} className="outline-none">
        <legend className="lbl flex flex-wrap items-center gap-2">
          {name}{' '}
          {data.isSimulation ? (
            <SimulationBadge kind="demo">{t('delivery.branchDemo')}</SimulationBadge>
          ) : null}
        </legend>
        {sub ? <p className="m-0 mb-2.5 text-[13px] text-muted">{sub}</p> : null}
        <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={name}>
          {branches.map((b) => (
            <ChoiceCard
              key={b.id}
              on={currentId === b.id}
              onClick={() => pickBranch(b.id)}
              icon={<Store className="h-5 w-5" aria-hidden="true" />}
              title={b.name}
              sub={b.address}
              badge={
                data.availability[b.id]?.isAcceptingOrders === false ? (
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-extrabold text-fg">
                    {t('mode.closedBadge')}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
        {currentId ? (
          <BranchHoursDisclosure
            branchId={currentId}
            name={branches.find((b) => b.id === currentId)?.name ?? ''}
          />
        ) : null}
      </fieldset>
    );
  };

  if (data.type !== 'delivery') {
    return (
      <section aria-label={steps[2]} className="flex flex-col gap-5">
        {branchList(t('delivery.branchPickup'))}
        {config && branches[0] && data.branchId === branches[0].id ? (
          <MapLinks config={config} />
        ) : null}
        <p className="notice notice-info m-0">
          {t('delivery.pickupNoFee')} {t('delivery.prepTime')}.
        </p>
        <CouponField data={data} />
        <div className="lg:hidden">{summary}</div>
      </section>
    );
  }

  // Con una respuesta previa de la misma sesión las opciones siguen montadas (atenuadas); sin ella, un indicador de carga.
  const calculating =
    !data.shownQuote && (data.quote.status === 'loading' || data.quote.status === 'expired');
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
          className="inline-flex min-h-[44px] flex-none items-center gap-1 text-sm font-extrabold text-secondary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('common.change')}
        </button>
      </div>

      {branchList(t('delivery.branchOrigin'), t('checkout.quote.branchOrigin'))}

      <div className="flex flex-col gap-3">
        {calculating ? (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <Loader2 className="anim-spin h-6 w-6 text-secondary" aria-hidden="true" />
            <span className="font-bold">{t('delivery.calculating')}</span>
          </div>
        ) : (
          <DeliveryOptions data={data} />
        )}
        <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] leading-snug text-muted">
          {t('delivery.provider')}
          {data.isSimulation ? <SimulationBadge kind="simulation" /> : null}
        </p>
        {data.quote.status === 'idle' && !data.branchMismatch ? (
          <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
            <Clock className="h-4 w-4" aria-hidden="true" /> {t('delivery.needAddress')}
          </p>
        ) : null}
      </div>

      <CouponField data={data} />
      <div className="lg:hidden">{summary}</div>
    </section>
  );
}

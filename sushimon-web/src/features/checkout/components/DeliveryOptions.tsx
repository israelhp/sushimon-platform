'use client';

import { Bike, Truck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { cn } from '@/lib/cn';
import { moneyToCents, reasonMessageKey, type CourierProvider } from '@/lib/checkout-quote';
import type { CheckoutDeliveryOption } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import type { CheckoutData } from '../use-checkout-data';

/**
 * Defensa en profundidad: PedidosYa NUNCA es seleccionable aunque el servidor (o un mock) lo marcara (tarifa al cliente sin política
 * aprobada y integración bloqueada). Solo OWN con `selectable` se puede elegir.
 */
export const isSelectable = (option: CheckoutDeliveryOption): boolean =>
  option.selectable && option.provider !== 'PEDIDOSYA';

/** Estado visible de un proveedor. PedidosYa NUNCA se presenta como «disponible» (tarifa y cobertura sin verificar: BLOCKED_EXTERNAL). */
export function optionStatus(
  option: CheckoutDeliveryOption,
): 'available' | 'unavailable' | 'unknown' | 'simulated' {
  if (option.provider === 'PEDIDOSYA') {
    if (option.simulated || option.integrationStatus === 'MOCK') return 'simulated';
    return option.coverageStatus === 'UNAVAILABLE' ? 'unavailable' : 'unknown';
  }
  if (isSelectable(option) && option.coverageStatus === 'AVAILABLE') return 'available';
  return option.coverageStatus === 'UNKNOWN' ? 'unknown' : 'unavailable';
}

/**
 * Proveedores de entrega de la cotización (`delivery.options`), evaluados POR SEPARADO. Radios NATIVOS (teclado y lector de pantalla
 * gratis) bajo un solo `fieldset`. Muestra la tarifa AL CLIENTE (nunca el costo del proveedor) y solo permite elegir los
 * seleccionables; los demás van `disabled`. Se mantiene montado mientras recotiza (atenuado, sin aceptar cambios) para no perder
 * el foco del radio.
 */
export function DeliveryOptions({ data }: { data: CheckoutData }) {
  const t = useTranslations('checkout');
  const tr = useTranslations();
  const locale = useLocale();
  const delivery = data.shownQuote?.fulfillment.delivery ?? null;
  if (!delivery) return null;
  const updating = data.quote.updating;
  return (
    <fieldset
      aria-busy={updating || undefined}
      className={cn('min-h-[148px]', updating && 'opacity-60')}
    >
      <legend className="lbl">{t('quote.providers.title')}</legend>
      <p className="m-0 mb-2.5 text-[13px] text-muted">{t('quote.providers.help')}</p>
      <div className="flex flex-col gap-2.5">
        {delivery.options.map((option) => {
          const status = optionStatus(option);
          const selectable = isSelectable(option);
          const selected = delivery.selectedProvider === option.provider;
          const feeCents = selectable ? moneyToCents(option.customerFee) : null;
          const Icon = option.provider === 'OWN' ? Truck : Bike;
          return (
            <label
              key={option.provider}
              className={cn(
                'flex min-h-[68px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-secondary',
                selected
                  ? 'border-secondary bg-secondary-soft shadow-card'
                  : 'border-line bg-surface',
                selectable ? 'cursor-pointer hover:bg-subtle' : 'cursor-not-allowed border-dashed',
              )}
            >
              <input
                type="radio"
                name="checkout-delivery-provider"
                className="sr-only"
                checked={selected}
                disabled={!selectable}
                data-provider={option.provider}
                data-status={status}
                onChange={() => {
                  // Recalculando: no se acepta otro cambio hasta que llegue la cotización de las entradas actuales.
                  if (selectable && !updating) data.setProvider(option.provider as CourierProvider);
                }}
              />
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-extrabold">
                  {t(`quote.providers.${option.provider}`)}
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-extrabold text-fg">
                    {t(`quote.providers.${status}`)}
                  </span>
                  {option.simulated || data.isSimulation ? <SimulationBadge /> : null}
                </span>
                <span
                  className={cn(
                    'block text-[13px] leading-snug',
                    selected ? 'text-fg/80' : 'text-muted',
                  )}
                  data-testid={feeCents !== null ? 'shipping-fee' : undefined}
                >
                  {feeCents !== null
                    ? t('quote.providers.fee', { a: formatMoney(feeCents / 100, locale) })
                    : tr(reasonMessageKey(option.unavailableReason))}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'h-5 w-5 flex-none rounded-full border-2',
                  selected ? 'border-secondary bg-secondary' : 'border-line',
                )}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

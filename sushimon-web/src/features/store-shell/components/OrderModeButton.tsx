'use client';

import { ChevronDown, Store, Truck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { localDate } from '@/lib/time';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { formatWhen } from '@/features/order-mode/when';
import { useStoreConfig } from '@/features/store/hooks';
import { useStoreShell } from '../store-shell-context';

/**
 * Botón de modo de pedido: "Iniciar pedido ▾" mientras no se haya elegido; después, cápsula con
 * recoger/domicilio y cuándo ("Lo antes posible", "Hoy, 3:30 p. m."). Abre la hoja de modo de pedido.
 */
export function OrderModeButton({ className }: { className?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const { mode, isSet } = useOrderMode();
  const { openOrderSheet } = useStoreShell();
  const config = useStoreConfig();
  const today = config.data ? localDate(new Date(config.data.serverTime)) : null;

  if (!isSet) {
    return (
      <button
        type="button"
        onClick={() => openOrderSheet('now')}
        className={cn(
          'inline-flex min-h-[40px] flex-none items-center gap-1 whitespace-nowrap rounded-full border border-secondary/25 bg-surface px-3 text-[13px] font-extrabold text-fg shadow-card max-[399px]:px-2.5 max-[399px]:text-[12px] max-[339px]:px-2 max-[339px]:text-[11.5px]',
          className,
        )}
      >
        {t('mode.start')} <ChevronDown className="h-4 w-4 flex-none" aria-hidden="true" />
      </button>
    );
  }

  const Icon = mode.type === 'delivery' ? Truck : Store;
  const typeLabel = mode.type === 'delivery' ? t('mode.delivery') : t('mode.pickup');
  const whenLabel = formatWhen(mode.when, today, locale, {
    asap: t('when.asap'),
    today: t('when.today'),
    tomorrow: t('when.tomorrow'),
  });
  return (
    <button
      type="button"
      onClick={() => openOrderSheet(mode.when.kind === 'scheduled' ? 'schedule' : 'now')}
      aria-label={t('mode.changeAria', { a: typeLabel, b: whenLabel })}
      className={cn(
        'inline-flex min-h-[40px] min-w-0 items-center gap-2 rounded-full border border-secondary/25 bg-surface py-1 pl-1 pr-2 text-left shadow-card',
        className,
      )}
    >
      <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-onprimary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-extrabold">{typeLabel}</span>
        <span className="block truncate text-[11px] text-muted">{whenLabel}</span>
      </span>
      <ChevronDown className="h-4 w-4 flex-none" aria-hidden="true" />
    </button>
  );
}

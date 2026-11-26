'use client';

import { ChevronDown, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useStoreShell } from '../store-shell-context';

/**
 * Botón de modo de pedido: "Iniciar pedido ▾" mientras no se haya elegido; después, cápsula "A domicilio" con la
 * dirección elegida. Abre la hoja «Pedir ahora» (ADR-0036: solo a domicilio e inmediato).
 */
export function OrderModeButton({ className }: { className?: string }) {
  const t = useTranslations();
  const { mode, isSet } = useOrderMode();
  const { openOrderSheet } = useStoreShell();

  if (!isSet) {
    return (
      <button
        type="button"
        onClick={() => openOrderSheet()}
        className={cn(
          'inline-flex min-h-[40px] flex-none items-center gap-1 whitespace-nowrap rounded-full border border-secondary/25 bg-surface px-3 text-[13px] font-extrabold text-fg shadow-card max-[399px]:px-2.5 max-[399px]:text-[12px] max-[339px]:px-2 max-[339px]:text-[11.5px]',
          className,
        )}
      >
        {t('mode.start')} <ChevronDown className="h-4 w-4 flex-none" aria-hidden="true" />
      </button>
    );
  }

  const typeLabel = t('mode.delivery');
  const placeLabel = mode.address
    ? [mode.address.line, mode.address.municipality].filter(Boolean).join(', ')
    : '';
  return (
    <button
      type="button"
      onClick={() => openOrderSheet()}
      aria-label={t('mode.changeAria', { a: typeLabel, b: placeLabel })}
      className={cn(
        'inline-flex min-h-[40px] min-w-0 items-center gap-2 rounded-full border border-secondary/25 bg-surface py-1 pl-1 pr-2 text-left shadow-card',
        className,
      )}
    >
      <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-onprimary">
        <Truck className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-extrabold">{typeLabel}</span>{' '}
        <span className="block truncate text-[11px] text-muted">{placeLabel}</span>
      </span>
      <ChevronDown className="h-4 w-4 flex-none" aria-hidden="true" />
    </button>
  );
}

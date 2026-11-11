import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface PriceProps {
  value: number;
  /** Precio anterior tachado (promociones). */
  previous?: number | null;
  /** `'auto'` (0–2 decimales, precios de menú) o `2` (totales). Por defecto `'auto'`, como las tarjetas del prototipo. */
  decimals?: 2 | 'auto';
  className?: string;
  previousClassName?: string;
}

/** Precio con la tipografía del prototipo (`price`: Archivo Black 19/22 px) y precio anterior opcional. */
export function Price({
  value,
  previous,
  decimals = 'auto',
  className,
  previousClassName,
}: PriceProps) {
  const t = useTranslations('ui');
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={cn('price', className)}>{formatMoney(value, 'es', { decimals })}</span>
      {previous != null && previous > value ? (
        <s className={cn('text-sm font-bold text-muted', previousClassName)}>
          <span className="sr-only">{t('previousPrice')}: </span>
          {formatMoney(previous, 'es', { decimals })}
        </s>
      ) : null}
    </span>
  );
}

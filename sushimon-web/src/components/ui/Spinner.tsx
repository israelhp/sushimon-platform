import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SpinnerProps {
  zone?: Zone;
  className?: string;
  /** Texto para lectores de pantalla; por defecto «Cargando…». `null` si el contenedor ya lo anuncia. */
  label?: string | null;
}

/** Indicador de carga: tienda = LoaderCircle con `anim-spin`; backoffice = `.spinner`. */
export function Spinner({ zone = 'store', className, label }: SpinnerProps) {
  const t = useTranslations('ui');
  const text = label === undefined ? t('loading') : label;
  return (
    <span role={text ? 'status' : undefined} className={cn('inline-flex items-center', className)}>
      {zone === 'bo' ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
      )}
      {text ? <span className="sr-only">{text}</span> : null}
    </span>
  );
}

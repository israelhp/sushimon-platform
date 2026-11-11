import Image from 'next/image';
import { cn } from '@/lib/cn';

export interface LogoProps {
  /** `header` (h-6 → h-8 desde 400 px → h-9 desde md) o `footer` (h-12 → h-14 desde md), como el prototipo. */
  size?: 'header' | 'footer';
  /** Forzar la versión clara (crema) sobre fondos oscuros (pie de página, bandas). */
  onDark?: boolean;
  className?: string;
  /** Prioridad de carga (logo del encabezado). */
  priority?: boolean;
}

/**
 * Logotipo MON SUSHI de la tienda (PNG 982×265 del prototipo). Sin JavaScript: las dos versiones se
 * renderizan y CSS muestra la adecuada al tema (`.dark`), evitando parpadeos. `onDark` fuerza la versión crema.
 */
export function Logo({ size = 'header', onDark = false, className, priority = false }: LogoProps) {
  const sizing = size === 'footer' ? 'h-12 md:h-14' : 'h-6 min-[400px]:h-8 md:h-9';
  const common = { width: 982, height: 265, priority } as const;
  if (onDark) {
    return (
      <Image
        src="/brand/logo-dark.png"
        alt="MON SUSHI"
        {...common}
        className={cn('block w-auto', sizing, className)}
      />
    );
  }
  return (
    <span className={cn('inline-flex', className)}>
      <Image
        src="/brand/logo-light.png"
        alt="MON SUSHI"
        {...common}
        className={cn('block w-auto dark:hidden', sizing)}
      />
      <Image
        src="/brand/logo-dark.png"
        alt="MON SUSHI"
        {...common}
        className={cn('hidden w-auto dark:block', sizing)}
      />
    </span>
  );
}

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  zone?: Zone;
}

/**
 * Bloque de carga (decorativo, `aria-hidden`). Dimensiones con utilidades (`h-5 w-40`, `h-[220px]`…).
 * Anuncia la carga con un `Spinner` o `aria-busy` en el contenedor.
 */
export function Skeleton({ zone = 'store', className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-xl',
        zone === 'bo' ? 'bg-[var(--bo-surface-2)]' : 'bg-subtle',
        className,
      )}
      {...rest}
    />
  );
}

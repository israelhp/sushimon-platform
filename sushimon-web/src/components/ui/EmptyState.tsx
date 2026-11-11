import type { ReactNode } from 'react';
import { FoodArt, type FoodArtKind } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Acción (p. ej. un `Button`). */
  action?: ReactNode;
  zone?: Zone;
  /** Tienda: ilustración en círculo `tile-cream` (por defecto `roll`, como el carrito vacío). `null` para ocultarla. */
  art?: FoodArtKind | null;
  /** Tienda: tamaño compacto (ilustración de 72 px). */
  compact?: boolean;
  className?: string;
}

/**
 * Estado vacío / sin resultados. Tienda: como el carrito vacío del prototipo (título `disp`).
 * Backoffice: `.empty` con `.empty-t` y texto `.sm`.
 */
export function EmptyState({
  title,
  description,
  action,
  zone = 'store',
  art = 'roll',
  compact = false,
  className,
}: EmptyStateProps) {
  if (zone === 'bo') {
    return (
      <div className={cn('empty', className)}>
        <div className="empty-t">{title}</div>
        {description ? <div className="sm">{description}</div> : null}
        {action}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
    >
      {art ? (
        <span className="tile-cream inline-flex rounded-full p-4">
          <FoodArt kind={art} className={compact ? 'h-[72px] w-[72px]' : 'h-[96px] w-[96px]'} />
        </span>
      ) : null}
      <h3 className="disp text-[22px]">{title}</h3>
      {description ? <p className="m-0 text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

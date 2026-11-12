import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

/**
 * Tonos semánticos comunes a ambas zonas. En el backoffice equivalen a las clases `st-*` del prototipo:
 * alert=st-listo (pedido nuevo) · confirmed=st-conf · warning=st-prep · info=st-asig ·
 * active=st-rep (punto pulsante) · success=st-ok · danger=st-inc · muted=st-can.
 */
export type PillTone =
  'alert' | 'confirmed' | 'warning' | 'info' | 'active' | 'success' | 'danger' | 'muted';

export const BO_PILL_CLASS: Record<PillTone, string> = {
  alert: 'st-listo',
  confirmed: 'st-conf',
  warning: 'st-prep',
  info: 'st-asig',
  active: 'st-rep',
  success: 'st-ok',
  danger: 'st-inc',
  muted: 'st-can',
};

const STORE_PILL_CLASS: Record<PillTone, string> = {
  alert: 'bg-primary-soft text-primary',
  confirmed: 'bg-subtle text-fg',
  warning: 'bg-accent-soft text-fg',
  info: 'bg-secondary-soft text-secondary',
  active: 'bg-deep text-ondeep',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-subtle text-muted',
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  zone?: Zone;
  /** Tienda: muestra un punto de color (en el backoffice siempre está, como en el prototipo). */
  dot?: boolean;
}

/** Etiqueta compacta. El significado nunca depende solo del color: siempre lleva texto. */
export function Pill({
  tone = 'confirmed',
  zone = 'store',
  dot = false,
  className,
  children,
  ...rest
}: PillProps) {
  if (zone === 'bo') {
    return (
      <span className={cn('pill', BO_PILL_CLASS[tone], className)} {...rest}>
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[12px] font-extrabold',
        STORE_PILL_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}

/** Pill de estado (pedido, entrega, sucursal…): como `Pill`, con punto visible también en la tienda. */
export function StatusPill(props: PillProps) {
  return <Pill dot {...props} />;
}

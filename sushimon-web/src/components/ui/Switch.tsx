'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'aria-checked'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Nombre accesible (p. ej. «Disponible: Roll Mon»). Obligatorio: el interruptor no tiene texto. */
  label: string;
  /** Estado intermedio (`aria-checked="mixed"`; en el backoffice, clase `part`). */
  mixed?: boolean;
  zone?: Zone;
}

/**
 * Interruptor accesible (`role="switch"`): se activa con clic, Espacio o Enter (botón nativo).
 * Backoffice: `.switch` / `.switch.on` / `.switch.part`. Tienda: misma geometría con tokens de la tienda.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  mixed = false,
  zone = 'store',
  className,
  disabled,
  ...rest
}: SwitchProps) {
  const state = mixed ? 'mixed' : checked;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={state}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(mixed ? true : !checked)}
      className={cn(
        zone === 'bo'
          ? cn('switch', checked && !mixed && 'on', mixed && 'part')
          : cn(
              'relative inline-flex h-6 w-11 flex-none rounded-full p-0 transition-colors disabled:opacity-50',
              'after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-surface after:shadow-card after:transition-transform after:content-[""]',
              mixed
                ? 'bg-accent after:translate-x-[10px]'
                : checked
                  ? 'bg-success after:translate-x-5'
                  : 'bg-line',
            ),
        className,
      )}
      {...rest}
    />
  );
}

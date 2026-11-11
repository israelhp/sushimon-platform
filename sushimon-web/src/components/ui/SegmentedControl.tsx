'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nombre accesible del grupo (p. ej. «Vista de pedidos»). */
  label: string;
  zone?: Zone;
  className?: string;
}

/**
 * Selector de una opción entre varias (grupo de botones con `aria-pressed`, como el prototipo).
 * Backoffice: `.seg` / `button.on`. Tienda: cápsula con la opción activa en `bg-deep`.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  zone = 'store',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        zone === 'bo'
          ? 'seg'
          : 'inline-flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={
              zone === 'bo'
                ? cn(active && 'on')
                : cn(
                    'inline-flex min-h-[40px] items-center justify-center rounded-full px-4 text-[14px] font-extrabold transition-colors disabled:opacity-50',
                    active ? 'bg-deep text-ondeep' : 'text-muted hover:text-fg',
                  )
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

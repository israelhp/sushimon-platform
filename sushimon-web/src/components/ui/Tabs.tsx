'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Contador opcional (`tab-count`). */
  count?: number;
  /** id del panel que controla, si existe (`aria-controls`). */
  controls?: string;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nombre accesible de la lista (p. ej. «Filtrar por estado»). */
  label: string;
  zone?: Zone;
  className?: string;
}

/**
 * Pestañas con contador (`role="tablist"`). Flechas ←/→, Inicio y Fin mueven el foco y seleccionan
 * (activación automática); solo la pestaña activa está en el orden de tabulación.
 * Backoffice: `.tabs` / `.tab.on` / `.tab-count`. Tienda: cápsulas con la activa en `bg-deep`.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  zone = 'store',
  className,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        zone === 'bo' ? 'tabs' : 'no-scrollbar flex max-w-full gap-2 overflow-x-auto p-0.5',
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={item.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              zone === 'bo'
                ? cn('tab', selected && 'on')
                : cn(
                    'inline-flex min-h-[40px] flex-none items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[14px] font-extrabold transition-colors',
                    selected
                      ? 'border-transparent bg-deep text-ondeep'
                      : 'border-line bg-surface text-fg hover:bg-subtle',
                  )
            }
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={
                  zone === 'bo'
                    ? 'tab-count'
                    : cn(
                        'rounded-full px-[7px] text-[11px] tabular-nums',
                        selected ? 'bg-ondeep/20 text-ondeep' : 'bg-subtle text-muted',
                      )
                }
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

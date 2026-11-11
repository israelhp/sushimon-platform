'use client';

import type { ReactNode } from 'react';
import { IconChevronDown } from '@/components/icons/bo';
import { PopoverRoot, usePopover } from '@/features/backoffice-shell/use-popover';
import { cn } from '@/lib/cn';

export interface FilterSelectOption {
  value: string;
  label: string;
  /** Texto secundario a la derecha (p. ej. "12 envíos"). */
  sub?: string;
}

/**
 * Selector desplegable de los filtros de Entregas (`brsel` + `menu-pop` del prototipo): botón con ícono, valor y
 * chevron; al abrir lista opciones con su conteo. Se cierra con clic fuera o Esc.
 */
export function FilterSelect({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  /** Nombre accesible del botón (p. ej. "Repartidor"). */
  label: string;
  icon: ReactNode;
  value: string;
  options: readonly FilterSelectOption[];
  onChange: (value: string) => void;
}) {
  const popover = usePopover();
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <PopoverRoot className="brsel" open={popover.open} onDismiss={popover.close}>
      <button
        type="button"
        className="brsel-btn"
        style={{ width: '100%', maxWidth: 'none' }}
        aria-haspopup="true"
        aria-expanded={popover.open}
        aria-label={`${label}: ${current}`}
        onClick={popover.toggle}
      >
        {icon}
        <span className="trunc grow" style={{ textAlign: 'left' }}>
          {current}
        </span>
        <IconChevronDown size="sm" />
      </button>
      {popover.open ? (
        <div className="menu-pop" style={{ maxHeight: 300, overflowY: 'auto', width: '100%' }}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={cn('menu-item', o.value === value && 'on')}
              onClick={() => {
                onChange(o.value);
                popover.close();
              }}
            >
              <span className="grow">{o.label}</span>
              {o.sub ? (
                <span className="xs muted" style={{ fontWeight: 700 }}>
                  {o.sub}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </PopoverRoot>
  );
}

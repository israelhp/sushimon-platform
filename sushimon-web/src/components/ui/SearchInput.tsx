'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type InputHTMLAttributes } from 'react';
import { IconClose, IconSearch } from '@/components/icons/bo/icons';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Nombre accesible; por defecto «Buscar». */
  label?: string;
  zone?: Zone;
  /** Backoffice: variante `inline` (280 px, 100 % en móvil). */
  inline?: boolean;
  /** Muestra un botón para limpiar cuando hay texto. */
  clearable?: boolean;
  wrapperClassName?: string;
}

/** Campo de búsqueda: backoffice `label.search`; tienda `input` con lupa a la izquierda. */
export function SearchInput({
  value,
  onValueChange,
  label,
  zone = 'store',
  inline = false,
  clearable = true,
  wrapperClassName,
  className,
  ...rest
}: SearchInputProps) {
  const t = useTranslations('ui');
  const inputRef = useRef<HTMLInputElement>(null);
  const name = label ?? t('search');
  const clear =
    clearable && value ? (
      <button
        type="button"
        onClick={() => {
          onValueChange('');
          inputRef.current?.focus();
        }}
        aria-label={t('clearSearch')}
        className={
          zone === 'bo'
            ? 'icon-btn'
            : 'absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-fg'
        }
        style={zone === 'bo' ? { width: 28, height: 28 } : undefined}
      >
        {zone === 'bo' ? <IconClose size="sm" /> : <X className="h-4 w-4" aria-hidden="true" />}
      </button>
    ) : null;

  if (zone === 'bo') {
    return (
      // `inline` es también la utilidad `display:inline` de Tailwind (capa utilities > components): `flex!` la anula.
      <label className={cn('search', inline && 'inline flex!', wrapperClassName)}>
        <IconSearch size="sm" />
        <input
          ref={inputRef}
          type="search"
          aria-label={name}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={className}
          {...rest}
        />
        {clear}
      </label>
    );
  }
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        aria-label={name}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn('input pl-12', clearable && 'pr-12', className)}
        {...rest}
      />
      {clear}
    </div>
  );
}

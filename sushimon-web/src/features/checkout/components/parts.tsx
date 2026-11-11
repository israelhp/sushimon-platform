'use client';

import { Check, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Propiedades que `Field` entrega al control para asociar la etiqueta y el error (`aria-describedby`). */
export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  className: string;
}

/**
 * Campo de formulario con etiqueta y error accesibles: el mensaje queda enlazado al control con
 * `aria-describedby` y `aria-invalid` (el checkout enfoca el primer control inválido).
 */
export function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': !!error,
        'aria-describedby': error ? errorId : undefined,
        className: 'input',
      })}
      {error ? (
        <p id={errorId} className="err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Opción tipo radio en tarjeta (método de pago, direcciones, sucursales). */
export function ChoiceCard({
  on,
  onClick,
  icon,
  title,
  sub,
  badge,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[68px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition disabled:opacity-50',
        on
          ? 'border-secondary bg-secondary-soft shadow-card ring-1 ring-secondary'
          : 'border-line bg-surface hover:bg-subtle',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 flex-none items-center justify-center rounded-xl',
          on ? 'bg-secondary text-onsecondary' : 'bg-subtle text-secondary',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-extrabold">
          {title} {badge}
        </span>
        {sub ? (
          <span className={cn('block text-[13px] leading-snug', on ? 'text-fg/80' : 'text-muted')}>
            {sub}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'flex h-6 w-6 flex-none items-center justify-center rounded-full border-2',
          on ? 'border-secondary bg-secondary text-onsecondary' : 'border-line',
        )}
        aria-hidden="true"
      >
        {on ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
    </button>
  );
}

/** Fila de revisión (paso 5): ícono, título, valor y "Cambiar". */
export function ReviewRow({
  icon,
  title,
  children,
  onEdit,
  editLabel,
  editAria,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onEdit: () => void;
  editLabel: string;
  editAria: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-muted">{title}</p>
        <div className="text-[15px] font-bold leading-snug">{children}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={editAria}
        className="inline-flex min-h-[36px] flex-none items-center gap-1 text-sm font-extrabold text-secondary"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {editLabel}
      </button>
    </div>
  );
}

/** Botón de texto "✎ Cambiar" de las cabeceras de sección. */
export function ChangeButton({
  onClick,
  label,
  ariaLabel,
}: {
  onClick: () => void;
  label: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex min-h-[36px] items-center gap-1 text-sm font-extrabold text-secondary"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}

/** Etiquetas de los 5 pasos ("Tu pedido", "Entrega", "Envío", "Pago", "Confirmación"). */
export function useCheckoutSteps(): string[] {
  const t = useTranslations('checkout');
  return t.raw('steps') as string[];
}

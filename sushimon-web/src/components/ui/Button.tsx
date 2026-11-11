import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';
import type { Zone } from './zone';

export type ButtonVariant =
  'default' | 'primary' | 'dark' | 'ghost' | 'outline' | 'danger' | 'green' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  zone?: Zone;
  /** Ancho completo. */
  block?: boolean;
  /** Muestra un spinner y deshabilita el botón (aria-busy). */
  loading?: boolean;
  /** Ícono decorativo antes del texto. */
  icon?: ReactNode;
}

/**
 * Clases del botón según zona. Útil también para enlaces (`<Link className={buttonClasses({...})}>`).
 * Tienda: `btn` (+ `btn-primary`/`btn-dark`/`link-btn`); md = 52 px, sm = 44 px, lg = 56 px.
 * Backoffice: `btn` (+ `btn-primary` [oscuro, como el prototipo], `btn-dark` [rojo], `btn-ghost`, `btn-green`,
 * `danger`, `sm`, `lg`, `block`). `outline` en el backoffice es el `btn` por defecto.
 */
export function buttonClasses({
  variant = 'default',
  size = 'md',
  zone = 'store',
  block = false,
}: Pick<ButtonProps, 'variant' | 'size' | 'zone' | 'block'> = {}): string {
  if (zone === 'bo') {
    if (variant === 'link') return 'link-btn';
    return cn(
      'btn',
      variant === 'primary' && 'btn-primary',
      variant === 'dark' && 'btn-dark',
      variant === 'ghost' && 'btn-ghost',
      variant === 'green' && 'btn-green',
      variant === 'danger' && 'danger',
      size === 'sm' && 'sm',
      size === 'lg' && 'lg',
      block && 'block',
    );
  }
  if (variant === 'link') return cn('link-btn', block && 'w-full');
  return cn(
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'dark' && 'btn-dark',
    variant === 'green' && 'border-transparent bg-success text-ondeep',
    variant === 'ghost' &&
      'border-transparent bg-transparent shadow-none hover:bg-subtle hover:shadow-none',
    variant === 'outline' && 'bg-transparent shadow-none',
    variant === 'danger' && 'border-danger/40 text-danger',
    size === 'sm' && '!min-h-[44px] px-4 text-[15px]',
    size === 'lg' && '!min-h-[56px] px-7 text-[17px]',
    block && 'w-full',
  );
}

export function Button({
  variant,
  size,
  zone = 'store',
  block,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size, zone, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner zone={zone} label={null} /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Nombre accesible obligatorio (el ícono es decorativo). */
  label: string;
  zone?: Zone;
  /** Backoffice: borde y fondo (`bordered`). En la tienda siempre lleva borde. */
  bordered?: boolean;
}

/** Botón de ícono: tienda = círculo de 44 px con borde; backoffice = `.icon-btn` (42 px). */
export function IconButton({
  label,
  zone = 'store',
  bordered = true,
  className,
  type = 'button',
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(
        zone === 'bo'
          ? cn('icon-btn', bordered && 'bordered')
          : 'inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line bg-surface text-fg hover:bg-subtle disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

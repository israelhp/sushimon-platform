'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { IconClose } from '@/components/icons/bo/icons';
import { cn } from '@/lib/cn';
import { Portal } from './Portal';
import { useDialog } from './use-dialog';
import type { Zone } from './zone';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Título visible y nombre accesible del diálogo. */
  title: string;
  children?: ReactNode;
  /** Pie (acciones). */
  footer?: ReactNode;
  zone?: Zone;
  /** Tienda: capa `top` (z 110/120) para diálogos sobre otros overlays; `base` (z 70/90). */
  layer?: 'base' | 'top';
  /** Backoffice: ancho `narrow` (440), `default` (560) o `wide` (760). */
  size?: 'narrow' | 'default' | 'wide';
  /** Backoffice: ícono de cabecera (`modal-ic`) y su tono (`mi-coral`, `mi-blue`, `mi-green`, `mi-dark`). */
  icon?: ReactNode;
  iconTone?: 'coral' | 'blue' | 'green' | 'dark';
  /** Backoffice: subtítulo bajo el título. */
  description?: ReactNode;
  className?: string;
  /** Tienda: tamaño del título (por defecto `text-[24px]`; las hojas de "Pedir ahora" e "Iniciar sesión" usan 26). */
  titleClassName?: string;
  /** `alertdialog` para decisiones que exigen respuesta (confirmar un borrado, cambiar de sucursal). */
  role?: 'dialog' | 'alertdialog';
}

/**
 * Diálogo modal accesible (role="dialog"|"alertdialog", aria-modal, foco atrapado, Esc, bloqueo de scroll).
 * Tienda: hoja inferior en móvil y centrado desde `md` (como `Jc` del prototipo).
 * Backoffice: `.modal-root` + `.overlay` + `.modal` (hoja inferior ≤ 640 px por CSS).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  zone = 'store',
  layer = 'base',
  size = 'default',
  icon,
  iconTone = 'coral',
  description,
  className,
  titleClassName,
  role = 'dialog',
}: ModalProps) {
  const t = useTranslations('ui');
  const ref = useDialog<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;

  if (zone === 'bo') {
    return (
      <Portal zone="bo">
        <div className="modal-root">
          <button
            type="button"
            className="overlay"
            aria-label={t('close')}
            tabIndex={-1}
            onClick={onClose}
          />
          <div
            ref={ref}
            tabIndex={-1}
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn('modal', size !== 'default' && size, 'outline-none', className)}
          >
            <div className="modal-h">
              {icon ? <span className={cn('modal-ic', `mi-${iconTone}`)}>{icon}</span> : null}
              <div className="grow">
                <h3 id={titleId}>{title}</h3>
                {description ? (
                  <div className="sm muted" style={{ fontWeight: 700 }}>
                    {description}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="icon-btn bordered"
                aria-label={t('close')}
                onClick={onClose}
              >
                <IconClose />
              </button>
            </div>
            <div className="modal-b">{children}</div>
            {footer ? <div className="modal-f">{footer}</div> : null}
          </div>
        </div>
      </Portal>
    );
  }

  const z = layer === 'top' ? ['z-[110]', 'z-[120]'] : ['z-[70]', 'z-[90]'];
  return (
    <Portal zone="store">
      <div
        className={cn('anim-fade fixed inset-0 bg-black/55', z[0])}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'anim-pop fixed inset-x-0 bottom-0 flex max-h-[92%] flex-col rounded-t-3xl border border-line bg-bg text-fg shadow-pop outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88%] md:w-[540px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl',
          z[1],
          className,
        )}
      >
        <div
          className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-fg/20 md:hidden"
          aria-hidden="true"
        />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 id={titleId} className={cn('disp', titleClassName ?? 'text-[24px]')}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-surface px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </Portal>
  );
}

export type BottomSheetProps = Omit<
  ModalProps,
  'zone' | 'size' | 'icon' | 'iconTone' | 'description' | 'titleClassName'
>;

/**
 * Hoja inferior de la tienda en todos los tamaños (selector de sucursal, modo de pedido…):
 * misma accesibilidad que `Modal`; en escritorio se limita a 540 px centrada abajo.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  layer = 'base',
  className,
}: BottomSheetProps) {
  const t = useTranslations('ui');
  const ref = useDialog<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const z = layer === 'top' ? ['z-[110]', 'z-[120]'] : ['z-[70]', 'z-[90]'];
  return (
    <Portal zone="store">
      <div
        className={cn('anim-fade fixed inset-0 bg-black/55', z[0])}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'anim-riseup fixed inset-x-0 bottom-0 mx-auto flex max-h-[92%] w-full flex-col rounded-t-3xl border border-line bg-bg text-fg shadow-pop outline-none md:max-w-[540px]',
          z[1],
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-fg/20" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 id={titleId} className="disp text-[24px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-surface px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </Portal>
  );
}

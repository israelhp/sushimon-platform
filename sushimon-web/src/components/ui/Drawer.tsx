'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { IconClose } from '@/components/icons/bo/icons';
import { cn } from '@/lib/cn';
import { Portal } from './Portal';
import { useDialog } from './use-dialog';
import type { Zone } from './zone';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Título visible y nombre accesible. */
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  zone?: Zone;
  /** Backoffice: línea superior (`eyebrow`) y contenido extra de cabecera (pills, metadatos). */
  eyebrow?: ReactNode;
  headerExtra?: ReactNode;
  className?: string;
}

/**
 * Panel lateral derecho accesible (foco atrapado, Esc, bloqueo de scroll).
 * Tienda: como el carrito del prototipo (`anim-slide`, 100 % en móvil, 440 px desde `sm`).
 * Backoffice: `.drawer-root` + `.overlay` + `aside.drawer` (`drawer-h`, `drawer-b`, `drawer-f`).
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  zone = 'store',
  eyebrow,
  headerExtra,
  className,
}: DrawerProps) {
  const t = useTranslations('ui');
  const ref = useDialog<HTMLElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;

  if (zone === 'bo') {
    return (
      <Portal zone="bo">
        <div className="drawer-root">
          <button
            type="button"
            className="overlay"
            aria-label={t('close')}
            tabIndex={-1}
            onClick={onClose}
          />
          <aside
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn('drawer', 'outline-none', className)}
          >
            <div className="drawer-h">
              <div className="row gap12">
                <div className="grow">
                  {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
                  <div id={titleId} className="drawer-title">
                    {title}
                  </div>
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
              {headerExtra}
            </div>
            <div className="drawer-b">{children}</div>
            {footer ? <div className="drawer-f">{footer}</div> : null}
          </aside>
        </div>
      </Portal>
    );
  }

  return (
    <Portal zone="store">
      <div
        className="anim-fade fixed inset-0 z-[70] bg-black/55"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'anim-slide fixed bottom-0 right-0 top-0 z-[80] flex w-full flex-col border-l border-line bg-bg pt-[env(safe-area-inset-top)] text-fg shadow-pop outline-none sm:w-[440px]',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 id={titleId} className="disp text-[26px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-surface px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : null}
      </aside>
    </Portal>
  );
}

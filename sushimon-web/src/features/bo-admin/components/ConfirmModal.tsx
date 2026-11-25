'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';

/**
 * Confirmación de un cambio sensible (guardar horario, cancelar o terminar un cierre…). Muestra el error del servidor
 * sin cerrarse y deshabilita las acciones mientras la mutación está pendiente.
 */
export function ConfirmModal({
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Volver',
  pendingLabel = 'Guardando…',
  danger = false,
  pending = false,
  error,
  icon,
  initialFocus,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: string;
  icon?: ReactNode;
  /** `cancel`: el foco inicial va a «Cancelar» (acciones destructivas); por defecto, el contenedor del diálogo. */
  initialFocus?: 'cancel';
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Corre después del efecto de `Modal` (que enfoca el contenedor): el padre se ejecuta al final.
    if (initialFocus === 'cancel') cancelRef.current?.focus();
  }, [initialFocus]);
  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      title={title}
      description={description}
      icon={icon}
      iconTone={danger ? 'coral' : 'blue'}
      onClose={pending ? () => undefined : onClose}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {children ? <div className="span-2 sm">{children}</div> : null}
        {error ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {error}
          </Banner>
        ) : null}
      </div>
    </Modal>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { IconClose } from '@/components/icons/bo';
import { Modal } from '@/components/ui/Modal';
import type { AdminOrderSummary } from '@/lib/data-access/models';
import { REASON_MAX, validateReason } from '../admin-orders-model';
import type { ActionResult } from '../use-admin-order-actions';

/** Sugerencias del prototipo: rellenan el campo (no envían nada); el motivo es INTERNO y nunca lo ve el cliente (P64). */
const SUGGESTIONS = ['soldOut', 'outOfZone', 'saturated', 'incompleteContact'] as const;

export type ReasonKind = 'reject' | 'cancel';

interface Props {
  kind: ReasonKind;
  order: Pick<AdminOrderSummary, 'id' | 'status' | 'displayNumber' | 'customerName'>;
  /** Ejecuta el comando; devuelve el resultado (el modal se cierra solo si hubo éxito o el pedido ya cambió). */
  onSubmit: (reason: string) => Promise<ActionResult>;
  /** `done` = el comando se aplicó (o ya estaba aplicado); `closed` = la persona cerró sin enviar. */
  onClose: (result: 'done' | 'closed') => void;
  /** Estado del envío en vuelo (deshabilita el botón y marca `aria-busy`). */
  pending: boolean;
}

/**
 * Modal de rechazo/cancelación (spec 023 §10.5): número de pedido, consecuencias, motivo OBLIGATORIO (3–280 tras recortar), aviso de
 * datos personales y confirmación explícita. El texto se envía recortado. Un 400 `ORDER_REASON_REQUIRED` del servidor vuelve como
 * error del campo; un 409/422/404 cierra el modal (el pedido cambió: la vista ya se está refrescando).
 */
export function ReasonModal({ kind, order, onSubmit, onClose, pending }: Props) {
  const t = useTranslations(`backoffice.orders.live.reason.${kind}`);
  const tc = useTranslations('backoffice.orders.live.reason');
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Foco inicial en el campo (useDialog enfoca el contenedor al montar: se corrige en el siguiente ciclo).
  useEffect(() => {
    const id = setTimeout(() => fieldRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);
  const helpId = useId();
  const errorId = useId();

  const problem = validateReason(value);
  const showError = (touched && problem !== null) || serverError;
  const length = value.trim().length;

  const submit = async () => {
    setTouched(true);
    if (problem !== null || pending) return;
    const result = await onSubmit(value.trim());
    if (result.ok) onClose('done');
    else if (result.error.kind === 'reason') setServerError(true);
    else if (result.text && !['conflict', 'invalid', 'notFound'].includes(result.error.kind)) {
      setActionError(result.text);
    } else if (['conflict', 'invalid', 'notFound'].includes(result.error.kind)) onClose('closed');
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      iconTone="coral"
      icon={<IconClose />}
      title={t('title')}
      description={`#${order.displayNumber} · ${order.customerName}`}
      onClose={() => onClose('closed')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose('closed')}>
            {tc('back')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            {t('confirm')}
          </button>
        </>
      }
    >
      <p className="sm" style={{ fontWeight: 600 }}>
        {t('consequences')}
      </p>
      <div className="reasons" role="group" aria-label={tc('suggestions')}>
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            className="reason"
            onClick={() => {
              // Se ANEXA al texto ya escrito (no lo pisa).
              setValue((v) =>
                v.trim() ? `${v.trim()} · ${tc(`suggestion.${key}`)}` : tc(`suggestion.${key}`),
              );
              setServerError(false);
            }}
          >
            {tc(`suggestion.${key}`)}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor={fieldId} className="flabel">
          {tc('label')}
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          className="inp"
          rows={3}
          value={value}
          required
          aria-required="true"
          aria-invalid={showError}
          aria-describedby={`${helpId}${showError ? ` ${errorId}` : ''}`}
          onChange={(e) => {
            setValue(e.target.value);
            setServerError(false);
          }}
          onBlur={() => setTouched(true)}
        />
        <div id={helpId} className="xs muted" style={{ fontWeight: 600 }}>
          {tc('pii')}{' '}
          <span className="num">{tc('counter', { count: length, max: REASON_MAX })}</span>
        </div>
        {actionError ? (
          <div className="xs" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
            {actionError}
          </div>
        ) : null}
        {showError ? (
          <div
            id={errorId}
            role="alert"
            className="xs"
            style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
          >
            {tc(`error.${serverError && problem === null ? 'required' : (problem ?? 'required')}`)}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

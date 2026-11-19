'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { IconCheck } from '@/components/icons/bo';
import { Modal } from '@/components/ui/Modal';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import type { AdminOrderPayment } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { formatMoney } from '@/lib/format';
import {
  MAX_TENDERED_CENTS,
  canSubmitCash,
  centsToMoney,
  classifyPaymentError,
  discardsKey,
  evaluateTendered,
  moneyToCents,
  newAttemptKey,
  type PaymentError,
} from '../cash-payment-model';
import { useRegisterCashPayment } from '../payment-hooks';

const money = (value: string) => formatMoney(Number(value));
const moneyCents = (cents: number) => formatMoney(Number(centsToMoney(cents)));

interface Props {
  payment: Pick<AdminOrderPayment, 'orderId' | 'amountDue' | 'outstanding'>;
  /** Código del pedido para los avisos (`MON-001042`). */
  code: string;
  onClose: () => void;
}

/**
 * F24 (spec 025 §12.2) — Modal «Registrar pago en efectivo». Solo cadenas decimales y centavos enteros; el cambio que se ve mientras
 * se escribe es INFORMATIVO y local (sin peticiones por tecla). El `Idempotency-Key` es ESTABLE por intento: se reutiliza al
 * reintentar el mismo envío (incluido tras un fallo de red o 503) y se renueva tras un rechazo definitivo, un cambio de importe o el
 * cierre. El botón queda deshabilitado mientras la solicitud vuela. El éxito se declara SOLO con la respuesta persistida.
 */
export function CashPaymentModal({ payment, code, onClose }: Props) {
  const t = useTranslations('backoffice.orders.live.payment');
  const tm = useTranslations('backoffice.orders.live.payment.modal');
  const { notify } = useToast();
  const client = useDataClient();
  const mutation = useRegisterCashPayment();
  const [tendered, setTendered] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<PaymentError | null>(null);
  const [conflict, setConflict] = useState<AdminOrderPayment | null>(null);
  const fieldId = useId();
  const helpId = useId();
  const errId = useId();
  const changeId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  // Clave del intento actual (solo memoria del modal; jamás storage). `amount` = importe con el que ya se envió.
  const attempt = useRef<{ key: string; amount: string | null }>({
    key: newAttemptKey(),
    amount: null,
  });

  useEffect(() => {
    const id = setTimeout(() => fieldRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  // Al pasar a «conflicto» se desmontan campo, casilla y botón: el foco va al aviso (nunca cae al body).
  useEffect(() => {
    if (conflict) bannerRef.current?.focus();
  }, [conflict]);

  const dueCents = moneyToCents(payment.outstanding) ?? moneyToCents(payment.amountDue) ?? 0;
  const state = evaluateTendered(tendered, dueCents);
  // El motivo se ve en cuanto hay algo escrito (sin esperar a salir del campo).
  const showFieldError = tendered !== '' && state.kind !== 'ok' && state.kind !== 'empty';
  const pending = mutation.isPending;
  const canSubmit = canSubmitCash(state, confirmed) && !pending && !conflict;

  const fieldMessage = (() => {
    if (state.kind === 'invalid') return tm(`error.${state.problem}`);
    if (state.kind === 'insufficient')
      return tm('error.insufficient', { missing: moneyCents(state.missingCents) });
    if (state.kind === 'tooLarge')
      return tm('error.tooLarge', { max: moneyCents(MAX_TENDERED_CENTS) });
    return null;
  })();

  const explain = (e: PaymentError): string => {
    switch (e.kind) {
      case 'alreadyRegistered':
        return tm('error.alreadyRegistered');
      case 'notPayable':
        return tm('error.notPayable');
      case 'keyReused':
        return tm('error.keyReused');
      case 'insufficient':
        return tm('error.insufficientServer');
      case 'tooLarge':
        return tm('error.tooLarge', { max: moneyCents(MAX_TENDERED_CENTS) });
      case 'notCollectable':
        return e.violation === 'PROVIDER_BLOCKED_EXTERNAL' ||
          e.violation === 'LEGACY_PAYMENT_METHOD' ||
          e.violation === 'AMOUNT_ZERO'
          ? tm(`error.notCollectable.${e.violation}`)
          : tm('error.notCollectable.default');
      case 'invalidAmount':
        return tm('error.invalidAmount');
      case 'confirmationRequired':
        return tm('error.confirmationRequired');
      case 'invalidRequest':
        return tm('error.invalidRequest');
      case 'auth':
        return tm('error.auth');
      case 'mfa':
        return tm('error.mfa');
      case 'forbidden':
        return tm('error.forbidden');
      case 'notFound':
        return tm('error.notFound');
      case 'rate':
        return tm('error.rate', { seconds: clamp(e.retryAfterSec) });
      case 'busy':
        return tm('error.busy', { seconds: clamp(e.retryAfterSec) });
      case 'network':
        return tm('error.network');
      default:
        return tm('error.unknown');
    }
  };

  const submit = async () => {
    if (!canSubmitCash(state, confirmed) || inFlight.current || state.kind !== 'ok') return;
    inFlight.current = true;
    setError(null);
    // Otro importe distinto del ya enviado = otro intento = otra clave (si el anterior se persistió, el servidor responde 409).
    if (attempt.current.amount !== null && attempt.current.amount !== state.normalized) {
      attempt.current = { key: newAttemptKey(), amount: null };
    }
    attempt.current.amount = state.normalized;
    try {
      const result = await mutation.mutateAsync({
        id: payment.orderId,
        tendered: state.normalized,
        idempotencyKey: attempt.current.key,
      });
      const change = result.payment.reception?.change ?? '0.00';
      notify(
        result.replayed
          ? result.appliedByMe
            ? t('toast.replayedMine', { code })
            : t('toast.replayedOther', { code })
          : t('toast.done', { code, change: money(change) }),
      );
      attempt.current = { key: newAttemptKey(), amount: null };
      onClose();
    } catch (e) {
      const classified = classifyPaymentError(e);
      if (discardsKey(classified)) attempt.current = { key: newAttemptKey(), amount: null };
      if (
        (classified.kind === 'alreadyRegistered' || classified.kind === 'notPayable') &&
        classified.current
      ) {
        setConflict(classified.current);
      }
      setError(classified);
      // Tras un fallo reintentable el foco vuelve a «Registrar pago» (el botón se deshabilitó mientras volaba).
      if (classified.retrySameKey) setTimeout(() => submitRef.current?.focus(), 0);
    } finally {
      inFlight.current = false;
    }
  };

  const reception = conflict?.reception ?? null;
  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      iconTone="green"
      icon={<IconCheck />}
      title={tm('title')}
      description={`#${code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {conflict ? tm('close') : tm('cancel')}
          </button>
          {conflict ? null : (
            <button
              ref={submitRef}
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit}
              aria-busy={pending}
              onClick={() => void submit()}
            >
              {pending ? tm('submitting') : tm('submit')}
            </button>
          )}
        </>
      }
    >
      {client.kind === 'mock' ? (
        <p className="sm" style={{ fontWeight: 600 }}>
          <SimulationBadge kind="simulation" zone="bo" /> {tm('simulation')}
        </p>
      ) : null}
      <dl className="tline total" style={{ margin: 0 }}>
        <dt>{tm('due')}</dt>
        <dd className="num" style={{ margin: 0 }} data-testid="cash-due">
          {money(payment.outstanding)}
        </dd>
      </dl>

      {conflict ? (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          className="banner b-amber outline-none"
          style={{ marginTop: 12 }}
        >
          <div>
            <strong>{error ? explain(error) : null}</strong>
            {reception ? (
              <div className="sm" style={{ fontWeight: 600 }}>
                {tm('currentReception', {
                  tendered: money(reception.tendered),
                  change: money(reception.change),
                  name: reception.collectorName ?? '—',
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor={fieldId} className="flabel">
              {tm('tendered')}
            </label>
            <input
              id={fieldId}
              ref={fieldRef}
              className="inp"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              value={tendered}
              required
              aria-required="true"
              aria-invalid={showFieldError}
              aria-describedby={`${helpId} ${errId} ${changeId}`}
              onChange={(e) => {
                setTendered(e.target.value);
                setError(null);
              }}
            />
            <div id={helpId} className="xs muted" style={{ fontWeight: 600 }}>
              {tm('help')}
            </div>
            <div id={errId} aria-live="polite" aria-atomic="true">
              {showFieldError && fieldMessage ? (
                <div className="xs" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
                  {fieldMessage}
                </div>
              ) : null}
            </div>
          </div>

          <div id={changeId} className="info-row" style={{ marginTop: 8 }}>
            <div className="grow">
              <div className="muted xs" style={{ fontWeight: 700 }}>
                {tm('change')}
              </div>
              <div className="strong num" data-testid="cash-change">
                {state.kind === 'ok'
                  ? moneyCents(state.changeCents)
                  : state.kind === 'insufficient'
                    ? tm('error.insufficient', { missing: moneyCents(state.missingCents) })
                    : '—'}
              </div>
              <div className="xs muted" style={{ fontWeight: 600 }}>
                {tm('changeNote')}
              </div>
            </div>
          </div>

          <label
            className="row gap8"
            style={{ marginTop: 12, minHeight: 44, paddingBlock: 10, alignItems: 'center' }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              aria-required="true"
            />
            <span className="sm" style={{ fontWeight: 700 }}>
              {tm('confirm')}
            </span>
          </label>
        </>
      )}

      {/* Región viva SIEMPRE montada: los errores del servidor se anuncian al aparecer. */}
      <div aria-live="assertive" aria-atomic="true" style={{ marginTop: 8 }}>
        {error && !conflict ? (
          <div
            className="xs"
            data-testid="cash-error"
            style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
          >
            {explain(error)}
            {error.retrySameKey ? ` ${tm('retryHint')}` : ''}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

const clamp = (s: number | null) => Math.min(120, Math.max(1, Math.round(s ?? 5)));

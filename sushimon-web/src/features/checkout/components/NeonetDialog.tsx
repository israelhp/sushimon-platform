'use client';

import {
  CircleCheck,
  CircleX,
  CreditCard,
  FlaskConical,
  Loader2,
  Lock,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Portal } from '@/components/ui/Portal';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useDialog } from '@/components/ui/use-dialog';
import { cn } from '@/lib/cn';
import type { Order, PaymentResult } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { useOrder, usePayWithCard } from '@/features/orders/hooks';
import {
  DEMO_CARD,
  EMPTY_CARD,
  TEST_CARDS,
  findTestCard,
  formatCardNumber,
  formatExpiry,
  lastFour,
  maskCardNumber,
  onlyDigits,
  validateCard,
  type CardErrors,
  type CardForm,
} from '../neonet';

export type NeonetPhase =
  'ready' | 'processing' | 'checking' | 'approved' | 'declined' | 'pending' | 'error';

/** Lo único que sale del diálogo hacia el checkout: nunca el número, el CVV ni el nombre del titular. */
export interface NeonetOutcome {
  status: PaymentResult['status'];
  reference: string | null;
  processedAt: string;
  last4: string | null;
}

/**
 * Pasarela NeoNet SIMULADA (insignia "Simulación"). SEGURIDAD: el número, vencimiento, CVV y titular
 * viven SOLO en el estado local de este componente; se envían una vez al servicio, se borran del
 * estado al enviar y desaparecen al cerrar. No se guardan en storage, caché, logs ni en la URL.
 * Los campos usan `autoComplete="off"` y el CVV es de tipo contraseña. La integración real
 * (tokenización en el navegador) está pendiente de documentación y credenciales de NeoNet.
 */
export function NeonetDialog({
  order,
  now,
  onClose,
  onApproved,
  onPendingContinue,
  onChangeMethod,
  onOutcome,
}: {
  order: Order;
  /** Hora del servidor/demo (vencimiento de la tarjeta). */
  now: Date;
  /** Cerrar y volver al checkout (no disponible mientras se procesa). */
  onClose: () => void;
  /** "Consultar pedido" tras aprobarse el pago. */
  onApproved: (outcome: NeonetOutcome) => void;
  /** Pago en verificación: seguir a la confirmación del pedido. */
  onPendingContinue: (outcome: NeonetOutcome) => void;
  /** Rechazado/error: elegir otro método (efectivo) sin perder el carrito. */
  onChangeMethod: () => void;
  /** Cada resultado (aprobado, rechazado, en verificación). */
  onOutcome?: (outcome: NeonetOutcome) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (v: number) => formatMoney(v, locale);
  const payment = usePayWithCard();
  const orderQuery = useOrder(order.id);

  const [card, setCard] = useState<CardForm>(DEMO_CARD);
  const [errors, setErrors] = useState<CardErrors>({});
  const [phase, setPhase] = useState<NeonetPhase>('ready');
  const [outcome, setOutcome] = useState<NeonetOutcome | null>(null);
  const [testOpen, setTestOpen] = useState(true);
  const busy = phase === 'processing' || phase === 'checking';

  const requestClose = () => {
    if (busy) return;
    if (phase === 'pending' && outcome) onPendingContinue(outcome);
    else onClose();
  };
  const ref = useDialog<HTMLDivElement>(true, requestClose);

  const brand = findTestCard(card.number)?.brand ?? 'Demo';
  const approvedOutcome = phase === 'approved' ? outcome : null;

  const finish = (next: NeonetOutcome) => {
    setOutcome(next);
    setPhase(
      next.status === 'approved' ? 'approved' : next.status === 'declined' ? 'declined' : 'pending',
    );
    onOutcome?.(next);
  };

  const submit = async () => {
    if (busy) return;
    const found = validateCard(card, now);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => {
        const first = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus({ preventScroll: true });
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    const last4 = lastFour(card.number);
    const body = {
      orderId: order.id,
      cardNumber: onlyDigits(card.number),
      holderName: card.name.trim(),
      expiry: card.expiry,
      cvv: card.cvv,
    };
    // El estado del formulario se descarta ANTES de esperar la respuesta: no queda PAN/CVV en pantalla.
    setCard(EMPTY_CARD);
    setPhase('processing');
    try {
      const result = await payment.pay(body);
      finish({
        status: result.status,
        reference: result.reference,
        processedAt: result.processedAt,
        last4,
      });
    } catch {
      // No se detalla el error del servidor (podría aludir a los datos de la tarjeta, ya descartados).
      setPhase('error');
    }
  };

  /** Vuelve al formulario con la tarjeta de prueba precargada (los datos escritos ya se descartaron). */
  const retry = () => {
    setCard(DEMO_CARD);
    setErrors({});
    setPhase('ready');
  };

  const checkStatus = async () => {
    if (busy || !outcome) return;
    setPhase('checking');
    const fresh = await orderQuery.refetch();
    const payments = fresh.data?.payment;
    if (payments && payments.status !== 'review' && payments.status !== 'pending') {
      finish({
        status: payments.status,
        reference: payments.reference,
        processedAt: payments.processedAt ?? outcome.processedAt,
        last4: outcome.last4,
      });
    } else {
      setPhase('pending');
    }
  };

  const items = order.lines.map((l) => ({
    key: `${l.productId}|${l.note}`,
    label: `${l.quantity}× ${l.name}`,
    amount: l.subtotal,
  }));
  const setField = (patch: Partial<CardForm>, key: keyof CardErrors) => {
    setCard((c) => ({ ...c, ...patch }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const err = (key?: Parameters<typeof t>[0]) => (key ? t(key) : undefined);

  return (
    <Portal zone="store">
      <div
        className="anim-fade fixed inset-0 z-[110] bg-black/60"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="neonet-title"
        className="anim-pop fixed inset-x-0 bottom-0 z-[120] flex max-h-[94%] flex-col overflow-hidden rounded-t-3xl border border-line bg-bg text-fg shadow-pop outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[90%] md:w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="h-6 w-px bg-line" aria-hidden="true" />
            <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-muted">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" /> NeoNet
            </span>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label={t('common.close')}
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border border-line hover:bg-subtle disabled:opacity-40"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="neonet-title" className="disp text-[22px]">
              {t('neonet.title')}
            </h2>
            <SimulationBadge kind="simulation">{t('neonet.demoBadge')}</SimulationBadge>
          </div>
          <p className="mb-4 text-[12px] leading-snug text-muted">{t('neonet.gatewayNote')}</p>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between text-[13px] text-muted">
              <span>{t('neonet.order')}</span>
              <span className="font-mono font-bold text-fg">{order.id}</span>
            </div>
            <ul className="m-0 mt-2 list-none p-0 text-[14px]">
              {items.map((item) => (
                <li key={item.key} className="flex justify-between gap-3 py-0.5">
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="flex-none">{money(item.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-dashed border-line pt-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-muted">{t('common.subtotal')}</span>
                <span>{money(order.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('checkout.estimatedShipping')}</span>
                <span>
                  {order.deliveryFee > 0 ? money(order.deliveryFee) : t('checkout.pickupFree')}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-extrabold">{t('neonet.toPay')}</span>
                <span className="font-display text-[26px]">{money(order.total)}</span>
              </div>
            </div>
          </div>

          {phase === 'ready' ? (
            <div className="mt-4">
              <p className="lbl !mb-2">{t('neonet.cardData')}</p>
              <div
                className="relative mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 to-zinc-950 p-4 text-white shadow-card"
                aria-hidden="true"
              >
                <div className="flex items-center justify-between">
                  <CreditCard className="h-6 w-6 opacity-90" />
                  <span className="text-[12px] font-extrabold uppercase tracking-widest opacity-80">
                    {brand}
                  </span>
                </div>
                <p className="m-0 mt-5 font-mono text-[18px] tracking-[0.12em]">
                  {maskCardNumber(card.number)}
                </p>
                <div className="mt-2 flex justify-between gap-3 text-[12px] uppercase opacity-85">
                  <span className="truncate">{card.name || t('neonet.cardName')}</span>
                  <span className="flex-none">{card.expiry || t('neonet.expiryPh')}</span>
                </div>
              </div>
              <p className="m-0 mb-3 flex items-start gap-1.5 text-[12px] font-bold leading-snug text-muted">
                <FlaskConical className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{' '}
                {t('neonet.testOnlyNote')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="lbl !text-[13px]" htmlFor="nn-number">
                    {t('neonet.cardNumber')}
                  </label>
                  <input
                    id="nn-number"
                    className="input font-mono tracking-wider"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    data-lpignore="true"
                    placeholder="4242 4242 4242 4242"
                    aria-invalid={!!errors.number}
                    aria-describedby={errors.number ? 'nn-number-error' : undefined}
                    value={card.number}
                    onChange={(e) =>
                      setField({ number: formatCardNumber(e.target.value) }, 'number')
                    }
                  />
                  {errors.number ? (
                    <p id="nn-number-error" className="err">
                      {err(errors.number)}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-2">
                  <label className="lbl !text-[13px]" htmlFor="nn-name">
                    {t('neonet.cardName')}
                  </label>
                  <input
                    id="nn-name"
                    className="input uppercase"
                    type="text"
                    autoComplete="off"
                    placeholder={t('neonet.cardNamePh')}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? 'nn-name-error' : undefined}
                    value={card.name}
                    onChange={(e) => setField({ name: e.target.value.slice(0, 40) }, 'name')}
                  />
                  {errors.name ? (
                    <p id="nn-name-error" className="err">
                      {err(errors.name)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="lbl !text-[13px]" htmlFor="nn-exp">
                    {t('neonet.expiry')}
                  </label>
                  <input
                    id="nn-exp"
                    className="input font-mono"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t('neonet.expiryPh')}
                    aria-invalid={!!errors.expiry}
                    aria-describedby={errors.expiry ? 'nn-exp-error' : undefined}
                    value={card.expiry}
                    onChange={(e) => setField({ expiry: formatExpiry(e.target.value) }, 'expiry')}
                  />
                  {errors.expiry ? (
                    <p id="nn-exp-error" className="err">
                      {err(errors.expiry)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="lbl !text-[13px]" htmlFor="nn-cvv">
                    {t('neonet.cvv')}
                  </label>
                  <input
                    id="nn-cvv"
                    className="input font-mono"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="•••"
                    aria-invalid={!!errors.cvv}
                    aria-describedby={errors.cvv ? 'nn-cvv-error' : undefined}
                    value={card.cvv}
                    onChange={(e) =>
                      setField({ cvv: onlyDigits(e.target.value).slice(0, 4) }, 'cvv')
                    }
                  />
                  {errors.cvv ? (
                    <p id="nn-cvv-error" className="err">
                      {err(errors.cvv)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div aria-live="polite" className="mt-4">
            {busy ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                <Loader2 className="anim-spin h-6 w-6 text-secondary" aria-hidden="true" />
                <div>
                  <p className="m-0 font-extrabold">
                    {phase === 'checking' ? t('neonet.checking') : t('neonet.processing')}
                  </p>
                  <p className="m-0 text-[13px] text-muted">{t('neonet.processingSub')}</p>
                </div>
              </div>
            ) : null}

            {approvedOutcome ? (
              <div className="rounded-2xl border border-success/40 bg-success-soft p-4">
                <p className="m-0 flex items-center gap-2 text-[17px] font-extrabold text-success">
                  <CircleCheck className="h-6 w-6" aria-hidden="true" /> {t('neonet.approvedTitle')}
                </p>
                <dl className="m-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[14px]">
                  <dt className="text-muted">{t('neonet.paid')}</dt>
                  <dd className="m-0 text-right font-bold">{money(order.total)}</dd>
                  <dt className="text-muted">{t('neonet.method')}</dt>
                  <dd className="m-0 whitespace-nowrap text-right font-mono font-bold">
                    {t('neonet.payWith', { a: approvedOutcome.last4 ?? '••••' })}
                  </dd>
                  <dt className="text-muted">{t('neonet.reference')}</dt>
                  <dd className="m-0 whitespace-nowrap text-right font-mono font-bold">
                    {approvedOutcome.reference}
                  </dd>
                  <dt className="text-muted">{t('neonet.order')}</dt>
                  <dd className="m-0 whitespace-nowrap text-right font-mono font-bold">
                    {order.id}
                  </dd>
                </dl>
                <button
                  type="button"
                  className="btn btn-primary mt-4 w-full"
                  onClick={() => onApproved(approvedOutcome)}
                >
                  {t('neonet.viewOrder')}
                </button>
              </div>
            ) : null}

            {phase === 'declined' ? (
              <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4" role="alert">
                <p className="m-0 flex items-center gap-2 text-[17px] font-extrabold text-danger">
                  <CircleX className="h-6 w-6" aria-hidden="true" /> {t('neonet.declinedTitle')}
                </p>
                <p className="m-0 mt-1.5 text-[14px] leading-snug">{t('neonet.declinedMsg')}</p>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  <button type="button" className="btn btn-primary !min-h-[48px]" onClick={retry}>
                    {t('neonet.retry')}
                  </button>
                  <button type="button" className="btn !min-h-[48px]" onClick={onChangeMethod}>
                    {t('neonet.changeMethod')}
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'error' ? (
              <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4" role="alert">
                <p className="m-0 flex items-center gap-2 text-[17px] font-extrabold text-danger">
                  <ShieldAlert className="h-6 w-6" aria-hidden="true" /> {t('neonet.errorTitle')}
                </p>
                <p className="m-0 mt-1.5 text-[14px] leading-snug">{t('neonet.errorMsg')}</p>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  <button type="button" className="btn btn-primary !min-h-[48px]" onClick={retry}>
                    {t('neonet.retry')}
                  </button>
                  <button type="button" className="btn !min-h-[48px]" onClick={onChangeMethod}>
                    {t('neonet.changeMethod')}
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'pending' && outcome ? (
              <div className="rounded-2xl border border-accent/60 bg-accent-soft p-4">
                <p className="m-0 flex items-center gap-2 text-[17px] font-extrabold">
                  <Loader2 className="anim-spin h-5 w-5 text-secondary" aria-hidden="true" />{' '}
                  {t('neonet.pendingTitle')}
                </p>
                <p className="m-0 mt-1.5 text-[14px] leading-snug">{t('neonet.pendingMsg')}</p>
                <div className="mt-4 grid gap-2.5">
                  <button
                    type="button"
                    className="btn w-full !min-h-[48px]"
                    onClick={() => void checkStatus()}
                  >
                    {t('neonet.checkStatus')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary w-full !min-h-[48px]"
                    onClick={() => onPendingContinue(outcome)}
                  >
                    {t('neonet.viewOrder')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {phase === 'ready' ? (
            <details
              className="mt-4 rounded-2xl border border-dashed border-line bg-subtle/60 px-4 py-3"
              open={testOpen}
              onToggle={(e) => setTestOpen(e.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-extrabold text-muted">
                <FlaskConical className="h-4 w-4" aria-hidden="true" /> {t('neonet.testMode')}
              </summary>
              <div className="mt-3">
                <p className="m-0 mb-2 text-[13px] font-bold">{t('neonet.testCards')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEST_CARDS.map((c) => {
                    const on = onlyDigits(card.number) === c.number;
                    return (
                      <button
                        key={c.number}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setCard((x) => ({
                            ...x,
                            number: formatCardNumber(c.number),
                            cvv: x.cvv || '123',
                          }));
                          setErrors({});
                        }}
                        className={cn(
                          'flex min-h-[44px] flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-left transition',
                          on
                            ? 'border-secondary bg-secondary-soft'
                            : 'border-line bg-surface hover:bg-subtle',
                        )}
                      >
                        <span className="font-mono text-[12px] font-bold">
                          {formatCardNumber(c.number)}
                        </span>
                        <span className="text-[11px] text-muted">
                          {c.brand} · {t(`neonet.testCardFor.${c.scenario}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : null}
        </div>

        {phase === 'ready' ? (
          <div className="border-t border-line bg-surface px-5 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3">
            <button
              type="button"
              className="btn btn-primary w-full !justify-between !px-6"
              onClick={() => void submit()}
            >
              <span>{t('neonet.simulate')}</span>
              <span className="font-display">{money(order.total)}</span>
            </button>
            <button
              type="button"
              className="mt-2 w-full py-2 text-sm font-bold text-muted hover:text-fg"
              onClick={onClose}
            >
              {t('neonet.cancel')}
            </button>
          </div>
        ) : null}
      </div>
    </Portal>
  );
}

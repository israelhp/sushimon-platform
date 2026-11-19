'use client';

import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { DraftOrder, OrderCreated } from '@/lib/data-access/models';
import { moneyToCents } from '@/lib/checkout-quote';
import { formatMoney } from '@/lib/format';
import { useCreateAddress, useUpdateMe } from '@/features/account/hooks';
import { useLocationOptions } from '@/features/delivery-coverage/hooks';
import { useCart } from '@/features/cart/cart-context';
import { useDraftOrderLoader } from '@/features/orders/hooks';
import { saveLastOrder } from '@/features/orders/last-order';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useCartDrawer } from '@/features/store-shell/store-shell-context';
import { CHECKOUT_STEP_COUNT, type CheckoutStep } from '../checkout-model';
import type { OrderIntent } from '../order-attempt';
import { usePlaceOrder } from '../use-place-order';
import { useCheckoutDraft } from '../checkout-context';
import { clearRemembered, writeRemembered } from '../remember';
import { useCheckoutData } from '../use-checkout-data';
import { addressSignature, decideSaveAddress } from '../save-address';
import { Confirmation } from './Confirmation';
import { PlacementStatus, placementLiveKey } from './PlacementStatus';
import { DeliveryStep, type CheckoutExtras } from './DeliveryStep';
import { OrderStep, OrderStepSkeleton } from './OrderStep';
import { OrderSummary, type SummaryAction } from './OrderSummary';
import { PaymentStep } from './PaymentStep';
import { QuoteAlerts } from './QuoteAlerts';
import { useCheckoutSteps } from './parts';
import { quoteLineName, rowNamesByConfig } from './quote-helpers';
import { ReviewStep } from './ReviewStep';
import { ShippingStep } from './ShippingStep';

const scrollTop = () => {
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    /* entornos sin scroll (pruebas) */
  }
};

/** Enfoca el primer control inválido del paso actual (o sube al inicio si no hay). */
function focusFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(
      '#paso-actual [aria-invalid="true"]:not([data-skip-focus]), #paso-actual [data-focus-error]',
    );
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } else {
      scrollTop();
    }
  });
}

/**
 * Checkout de 5 pasos (Tu pedido → Entrega → Envío → Pago → Confirmación). F24: el único método es EFECTIVO.
 * El estado vive en `CheckoutProvider` (reductor): cambiar idioma o tema no pierde el progreso. El cliente
 * solo envía la intención (productos, cantidades, entrega, contacto, método): el servidor calcula precios,
 * envío y totales; los montos de pantalla son informativos.
 */
export function CheckoutFlow() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { notify } = useToast();
  const steps = useCheckoutSteps();
  const { draft, dispatch, ready, discard } = useCheckoutDraft();
  const data = useCheckoutData();
  const cart = useCart();
  const cartDrawer = useCartDrawer();
  const drafts = useDraftOrderLoader();
  const createAddress = useCreateAddress();
  const addressLocations = useLocationOptions(draft.address.department);
  const updateMe = useUpdateMe();

  const [confirmed, setConfirmed] = useState<DraftOrder | null>(null);
  /** Pedido REAL confirmado por el servidor (solo con la API real): se presenta como «pedido recibido». */
  const [placedId, setPlacedId] = useState<string | null>(null);
  /** F21 (mock): UUID del pedido simulado para enlazar el seguimiento con la forma real `OrderTracking`. */
  const [mockTrackingId, setMockTrackingId] = useState<string | null>(null);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  /** Mock: cargando el pedido borrador enlazado tras crearlo (confirmación simulada). */
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [extras, setExtras] = useState<CheckoutExtras>({
    saveAddress: true,
    addressLabel: 'home',
    updateProfile: true,
    remember: false,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const prefilledFor = useRef('');
  /** Firma de la dirección ya guardada desde este checkout (evita duplicados al ir y volver). */
  const savedSignature = useRef<string | null>(null);

  const step = draft.step;
  const isLast = step === CHECKOUT_STEP_COUNT;
  const stepName = steps[step - 1] ?? '';
  const money = (v: number) => formatMoney(v, locale);

  // Con sesión de cliente (real o de demostración): contacto y dirección predeterminada de la cuenta (una vez por cuenta).
  const { signedIn, scope } = data;
  useEffect(() => {
    if (!scope) {
      prefilledFor.current = '';
      return;
    }
    if (!data.me || prefilledFor.current === scope) return;
    prefilledFor.current = scope;
    dispatch({
      type: 'contact',
      patch: {
        name: data.me.fullName,
        phone: data.me.phone,
        email: data.me.email,
      },
    });
    const preferred =
      data.addresses.find((a) => a.id === data.defaultAddressId) ?? data.addresses[0];
    if (preferred) {
      dispatch({
        type: 'fill-address',
        addressId: preferred.id,
        address: {
          department: preferred.department,
          municipality: preferred.municipality,
          zone: preferred.zone,
          line: preferred.line,
          references: preferred.references,
        },
      });
    }
  }, [scope, data.me, data.addresses, data.defaultAddressId, dispatch]);

  // Al cambiar de paso, el foco pasa al título (lectores de pantalla y teclado).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const goTo = (target: number) => {
    if (target === step || target < 1 || target > CHECKOUT_STEP_COUNT) return;
    const to = target as CheckoutStep;
    if (to > step) {
      for (let s = step; s < to; s++) {
        if (!data.stepOk(s as CheckoutStep)) {
          dispatch({ type: 'goto', step: s as CheckoutStep, showErrors: true });
          if (s === 2) notify(t('checkout.fixErrors'));
          focusFirstError();
          return;
        }
      }
    }
    if (step === 2 && to > 2) saveAddressIfWanted();
    setSubmitError('');
    dispatch({ type: 'goto', step: to });
    scrollTop();
  };

  /**
   * F05: guarda la dirección en «Mis direcciones» al continuar desde el paso Entrega (F20 aún no existe, así que no se
   * espera a confirmar el pedido). Nunca bloquea el checkout: avisa del resultado y, si falla, permite reintentar al
   * volver a continuar. La firma evita duplicados al ir y volver entre pasos.
   */
  const saveAddressIfWanted = () => {
    const decision = decideSaveAddress({
      delivery: data.type === 'delivery',
      signedIn,
      wantsSave: extras.saveAddress,
      isOther: draft.addressId === 'other',
      label: extras.addressLabel,
      draft: draft.address,
      addresses: data.addresses,
      municipalities: addressLocations.municipalities,
      alreadySavedSignature: savedSignature.current,
    });
    if (decision.action === 'full') notify(t('checkoutFlow.addressSaveFull'));
    else if (decision.action === 'no-municipality')
      notify(t('checkoutFlow.addressSaveNoMunicipality'));
    else if (decision.action === 'save') {
      const signature = addressSignature(draft.address);
      savedSignature.current = signature;
      createAddress.mutateAsync(decision.input).then(
        () => notify(t('checkoutFlow.addressSaved')),
        () => {
          savedSignature.current = null;
          notify(t('checkoutFlow.addressSaveFailed'));
        },
      );
    }
  };

  const simulation = data.isSimulation;

  /** Lo que el cliente confirma (sin importes ni token): las entradas ACTUALES de la cotización + contacto, dirección y preferencia. */
  const buildIntent = (): OrderIntent | null => {
    const q = data.quoteInputs;
    if (!q) return null;
    const f = q.fulfillment;
    return {
      scope: data.scope,
      quote: { cart: q.cart, fulfillment: f, couponCode: q.couponCode },
      contact: {
        fullName: draft.contact.name,
        phone: draft.contact.phone,
        email: draft.contact.email,
      },
      // Dirección NUEVA (municipio + zona): el texto va aparte; con dirección guardada se copia en el servidor.
      deliveryAddress:
        f.type === 'DELIVERY' && !f.customerAddressId
          ? { addressLine: draft.address.line, referenceNote: draft.address.references }
          : null,
      notes: draft.notes,
      // F24: único método = efectivo (el pago nace `PENDING`; nada se cobra aquí). Solo es la preferencia declarada.
      preference: 'cash',
    };
  };

  /** Preferencias del cliente al confirmar (recordar datos en el dispositivo, actualizar el perfil). */
  const applyPreferences = () => {
    if (!signedIn) {
      if (extras.remember) {
        writeRemembered({ contact: draft.contact, address: draft.address });
      } else {
        clearRemembered();
      }
    } else {
      const me = data.me;
      if (
        extras.updateProfile &&
        me &&
        (draft.contact.name.trim() !== me.fullName || draft.contact.phone.trim() !== me.phone)
      ) {
        // F04: el perfil guarda nombre y teléfono. El correo pertenece a la identidad y no se envía.
        updateMe.mutate({
          fullName: draft.contact.name.trim(),
          phone: draft.contact.phone.trim(),
        });
      }
    }
  };

  /** SIMULADO (mock): pedido borrador confirmado; el carrito lo vacía `clear()` (el pedido REAL usa `clearAfterOrder`). */
  const finalize = (order: DraftOrder) => {
    saveLastOrder(order);
    applyPreferences();
    cart.clear();
    discard();
    setConfirmed(order);
    scrollTop();
  };

  /**
   * El servidor (o el mock) confirmó el pedido. API real: el carrito ya lo vació `usePlaceOrder` (`clearAfterOrder`); aquí se
   * aplican las preferencias, se descarta el borrador y se va a «pedido recibido». Mock: se carga el pedido borrador enlazado para
   * la confirmación simulada.
   */
  const handleCreated = (created: OrderCreated) => {
    if (!simulation) {
      applyPreferences();
      discard();
      // La pantalla «pedido recibido» tiene UN solo dueño: la ruta `/pedidos/[id]` (aquí solo se anuncia y se navega).
      setPlacedId(created.order.id);
      return;
    }
    setMockTrackingId(created.order.id);
    setLoadingDraft(true);
    drafts
      .load(created.order.displayNumber)
      .then((order) => finalize(order))
      .catch(() => setSubmitError(t('checkout.orderError')))
      .finally(() => setLoadingDraft(false));
  };

  const place = usePlaceOrder({ clearCart: !simulation, onSuccess: handleCreated });
  const busy = place.busy || loadingDraft;

  // Cotización cambiada/vencida/inválida: se recotiza para que la pantalla muestre los importes y bloqueos vigentes.
  const failure = place.state.status === 'failed' ? place.state.failure.kind : null;
  const refetchQuote = data.quote.refetch;
  useEffect(() => {
    if (
      failure === 'quoteChanged' ||
      failure === 'quoteExpired' ||
      failure === 'quoteInvalid' ||
      failure === 'keyReused' ||
      failure === 'blocked'
    ) {
      refetchQuote();
    }
  }, [failure, refetchQuote]);

  useEffect(() => {
    if (!placedId) return;
    const id = setTimeout(() => routerRef.current.replace(`/pedidos/${placedId}`), 250);
    return () => clearTimeout(id);
  }, [placedId]);

  const submit = async () => {
    if (busy) return;
    // Solo con una cotización vigente que traiga su token (F19): nunca se confirma «a ciegas».
    if (!data.confirmationAvailable) return;
    const invalid = ([1, 2, 3, 4] as const).find((s) => !data.stepOk(s));
    if (invalid) {
      dispatch({ type: 'goto', step: invalid, showErrors: true });
      focusFirstError();
      return;
    }
    const intent = buildIntent();
    const token = data.serverQuote?.quote.token;
    if (!intent || !token) return;
    setSubmitError('');
    place.reset();
    await place.place(intent, token);
  };

  // ── Estados de pantalla ─────────────────────────────────────────────────────────────────
  if (placedId) {
    return (
      <div className="wrap flex flex-col items-center gap-3 py-16 text-center">
        {/* Se anuncia ANTES de navegar; el foco lo toma el título de la ruta de destino (una sola vez). */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="quote-live">
          {t('checkout.order.liveReceived')}
        </p>
        <Loader2 className="anim-spin h-8 w-8 text-secondary" aria-hidden="true" />
        <p className="m-0 text-muted">{t('orders.received.loading')}</p>
      </div>
    );
  }
  if (confirmed)
    return (
      <Confirmation order={confirmed} onOrderChange={setConfirmed} trackingId={mockTrackingId} />
    );

  const loadFailed =
    // `GET /v1/store/config` NO existe en la API (F10 pendiente): con `http` su 404 no es un fallo de carga del checkout.
    (data.configQuery.isError && !data.configQuery.unavailable) ||
    data.branchesQuery.isError ||
    data.view.status === 'error';
  const loading =
    !loadFailed &&
    (!ready ||
      data.configQuery.isPending ||
      data.branchesQuery.isPending ||
      (data.cartLinesCount > 0 && data.view.status === 'pending'));

  if (data.cartLinesCount === 0 && ready) {
    return (
      <div className="wrap py-16">
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <span className="tile-cream inline-flex rounded-full p-4">
            <FoodArt kind="roll" className="h-[96px] w-[96px]" />
          </span>
          <h1 className="disp text-[30px]">{t('checkout.emptyTitle')}</h1>
          <p className="m-0 text-muted">{t('checkout.emptySub')}</p>
          <Link href={STORE_ROUTES.menu} className="btn btn-primary">
            {t('common.goMenu')}
          </Link>
        </div>
      </div>
    );
  }

  // F19: desde «Envío» (y al confirmar) solo se avanza con una cotización VIGENTE, de las entradas ACTUALES y `canProceed`.
  const quoteGate = step >= 3 && !data.quote.canContinue;
  const noConfirm = isLast && !data.confirmationAvailable;
  const blocked = busy ? false : quoteGate || loading || loadFailed || noConfirm;
  const quoteStatus = data.quote.status;
  const liveKey = placementLiveKey(place.state);
  const waitingQuote = quoteStatus === 'loading' || quoteStatus === 'expired';
  const reason = loadFailed
    ? t('checkout.quote.reason.loadFailed')
    : loading
      ? t('checkout.quote.reason.loading')
      : quoteGate && data.branchMismatch
        ? t('checkout.quote.reason.branch')
        : quoteGate && data.addressPending
          ? t('checkout.quote.reason.address')
          : quoteGate && quoteStatus === 'error'
            ? t('checkout.quote.reason.error')
            : quoteGate && quoteStatus === 'idle'
              ? t('checkout.quote.reason.idle')
              : quoteGate && quoteStatus !== 'ready'
                ? t('checkout.quote.reason.calculating')
                : quoteGate
                  ? t('checkout.quote.reason.problem')
                  : noConfirm
                    ? t('checkout.order.confirmReason')
                    : '';
  /** Bloqueado: no avanza; el foco va al primer bloqueo de la cotización o, si solo está calculando, a la frase del motivo. */
  const onBlocked = () => {
    const issue = document.querySelector<HTMLElement>(
      '#paso-actual [data-focus-error], #paso-actual [aria-invalid="true"]:not([data-skip-focus])',
    );
    const reasons = [...document.querySelectorAll<HTMLElement>('[data-reason]')];
    // En jsdom `offsetParent` es siempre null: se cae al primero.
    const visible = reasons.find((r) => r.offsetParent !== null) ?? reasons[0] ?? null;
    (issue ?? visible)?.focus();
  };
  const action: SummaryAction = {
    label: busy
      ? t(
          place.state.status === 'sending' && place.state.retrying
            ? 'checkout.order.retrying'
            : 'checkout.order.sending',
        )
      : isLast
        ? t('checkout.placeOrder')
        : t('checkout.continueTo', { a: (steps[step] ?? '').toLowerCase() }),
    onClick: blocked ? onBlocked : isLast ? () => void submit() : () => goTo(step + 1),
    busy,
    blocked,
    reason,
    isLast,
    showSimulation: simulation,
  };
  const summary = <OrderSummary data={data} onEdit={cartDrawer.open} action={action} />;
  const profileChanged =
    signedIn &&
    !!data.me &&
    (draft.contact.name.trim() !== data.me.fullName ||
      draft.contact.phone.trim() !== data.me.phone ||
      draft.contact.email.trim() !== data.me.email);

  return (
    <div className="wrap max-w-[1080px] pb-[calc(118px+env(safe-area-inset-bottom))] pt-7 sm:pt-10 lg:pb-12">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (step > 1 ? goTo(step - 1) : router.back())}
          aria-label={
            step > 1
              ? t('checkout.backTo', { a: (steps[step - 2] ?? '').toLowerCase() })
              : t('common.back')
          }
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-bold uppercase tracking-[0.14em] text-muted">
            {t('checkout.stepOf', { a: step, b: CHECKOUT_STEP_COUNT })}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="disp text-[clamp(26px,6vw,38px)] outline-none"
          >
            {stepName}
          </h1>
        </div>
      </div>

      <ol
        className="mb-6 grid list-none grid-cols-5 gap-1.5 p-0"
        aria-label={t('checkout.progressAria')}
      >
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="min-w-0">
              <button
                type="button"
                onClick={() => goTo(n)}
                aria-current={current ? 'step' : undefined}
                className="flex w-full flex-col gap-1.5 text-left"
              >
                <span
                  className={cn(
                    'block h-1.5 rounded-full',
                    done ? 'bg-secondary' : current ? 'bg-primary' : 'bg-line',
                  )}
                />
                <span
                  className={cn(
                    'flex items-center gap-1 truncate text-[11px] font-bold sm:text-[13px]',
                    current ? 'text-fg' : 'text-muted max-[519px]:sr-only',
                  )}
                >
                  {done ? <Check className="h-3 w-3 flex-none" aria-hidden="true" /> : null}
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
        <div id="paso-actual" key={step} className="anim-step min-w-0">
          {loadFailed ? (
            <ErrorNotice
              onRetry={() => {
                if (data.configQuery.isError && !data.configQuery.unavailable)
                  void data.configQuery.refetch();
                if (data.branchesQuery.isError) void data.branchesQuery.refetch();
                if (data.view.status === 'error') data.view.retry();
              }}
            />
          ) : loading ? (
            <OrderStepSkeleton lines={data.cartLinesCount} />
          ) : (
            <div className="flex flex-col gap-4">
              {step >= 3 ? <QuoteAlerts data={data} goTo={goTo} /> : null}
              {step === 1 ? (
                <OrderStep data={data} />
              ) : step === 2 ? (
                <DeliveryStep
                  data={data}
                  extras={extras}
                  setExtras={setExtras}
                  profileChanged={profileChanged}
                />
              ) : step === 3 ? (
                <ShippingStep data={data} goTo={goTo} summary={summary} />
              ) : step === 4 ? (
                <PaymentStep data={data} />
              ) : (
                <ReviewStep
                  data={data}
                  goTo={goTo}
                  summary={summary}
                  error={submitError}
                  placement={
                    <PlacementStatus
                      state={place.state}
                      onRetry={place.retry}
                      onAcceptChange={place.acceptChange}
                      onCancelChange={place.reset}
                      lineName={(i) => {
                        const sent = i === undefined ? undefined : data.quoteInputs?.cart.lines[i];
                        return quoteLineName(
                          rowNamesByConfig(data.rows),
                          sent,
                          sent?.productId ?? '',
                        );
                      }}
                    />
                  }
                />
              )}
            </div>
          )}
        </div>
        <div className="hidden lg:sticky lg:top-[96px] lg:block">{summary}</div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-[66] border-t border-line bg-surface/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur lg:hidden">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-bold text-muted">
              {data.totalIsEstimate ? t('checkout.estimatedTotal') : t('common.total')}
              {data.type === 'delivery' && data.shipping == null ? (
                <span className="font-normal">
                  {' · '}
                  {t('checkout.quote.deliveryFee')}: {t('checkout.quote.pending')}
                </span>
              ) : null}
            </span>
            <span className="flex-none font-display text-[20px] text-fg">
              {waitingQuote ? '…' : money(data.total)}
            </span>
          </div>
          <button
            type="button"
            onClick={action.onClick}
            disabled={busy}
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? 'checkout-bar-reason' : undefined}
            aria-busy={busy}
            className="btn btn-primary w-full !pointer-events-auto !justify-between !px-6 text-[16px]"
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              {busy ? <Loader2 className="anim-spin h-5 w-5 flex-none" aria-hidden="true" /> : null}
              {action.label}
            </span>
            {isLast ? (
              <span className="font-display">
                {waitingQuote ? '…' : money(data.total)}
                {data.totalIsEstimate && !waitingQuote ? (
                  <small className="ml-1 text-[12px] font-normal">
                    ({t('checkout.quote.estimatedTag')})
                  </small>
                ) : null}
              </span>
            ) : (
              <ArrowRight className="h-5 w-5 flex-none" aria-hidden="true" />
            )}
          </button>
          {blocked ? (
            <p
              id="checkout-bar-reason"
              tabIndex={-1}
              data-reason
              className="m-0 mt-1.5 text-[13px] leading-snug text-fg outline-none"
            >
              {reason}
            </p>
          ) : null}
        </div>
      </div>

      {/* UNA sola región polite (importes, estado de la confirmación y paso actual). */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="quote-live">
        {liveKey
          ? t(`checkout.order.${liveKey}` as 'checkout.order.sending')
          : quoteStatus === 'error'
            ? t('checkout.quote.liveError')
            : data.quote.updating || quoteStatus === 'loading'
              ? t('checkout.quote.liveUpdating')
              : data.serverQuote?.total
                ? t('checkout.quote.liveTotal', {
                    a: money((moneyToCents(data.serverQuote.total) ?? 0) / 100),
                  })
                : `${t('checkout.stepOf', { a: step, b: CHECKOUT_STEP_COUNT })}: ${stepName}`}
      </p>
    </div>
  );
}

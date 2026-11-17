'use client';

import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/data-access/errors';
import type { CreateOrderRequest, Order } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { useCreateAddress, useUpdateMe } from '@/features/account/hooks';
import { useLocationOptions } from '@/features/delivery-coverage/hooks';
import { useCart } from '@/features/cart/cart-context';
import { useCreateOrder } from '@/features/orders/hooks';
import { saveLastOrder } from '@/features/orders/last-order';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useCartDrawer } from '@/features/store-shell/store-shell-context';
import { CHECKOUT_STEP_COUNT, zoneForOrder, type CheckoutStep } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import { clearRemembered, writeRemembered } from '../remember';
import { useCheckoutData } from '../use-checkout-data';
import { addressSignature, decideSaveAddress } from '../save-address';
import { Confirmation } from './Confirmation';
import { DeliveryStep, type CheckoutExtras } from './DeliveryStep';
import { NeonetDialog, type NeonetOutcome } from './NeonetDialog';
import { OrderStep, OrderStepSkeleton } from './OrderStep';
import { OrderSummary, type SummaryAction } from './OrderSummary';
import { PaymentStep } from './PaymentStep';
import { useCheckoutSteps } from './parts';
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
      '#paso-actual [aria-invalid="true"], #paso-actual [data-focus-error]',
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
 * Checkout de 5 pasos (Tu pedido → Entrega → Envío → Pago → Confirmación) + pasarela NeoNet simulada.
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
  const { mode } = useOrderMode();
  const cartDrawer = useCartDrawer();
  const createOrder = useCreateOrder();
  const createAddress = useCreateAddress();
  const addressLocations = useLocationOptions(draft.address.department);
  const updateMe = useUpdateMe();

  const [confirmed, setConfirmed] = useState<Order | null>(null);
  const [pending, setPending] = useState<{ order: Order; signature: string } | null>(null);
  const [neonetOpen, setNeonetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  /** Cuerpo del pedido: intención del cliente (el servidor calcula precios, envío y totales). */
  const buildRequest = (): CreateOrderRequest => {
    const delivery = data.type === 'delivery';
    return {
      fulfillment: delivery ? 'delivery' : 'pickup',
      branchId: data.branchId ?? undefined,
      schedule: mode.when,
      customer: {
        name: draft.contact.name.trim(),
        phone: draft.contact.phone.trim(),
        email: draft.contact.email.trim(),
      },
      address: delivery
        ? {
            department: draft.address.department,
            municipality: draft.address.municipality,
            zone: zoneForOrder(draft.address),
            line: draft.address.line.trim(),
            references: draft.address.references.trim(),
          }
        : undefined,
      lines: data.rows.map(({ line }) => ({
        productId: line.productId,
        quantity: line.quantity,
        ...(line.note ? { note: line.note } : {}),
      })),
      paymentMethod: draft.payment === 'card' ? 'card' : 'cash',
      note: draft.notes.trim() || undefined,
    };
  };

  /** Pedido confirmado: guarda el resumen, vacía el carrito, aplica las preferencias y muestra la confirmación. */
  const finalize = (order: Order) => {
    saveLastOrder(order);
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
    setNeonetOpen(false);
    setPending(null);
    // SIMULADO (MOCK_ONLY): vacía solo por el flujo de demostración. `clearAfterOrder` queda reservado para F20 (pedido real).
    cart.clear();
    discard();
    setConfirmed(order);
    scrollTop();
  };

  const errorMessage = (error: unknown): string => {
    if (isApiError(error)) {
      if (error.status === 0) return t('checkoutFlow.errOffline');
      if (error.status === 409) return t('checkoutFlow.errConflict');
      if (error.status === 422) return t('delivery.notCovered');
    }
    return t('checkout.orderError');
  };

  const submit = async () => {
    if (busy) return;
    const invalid = ([1, 2, 3, 4] as const).find((s) => !data.stepOk(s));
    if (invalid) {
      dispatch({ type: 'goto', step: invalid, showErrors: true });
      focusFirstError();
      return;
    }
    setSubmitError('');
    const body = buildRequest();
    const signature = JSON.stringify(body);
    if (draft.payment === 'card' && pending && pending.signature === signature) {
      setNeonetOpen(true);
      return;
    }
    setBusy(true);
    try {
      const order = await createOrder.mutateAsync(body);
      if (draft.payment === 'card') {
        setPending({ order, signature });
        setNeonetOpen(true);
      } else {
        finalize(order);
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  /** Aplica el resultado del pago (sin datos de tarjeta salvo marca/últimos 4 que ya devuelve el servidor). */
  const withPayment = (order: Order, outcome: NeonetOutcome): Order => ({
    ...order,
    payment: {
      ...order.payment,
      status: outcome.status,
      reference: outcome.reference,
      cardLast4: outcome.last4,
      processedAt: outcome.processedAt,
    },
  });

  // ── Estados de pantalla ─────────────────────────────────────────────────────────────────
  if (confirmed) return <Confirmation order={confirmed} onOrderChange={setConfirmed} />;

  const loadFailed =
    data.configQuery.isError || data.branchesQuery.isError || data.view.status === 'error';
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

  const quoteLoading =
    step === 3 &&
    data.type === 'delivery' &&
    data.selectionComplete &&
    data.coverage.state === 'loading';
  const action: SummaryAction = {
    label: busy
      ? t('checkout.registering')
      : isLast
        ? draft.payment === 'card'
          ? t('checkout.payNow')
          : t('checkout.placeOrder')
        : t('checkout.continueTo', { a: (steps[step] ?? '').toLowerCase() }),
    onClick: isLast ? () => void submit() : () => goTo(step + 1),
    busy,
    disabled: busy || quoteLoading || loading || loadFailed,
    isLast,
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
                if (data.configQuery.isError) void data.configQuery.refetch();
                if (data.branchesQuery.isError) void data.branchesQuery.refetch();
                if (data.view.status === 'error') data.view.retry();
              }}
            />
          ) : loading ? (
            <OrderStepSkeleton lines={data.cartLinesCount} />
          ) : step === 1 ? (
            <OrderStep data={data} />
          ) : step === 2 ? (
            <DeliveryStep
              data={data}
              extras={extras}
              setExtras={setExtras}
              profileChanged={profileChanged}
            />
          ) : step === 3 ? (
            <ShippingStep data={data} goTo={goTo} />
          ) : step === 4 ? (
            <PaymentStep />
          ) : (
            <ReviewStep data={data} goTo={goTo} summary={summary} error={submitError} />
          )}
        </div>
        <div className="hidden lg:sticky lg:top-[96px] lg:block">{summary}</div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-[66] border-t border-line bg-surface/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur lg:hidden">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-bold text-muted">
              {data.type === 'delivery' ? t('checkout.estimatedTotal') : t('common.total')}
              {data.type === 'delivery' && data.shipping == null ? (
                <span className="font-normal">
                  {' · '}
                  {t('checkout.estimatedShipping')}: {t('checkout.toQuote')}
                </span>
              ) : null}
            </span>
            <span className="flex-none font-display text-[20px] text-fg">{money(data.total)}</span>
          </div>
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            aria-busy={busy}
            className="btn btn-primary w-full !justify-between !px-6 text-[16px]"
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              {busy ? <Loader2 className="anim-spin h-5 w-5 flex-none" aria-hidden="true" /> : null}
              {action.label}
            </span>
            {isLast ? (
              <span className="font-display">{money(data.total)}</span>
            ) : (
              <ArrowRight className="h-5 w-5 flex-none" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {t('checkout.stepOf', { a: step, b: CHECKOUT_STEP_COUNT })}: {stepName}
      </p>

      {pending && neonetOpen ? (
        <NeonetDialog
          order={pending.order}
          now={data.now ?? new Date()}
          onClose={() => setNeonetOpen(false)}
          onApproved={(outcome) => finalize(withPayment(pending.order, outcome))}
          onPendingContinue={(outcome) => finalize(withPayment(pending.order, outcome))}
          onChangeMethod={() => {
            setNeonetOpen(false);
            goTo(4);
          }}
        />
      ) : null}
    </div>
  );
}

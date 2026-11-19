'use client';

import { ArrowRight, LoaderCircle, PackageSearch, Search, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useMyOrders } from '@/features/account/hooks';
import { OrderCard } from '@/features/orders/components/order-card';
import { useIsSimulation, useLookupOrder } from '@/features/orders/hooks';
import { useDemoSession } from '@/features/session/demo-session';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { isApiError } from '@/lib/data-access/errors';
import { isOrderInProgress } from '@/lib/order-status';
import { hasLookupErrors, lookupDestination, validateLookup } from '../lookup-validation';
import { rememberVerifiedOrder } from '../verified-orders';

/** Datos de la consulta de demostración (los del pedido sembrado; coinciden con `track.demoHint`). */
const DEMO_LOOKUP = { orderNumber: 'MON-490217', phone: '5555-1234' } as const;

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  error: string;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    className: string;
  }) => React.ReactNode;
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

/**
 * Consulta de invitado: número de pedido (MON-xxxxxx) + teléfono → seguimiento (o reclamo con
 * `?next=incidencia`). Los errores de formato se anuncian junto al campo y llevan el foco al primero
 * inválido; si el pedido no existe o el teléfono no coincide, el aviso es el mismo (no revela si existe).
 * La verificación solo se recuerda en esta pestaña (conveniencia): ver el pedido lo decide el servidor.
 */
function LookupFormSimulated({
  initialOrderNumber = '',
  next = null,
  notFound = false,
}: {
  initialOrderNumber?: string;
  next?: string | null;
  /** Llegó desde un seguimiento al que no tenía acceso: muestra el mismo aviso genérico. */
  notFound?: boolean;
}) {
  const t = useTranslations('track');
  const tcom = useTranslations('common');
  const tu = useTranslations('ui');
  const router = useRouter();
  const { customer } = useDemoSession();
  const auth = useAuthModal();
  const mine = useMyOrders();
  const lookup = useLookupOrder();

  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const errors = validateLookup(orderNumber, phone);
  const active = customer ? (mine.data ?? []).filter(isOrderInProgress) : [];
  const notFoundShown = lookup.isError
    ? isApiError(lookup.error) && lookup.error.status === 404
    : notFound;
  const tooMany = lookup.isError && isApiError(lookup.error) && lookup.error.status === 429;
  const failed = lookup.isError && !notFoundShown && !tooMany;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    lookup.reset();
    if (hasLookupErrors(errors)) {
      (errors.orderNumber ? idRef : phoneRef).current?.focus();
      return;
    }
    lookup.mutate(
      { orderNumber: orderNumber.trim(), phone: phone.trim() },
      {
        onSuccess: (order) => {
          rememberVerifiedOrder(order.id);
          router.push(lookupDestination(order.id, next));
        },
      },
    );
  };

  const pending = lookup.isPending;
  return (
    <div className="wrap max-w-[720px] pb-10 pt-5 sm:pt-8">
      <h1 className="disp mb-1 text-[clamp(30px,6vw,48px)]">
        {t('title')}{' '}
        <span
          className="ml-1 align-middle font-jp text-[0.4em] tracking-[0.2em] text-primary"
          lang="ja"
        >
          {t('jp')}
        </span>
      </h1>
      <p className="m-0 mb-5 text-muted">{t('intro')}</p>

      {customer && active.length > 0 ? (
        <section aria-labelledby="tr-active" className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="tr-active" className="eyebrow text-secondary">
              {t('yourActive')}
            </h2>
            <Link href="/cuenta/pedidos" className="link-btn !min-h-0 text-sm">
              {t('seeAll')}
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {active.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      ) : null}

      <form
        onSubmit={onSubmit}
        noValidate
        className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5"
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
            <PackageSearch className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="m-0 font-extrabold leading-tight">{t('title')}</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field
            id="tr-id"
            label={t('orderId')}
            error={submitted && errors.orderNumber ? t(errors.orderNumber) : ''}
          >
            {(props) => (
              <input
                {...props}
                ref={idRef}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={t('orderIdPh')}
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
            )}
          </Field>
          <Field
            id="tr-phone"
            label={t('phone')}
            error={submitted && errors.phone ? t(errors.phone) : ''}
          >
            {(props) => (
              <input
                {...props}
                ref={phoneRef}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder={t('phonePh')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div aria-live="polite">
          {notFoundShown ? (
            <div className="notice notice-warn mt-4">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div>{t('notFound')}</div>
            </div>
          ) : null}
          {tooMany ? (
            <div className="notice notice-warn mt-4">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div>{t('tooManyAttempts')}</div>
            </div>
          ) : null}
          {failed ? (
            <div className="notice notice-warn mt-4">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div>{tu('errorTitle')}</div>
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="btn btn-primary mt-4 w-full sm:w-auto"
        >
          {pending ? (
            <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
          ) : (
            <Search className="h-5 w-5" aria-hidden="true" />
          )}
          {pending ? t('searching') : t('submit')}
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line pt-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <SimulationBadge kind="demo">{tcom('demo')}</SimulationBadge> {t('demoHint')}
          </p>
          <button
            type="button"
            onClick={() => {
              setOrderNumber(DEMO_LOOKUP.orderNumber);
              setPhone(DEMO_LOOKUP.phone);
              lookup.reset();
            }}
            className="inline-flex min-h-[36px] items-center text-sm font-extrabold text-secondary"
          >
            {t('useDemo')}
          </button>
        </div>
      </form>

      {!customer ? (
        <button
          type="button"
          onClick={auth.open}
          className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-left hover:bg-subtle"
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-line bg-white">
            <GoogleLogo />
          </span>
          <span className="min-w-0 flex-1 text-[14px] font-bold leading-snug">
            {t('signInHint')}
          </span>
          <ArrowRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * F21 (spec 022 §2.3, P62): con la API real NO existe la consulta por número + teléfono (enumerable y expone datos personales;
 * se diferió hasta poder verificar el teléfono). `/consultar` solo informa con honestidad: sin formulario ni solicitud alguna.
 * En `mock` se conserva el formulario simulado.
 */
export function LookupForm(props: Parameters<typeof LookupFormSimulated>[0]) {
  const simulation = useIsSimulation();
  const t = useTranslations('track');
  const tc = useTranslations('common');
  if (simulation) return <LookupFormSimulated {...props} />;
  return (
    <div className="wrap max-w-[720px] pb-10 pt-5 sm:pt-8" data-testid="lookup-deferred">
      <h1 className="disp mb-3 text-[clamp(30px,6vw,48px)]">{t('httpTitle')}</h1>
      <div className="notice notice-info">
        <PackageSearch className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">{t('httpBody')}</p>
      </div>
      <div className="mt-5">
        <Link href="/" className="btn btn-primary no-underline">
          {tc('backHome')}
        </Link>
      </div>
    </div>
  );
}

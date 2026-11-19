'use client';

import {
  Ban,
  ChefHat,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock,
  Info,
  PackageCheck,
  Phone,
  Store,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/data-access/errors';
import type { OrderTracking } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import { usePublicBranches } from '@/features/branches/hooks';
import { readGuestToken, readOrderNumber } from '@/features/checkout/confirmation-store';
import { useIsSimulation, useOrderDetail, useOrderTracking } from '@/features/orders/hooks';
import { PaymentStatus } from '@/features/payments/PaymentStatus';
import { phaseTextKey } from '../tracking-model';
import { TrackingDemoAdvance } from './tracking-demo-advance';
import { TrackingPhases } from './tracking-phases';
import { TrackingSummary } from './tracking-summary';
import { TrackingTimeline } from './tracking-timeline';

const PHASE_ICON: Record<string, LucideIcon> = {
  received: Clock,
  accepted: ClipboardCheck,
  preparing: ChefHat,
  readyPickup: PackageCheck,
  readyDelivery: PackageCheck,
  onTheWay: Truck,
  delivered: CircleCheck,
  pickedUp: CircleCheck,
  rejected: CircleX,
  cancelled: Ban,
};

function Card({
  title,
  id,
  children,
  className,
}: {
  title: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5', className)}
    >
      <h2 id={id} className="disp mb-3 text-[20px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'info'; children: ReactNode }) {
  // Sin `role`: la ÚNICA región `aria-live` de la pantalla es la de los cambios de estado (spec 022 §9.4).
  return (
    <div className={cn('notice items-center', tone === 'warn' ? 'notice-warn' : 'notice-info')}>
      {tone === 'info' ? (
        <Info className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
      ) : (
        <TriangleAlert className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        {children}
      </div>
    </div>
  );
}

function LostAccess({ orderId }: { orderId: string }) {
  const t = useTranslations('tracking');
  const number = readOrderNumber(orderId);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  return (
    <div className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10" data-testid="tracking-lost">
      <div className="notice notice-warn">
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 ref={titleRef} tabIndex={-1} className="disp text-[24px] outline-none">
            {t('lostTitle')}
          </h1>
          <p className="m-0 mb-2">{t('lostBody')}</p>
          {number ? (
            <p className="m-0 font-bold" data-testid="order-number">
              {t('lostNumber', { a: number })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10"
    >
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-5 h-40 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-64 w-full rounded-2xl" />
    </div>
  );
}

/** Entrega o retiro: solo datos reales (proveedor). Jamás repartidor, GPS ni ETA; PedidosYa sin tracking externo. */
function FulfillmentBlock({ tracking }: { tracking: OrderTracking }) {
  const t = useTranslations('tracking');
  const branches = usePublicBranches().data;
  const branch = branches?.find((b) => b.id === tracking.branchId);
  const delivery = tracking.fulfillmentType === 'DELIVERY';
  let note: string;
  if (!delivery) note = t('pickupNote');
  else if (tracking.delivery?.provider === 'OWN') note = t('deliveryOwn');
  else if (tracking.delivery?.provider === 'PEDIDOSYA') note = t('deliveryExternal');
  else note = t('deliveryUnknown');
  return (
    <Card id="trk-fulfillment" title={delivery ? t('deliveryTitle') : t('pickupTitle')}>
      <dl className="m-0 flex flex-col gap-2 text-[15px]">
        <div className="flex gap-3">
          <dt className="w-[34%] flex-none text-[13px] font-bold text-muted">{t('mode')}</dt>
          <dd className="m-0 font-bold">{delivery ? t('modeDelivery') : t('modePickup')}</dd>
        </div>
        {branch ? (
          <div className="flex gap-3">
            <dt className="w-[34%] flex-none text-[13px] font-bold text-muted">
              <Store className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              {t('branch')}
            </dt>
            <dd className="m-0 min-w-0 break-words font-bold" data-testid="branch-name">
              {branch.name}
              <span className="block text-[13px] font-normal text-muted">{branch.address}</span>
              {branch.phone ? (
                <a
                  href={`tel:${branch.phone.replace(/[^\d+]/g, '')}`}
                  className="link-btn !min-h-[44px] items-center text-sm"
                >
                  <Phone className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {branch.phone}
                </a>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="m-0 mt-3 text-[14px] font-bold" data-testid="fulfillment-note">
        {note}
      </p>
      {delivery && tracking.delivery?.provider === 'OWN' ? (
        <p className="m-0 mt-1 text-[13px] text-muted">{t('deliveryOwnNote')}</p>
      ) : null}
      {delivery && tracking.delivery?.provider === 'PEDIDOSYA' ? (
        <p className="m-0 mt-1 text-[13px] text-muted">{t('deliveryExternalNote')}</p>
      ) : null}
    </Card>
  );
}

/**
 * F21 (spec 022 §9) — Pantalla de seguimiento `/pedidos/[id]/seguimiento`. Orden (también móvil): número, estado, fases e historial,
 * entrega/retiro, resumen. El estado sale de `publicStatus` (códigos del servidor → textos es/en); NUNCA se afirma «aceptado» ni
 * «pagado» por inferencia y un fallo HTTP jamás marca el pedido como cancelado: ante error se conserva la última información
 * atenuada con un aviso. Una sola región `aria-live` educada anuncia los cambios de estado; el foco no se roba al actualizar.
 */
export function OrderTrackingScreen({ orderId }: { orderId: string }) {
  const t = useTranslations('tracking');
  const locale = useLocale();
  const simulation = useIsSimulation();
  const token = readGuestToken(orderId);
  const tracking = useOrderTracking(orderId, token);
  const { data } = tracking;
  const summary = useOrderDetail(orderId, token, {
    once: true,
    // Sin sesión ni credencial (acceso perdido) no se emite NINGUNA solicitud, tampoco la del resumen.
    enabled: !tracking.pending && !tracking.noCredentials,
  });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);

  // Anuncios en la ÚNICA región `aria-live` (ajuste de estado durante el render: sin efecto ni segunda región): un mensaje por
  // TRANSICIÓN (cambio de estado del pedido; entrar en sin conexión/ocupado/rendición; recuperarse), nunca por cada consulta.
  const errorStatus = isApiError(tracking.error) ? tracking.error.status : 0;
  const conn: 'ok' | 'offline' | 'busy' | 'gaveUp' = tracking.gaveUp
    ? 'gaveUp'
    : tracking.failing
      ? errorStatus === 0
        ? 'offline'
        : 'busy'
      : 'ok';
  const lastInfo = data ? formatDateTime(data.generatedAt, locale) : '';
  const [seen, setSeen] = useState<string | null>(null);
  const [prevConn, setPrevConn] = useState<typeof conn>('ok');
  const [announcement, setAnnouncement] = useState('');
  const currentLabel = data
    ? t(`phase.${phaseTextKey(data.publicStatus, data.fulfillmentType)}`)
    : '';
  if (conn !== prevConn) {
    setPrevConn(conn);
    setAnnouncement(
      conn === 'ok'
        ? t('recovered')
        : conn === 'offline'
          ? data
            ? t('offline', { a: lastInfo })
            : t('offlineNoData')
          : conn === 'busy'
            ? t('busy')
            : t('gaveUp'),
    );
  }
  if (data && data.status !== seen) {
    setSeen(data.status);
    if (seen !== null) setAnnouncement(t('announce', { a: currentLabel }));
  }

  // Al mostrarse el contenido por primera vez (datos o error sin datos) el foco pasa al título (como la confirmación); no se
  // vuelve a mover en las actualizaciones.
  const showing =
    !tracking.lost &&
    !tracking.noCredentials &&
    (!!data || (!tracking.pending && !tracking.isLoading));
  useEffect(() => {
    if (showing && !focused.current) {
      focused.current = true;
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [showing]);

  if (tracking.lost || tracking.noCredentials) return <LostAccess orderId={orderId} />;
  if (!data && (tracking.pending || tracking.isLoading)) return <Loading label={t('loading')} />;

  const live = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live">
      {announcement}
    </p>
  );

  if (!data) {
    const message = tracking.rateLimitSec
      ? t('rateLimited')
      : tracking.gaveUp
        ? t('gaveUp')
        : errorStatus >= 500
          ? t('busy')
          : t('offlineNoData');
    return (
      <div className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10" data-testid="order-tracking">
        {live}
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="disp mb-4 text-[clamp(26px,6vw,36px)] outline-none"
          data-testid="tracking-error-title"
        >
          {t('pageTitle')}
        </h1>
        <Notice>
          <span data-testid="conn-message">{message}</span>
          <button type="button" className="link-btn !min-h-[44px] text-sm" onClick={tracking.retry}>
            {t('retry')}
          </button>
        </Notice>
      </div>
    );
  }

  const textKey = phaseTextKey(data.publicStatus, data.fulfillmentType);
  const Icon = PHASE_ICON[textKey] ?? Clock;
  const negative = data.publicStatus === 'rejected' || data.publicStatus === 'cancelled';
  const stale = tracking.failing || tracking.gaveUp;
  const connMessage =
    conn === 'offline'
      ? t('offline', { a: lastInfo })
      : conn === 'busy'
        ? t('busy')
        : conn === 'gaveUp'
          ? t('gaveUp')
          : '';

  return (
    <div className="wrap max-w-[760px] pb-12 pt-5 sm:pt-8" data-testid="order-tracking">
      {live}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="m-0 text-[12px] font-bold uppercase tracking-[0.14em] text-muted"
            aria-hidden="true"
          >
            {t('number')}
          </p>
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="disp text-[clamp(30px,7vw,44px)] outline-none"
            data-testid="order-number"
          >
            <span className="sr-only">{t('number')}: </span>
            {data.displayNumber}
          </h1>
          <p className="m-0 text-[14px] text-muted">
            {t('placedAt', { a: formatDateTime(data.placedAt, locale) })}
          </p>
        </div>
        {simulation ? <SimulationBadge kind="simulation" /> : null}
      </div>

      <div className="flex flex-col gap-4">
        {tracking.rateLimitSec ? (
          <Notice tone="info">
            <span>{t('rateLimited')}</span>
          </Notice>
        ) : null}
        {/* Contenedor estable en el DOM (no se monta/desmonta); el anuncio va en la región `aria-live` única. */}
        <div hidden={!connMessage} data-testid="conn-notice">
          {connMessage ? (
            <Notice>
              <span data-testid="conn-message">{connMessage}</span>
              {tracking.gaveUp ? (
                <button
                  type="button"
                  className="link-btn !min-h-[44px] text-sm"
                  onClick={tracking.retry}
                >
                  {t('retry')}
                </button>
              ) : null}
            </Notice>
          ) : null}
        </div>

        <section
          aria-labelledby="trk-status"
          aria-busy={tracking.isFetching || undefined}
          data-stale={stale ? 'true' : undefined}
          className={cn(
            'rounded-2xl border p-4 shadow-card transition-opacity motion-reduce:transition-none sm:p-5',
            negative ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface',
            // Atenuado SIN bajar el contraste del texto bajo AA (la opacidad lo hacía): borde discontinuo e ícono tenue; la señal
            // principal es el aviso textual.
            stale && 'border-dashed',
          )}
        >
          <p className="lbl m-0" id="trk-status">
            {t('statusLabel')}
          </p>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-full',
                stale && 'opacity-50',
                negative ? 'bg-danger text-onprimary' : 'bg-primary-soft text-primary',
              )}
              aria-hidden="true"
            >
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="disp m-0 text-[clamp(22px,5vw,30px)]" data-testid="status-label">
                {currentLabel}
              </p>
              <p className="m-0 mt-1 text-[15px]" data-testid="status-hint">
                {t(`phaseHint.${textKey}`)}
              </p>
              <p className="m-0 mt-2 text-[13px] text-muted">
                {t('updatedAt', { a: lastInfo })}
                {data.terminal ? ` · ${t('terminalNote')}` : ''}
              </p>
            </div>
          </div>
          {simulation && !data.terminal ? (
            <TrackingDemoAdvance
              displayNumber={data.displayNumber}
              onError={() => setAnnouncement(t('advanceError'))}
            />
          ) : null}
        </section>

        {simulation ? <p className="m-0 text-[13px] text-muted">{t('simulationNote')}</p> : null}

        <Card
          id="trk-phases"
          title={t('phasesTitle')}
          className={stale ? 'border-dashed' : undefined}
        >
          {data.steps.length === 0 ? (
            <p className="m-0 mb-3 text-[13px] text-muted">{t('incomplete')}</p>
          ) : null}
          <TrackingPhasesWithHistory tracking={data} />
        </Card>

        <FulfillmentBlock tracking={data} />

        <Card id="trk-payment" title={t('paymentTitle')}>
          <PaymentStatus
            payment={data.payment}
            fulfillmentType={data.fulfillmentType}
            closed={negative}
          />
        </Card>

        <Card id="trk-summary" title={t('summaryTitle')}>
          {summary.data ? (
            <TrackingSummary order={summary.data} />
          ) : summary.isError ? (
            <p className="m-0 text-[14px] text-muted">{t('summaryUnavailable')}</p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
          <div className="mt-4">
            <Link href={`/pedidos/${orderId}`} className="link-btn !min-h-[44px] text-sm">
              {t('viewDetail')}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TrackingPhasesWithHistory({ tracking }: { tracking: OrderTracking }) {
  const t = useTranslations('tracking');
  return (
    <>
      <TrackingPhases tracking={tracking} />
      <h3 className="lbl mt-5">{t('timelineTitle')}</h3>
      <TrackingTimeline
        events={tracking.events}
        truncated={tracking.eventsTruncated}
        fulfillmentType={tracking.fulfillmentType}
      />
    </>
  );
}

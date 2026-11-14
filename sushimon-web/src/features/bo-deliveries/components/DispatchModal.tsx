'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlert,
  IconBike,
  IconChevronLeft,
  IconCheck,
  IconClock,
  IconMapPin,
  IconShop,
  IconStore,
} from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { useCourierQuote, useDispatchOrder, useRiders } from '@/features/backoffice/hooks';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { errorMessage } from '@/features/bo-orders/error-message';
import { useOrderDetail } from '@/features/bo-orders/order-detail-context';
import { useScopedOrders } from '@/features/bo-orders/use-scoped-orders';
import { cn } from '@/lib/cn';
import type { CourierQuote, Order } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import {
  compareQuote,
  dispatchBlock,
  ownRiderOptions,
  type DispatchStep,
  type RiderState,
} from '../dispatch-model';
import { useDeliveryText } from '../use-delivery-text';

const RIDER_TONE = { free: 'success', busy: 'active', off: 'muted' } as const;

/**
 * Modal "Despachar pedido": elegir PedidosYa Courier (cotización SIMULADA) o un repartidor del restaurante.
 * Pasos como el prototipo: choose → loading → quote | own. Nada sale a la red: `useCourierQuote` y
 * `useDispatchOrder` pasan por la capa de datos (mock mientras PedidosYa no tenga documentación).
 */
export function DispatchModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const t = useTranslations('backoffice.dispatch');
  const orders = useScopedOrders();
  const order = orders.data?.find((o) => o.id === orderId);

  if (!order) {
    return (
      <Modal
        open
        zone="bo"
        iconTone="blue"
        icon={<IconBike />}
        title={t('title')}
        description={`#${orderId}`}
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
        }
      >
        {orders.isPending ? (
          <Banner zone="bo" tone="info" role="status" icon={<span className="spinner" />}>
            {t('loadingOrder')}
          </Banner>
        ) : (
          <Banner zone="bo" tone="warning" role="status">
            {t('notFound')}
          </Banner>
        )}
      </Modal>
    );
  }
  return <DispatchFlow order={order} onClose={onClose} />;
}

function DispatchFlow({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useTranslations('backoffice.dispatch');
  const toast = useToast();
  const detail = useOrderDetail();
  const { grants, branchById } = useShell();
  const text = useDeliveryText();
  const riders = useRiders(order.branchId);
  const quoteMutation = useCourierQuote();
  const dispatchMutation = useDispatchOrder();

  const [step, setStep] = useState<DispatchStep>('choose');
  const [riderId, setRiderId] = useState<string | null>(null);
  const [quote, setQuote] = useState<CourierQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  /** Descarta respuestas de cotizaciones que el usuario ya abandonó ("Cambiar opción"). */
  const requestRef = useRef(0);
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const branch = branchById(order.branchId);
  const branchName = branch?.name ?? order.branchId;
  const block = dispatchBlock(order, grants);
  const options = useMemo(() => ownRiderOptions(riders.data ?? [], order), [riders.data, order]);
  const available = options.filter((o) => o.available).length;
  const failedBefore = order.delivery?.status === 'failed';
  const comparison = quote ? compareQuote(quote, order) : null;
  const sending = dispatchMutation.isPending;

  const requestQuote = useCallback(() => {
    const id = ++requestRef.current;
    setStep('loading');
    setQuote(null);
    setQuoteError(null);
    setDispatchError(null);
    quoteMutation.mutate(order.id, {
      onSuccess: (q) => {
        if (id !== requestRef.current) return;
        setQuote(q);
        setStep('quote');
      },
      onError: (error) => {
        if (id !== requestRef.current) return;
        setQuoteError(errorMessage(error));
        setStep('quote');
      },
    });
  }, [quoteMutation, order.id]);

  const back = () => {
    requestRef.current += 1; // ignora una cotización en curso
    setStep('choose');
    setRiderId(null);
    setQuote(null);
    setQuoteError(null);
    setDispatchError(null);
  };

  const finish = () => {
    onClose();
    detail.open(order.id);
  };

  const confirmPedidosYa = () => {
    if (!quote || sending) return;
    setDispatchError(null);
    dispatchMutation.mutate(
      { id: order.id, provider: 'pedidosya' },
      {
        onSuccess: (updated) => {
          toast.notify(t('toastPedidosya', { reference: updated.delivery?.reference ?? '—' }));
          finish();
        },
        onError: (error) => setDispatchError(t('dispatchError', { message: errorMessage(error) })),
      },
    );
  };

  const assignOwn = () => {
    const chosen = options.find((o) => o.rider.id === riderId);
    if (!chosen || !chosen.available || sending) return;
    setDispatchError(null);
    dispatchMutation.mutate(
      { id: order.id, provider: 'own', riderId: chosen.rider.id },
      {
        onSuccess: () => {
          toast.notify(t('toastOwn', { rider: chosen.rider.name, id: order.id }));
          finish();
        },
        onError: (error) => setDispatchError(t('dispatchError', { message: errorMessage(error) })),
      },
    );
  };

  const title = step === 'choose' ? t('title') : step === 'own' ? t('ownTitle') : t('pyTitle');
  const subtitle =
    step === 'choose'
      ? t('chooseSub')
      : step === 'own'
        ? t('ownSub', { branch: branchName, count: available })
        : t('pySub');
  const isQuoteStep = step === 'loading' || step === 'quote';
  const address = text.address(order);
  const pickup = `${branchName} · ${branch?.zoneLabel ?? ''}`;

  // Bloqueado (cocina u otro motivo): aviso informativo, sin ninguna acción de despacho.
  if (block) {
    return (
      <Modal
        open
        zone="bo"
        iconTone="blue"
        icon={<IconBike />}
        title={t('title')}
        description={`#${order.id}`}
        onClose={onClose}
        footer={
          <>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              {t('cancel')}
            </button>
          </>
        }
      >
        <Banner zone="bo" tone="warning" role="status">
          {t(`blocked.${block}`)}
        </Banner>
      </Modal>
    );
  }

  return (
    <Modal
      open
      zone="bo"
      iconTone="blue"
      icon={<IconBike />}
      title={title}
      description={
        <>
          #{order.id} · {subtitle} <SimulationBadge kind="simulation" zone="bo" />
        </>
      }
      onClose={onClose}
      footer={
        <>
          {step !== 'choose' ? (
            <button type="button" className="btn btn-ghost" onClick={back} disabled={sending}>
              <IconChevronLeft size="sm" />
              {t('back')}
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          {isQuoteStep ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={step === 'loading' || !quote || sending}
              onClick={confirmPedidosYa}
            >
              {t('confirm')}
            </button>
          ) : null}
          {step === 'own' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!riderId || sending}
              onClick={assignOwn}
            >
              {t('assign')}
            </button>
          ) : null}
        </>
      }
    >
      {failedBefore && step === 'choose' ? (
        <Banner zone="bo" tone="warning" role="status">
          {t('failedBefore')}
        </Banner>
      ) : null}

      {step === 'choose' ? (
        <>
          <div className="opt-grid" role="group" aria-label={t('optionsLabel')}>
            <button type="button" className="opt" onClick={requestQuote}>
              <span
                className="opt-ic"
                style={{ background: 'var(--bo-secondary-soft)', color: 'var(--bo-text)' }}
              >
                <IconBike size="sm" />
              </span>
              <span className="opt-t">{t('pyOption')}</span>
              <span className="opt-d">{t('pyOptionText')}</span>
              <span className="opt-f">
                {t('pyOptionHint', { fee: formatMoney(order.deliveryFee) })}
              </span>
            </button>
            <button
              type="button"
              className="opt"
              disabled={available === 0}
              onClick={() => {
                setRiderId(null);
                setStep('own');
              }}
            >
              <span
                className="opt-ic"
                style={{ background: 'var(--bo-primary-soft)', color: 'var(--bo-primary)' }}
              >
                <IconShop size="sm" />
              </span>
              <span className="opt-t">{t('ownOption')}</span>
              <span className="opt-d">{t('ownOptionText')}</span>
              <span className="opt-f">
                {available > 0
                  ? t('ownAvailable', { count: available, branch: branchName })
                  : t('ownNone', { branch: branchName })}
              </span>
            </button>
          </div>
          <div className="sm" style={{ fontWeight: 600 }}>
            <b>{t('pickupAt')}</b> {pickup} · <b>{t('deliverTo')}</b> {order.customer.name},{' '}
            {address}
          </div>
        </>
      ) : null}

      {step === 'own' ? (
        <>
          <div className="sm" style={{ fontWeight: 600 }}>
            {t('ownHelp')}
          </div>
          <div className="reasons" role="radiogroup" aria-label={t('ridersLabel')}>
            {options.map(({ rider, state, available: ok }) => {
              const selected = riderId === rider.id;
              return (
                <button
                  key={rider.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!ok}
                  className={cn('ckb', selected && 'on')}
                  style={{ minHeight: 60 }}
                  onClick={() => setRiderId(rider.id)}
                >
                  <span className="box" style={{ borderRadius: '50%' }}>
                    {selected ? <IconCheck size="sm" style={{ strokeWidth: 3 }} /> : null}
                  </span>
                  <span className="grow">
                    <span className="strong" style={{ display: 'block', fontSize: 14 }}>
                      {rider.name}
                    </span>
                    <span className="xs muted" style={{ display: 'block', fontWeight: 600 }}>
                      {rider.vehicle} · {rider.phone}
                    </span>
                  </span>
                  <Pill zone="bo" tone={RIDER_TONE[state]}>
                    {riderStateLabel(t, state)}
                  </Pill>
                </button>
              );
            })}
          </div>
          <div className="info-list">
            <div className="info-row">
              <IconMapPin size="sm" />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {t('deliverLabel')}
                </div>
                <div className="strong">{order.customer.name}</div>
                <div className="sm" style={{ fontWeight: 600 }}>
                  {address}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {isQuoteStep ? (
        <>
          {step === 'loading' ? (
            <Banner
              zone="bo"
              tone="info"
              role="status"
              icon={<span className="spinner" aria-hidden="true" />}
            >
              {t('loading')}
            </Banner>
          ) : null}
          {quoteError ? (
            <Banner zone="bo" tone="danger" role="alert" icon={<IconAlert size="sm" />}>
              {t('quoteError', { message: quoteError })}{' '}
              <button type="button" className="link-btn" onClick={requestQuote}>
                {t('retry')}
              </button>
              {available > 0 ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      back();
                      setStep('own');
                    }}
                  >
                    {t('offerOwn')}
                  </button>
                </>
              ) : null}
            </Banner>
          ) : null}
          {dispatchError ? (
            <Banner zone="bo" tone="danger" role="alert">
              {dispatchError}
            </Banner>
          ) : null}
          {comparison?.changed ? (
            <>
              <Banner zone="bo" tone="warning" role="status">
                {t('changed')}
              </Banner>
              <div className="cmp">
                <div>
                  <span className="xs muted" style={{ fontWeight: 700 }}>
                    {t('quotedToCustomer')}
                  </span>
                  <b className="num">{formatMoney(comparison.quoted)}</b>
                </div>
                <div>
                  <span className="xs muted" style={{ fontWeight: 700 }}>
                    {t('currentCost')}
                  </span>
                  <b className="num">{formatMoney(comparison.current)}</b>
                </div>
                <div>
                  <span className="xs" style={{ fontWeight: 700 }}>
                    {t('difference')}
                  </span>
                  <b className="num">
                    {comparison.diff > 0 ? '+' : ''}
                    {formatMoney(comparison.diff)}
                  </b>
                </div>
              </div>
              <div className="sm" style={{ fontWeight: 600 }}>
                {t('confirmHelp')}
              </div>
            </>
          ) : null}
          {comparison && !comparison.changed ? (
            <Banner zone="bo" tone="success" role="status">
              {t('same', { cost: formatMoney(comparison.current) })}
            </Banner>
          ) : null}
          <div className="info-list">
            <div className="info-row">
              <IconStore size="sm" />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {t('pickupLabel')}
                </div>
                <div className="strong">{pickup}</div>
              </div>
            </div>
            <div className="info-row">
              <IconMapPin size="sm" />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {t('deliverLabel')}
                </div>
                <div className="strong">{order.customer.name}</div>
                <div className="sm" style={{ fontWeight: 600 }}>
                  {address}
                </div>
              </div>
            </div>
            <div className="info-row">
              <IconClock size="sm" />
              <div>
                <div className="muted xs" style={{ fontWeight: 700 }}>
                  {t('arrival')}
                </div>
                <div style={{ fontWeight: 600 }}>
                  {quote
                    ? t('etaRange', { min: quote.etaMinMinutes, max: quote.etaMaxMinutes })
                    : t('arrivalText')}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function riderStateLabel(t: ReturnType<typeof useTranslations>, state: RiderState) {
  return state === 'free' ? t('riderFree') : state === 'busy' ? t('riderBusy') : t('riderOff');
}

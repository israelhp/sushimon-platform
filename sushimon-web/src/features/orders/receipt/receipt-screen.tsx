'use client';

import { ArrowLeft, Printer, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { moneyToCents } from '@/lib/checkout-quote';
import type { OrderReceipt } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { readGuestToken } from '@/features/checkout/confirmation-store';
import { PaymentStatus } from '@/features/payments/PaymentStatus';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { PublicStatusChip } from '../components/public-status-chip';
import { useIsSimulation } from '../hooks';
import { previewErrorKind } from '../reorder/reorder-model';
import { useOrderReceipt } from '../use-order-receipt';

/** Estados en los que el recibo lleva un aviso propio: sin motivo (privado) y sin afirmar pago (P76). */
const NEGATIVE: readonly OrderReceipt['status'][] = ['rejected', 'cancelled'];

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('receipt-row border-t border-line py-3', className)}>
      <h2 className="m-0 mb-1.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'text-[18px] font-extrabold')}>
      <dt className={cn(!strong && 'text-muted')}>{label}</dt>
      <dd className="m-0 text-right">{children}</dd>
    </div>
  );
}

/**
 * F23 (spec 024 §9.3) — Recibo NO fiscal imprimible. Se arma SOLO con `OrderReceipt` (snapshots del pedido: nunca del carrito ni
 * del listado ni recalculado desde el catálogo). Sin librería PDF ni servicios de terceros: «Imprimir / guardar como PDF» llama a
 * `window.print()` (solo desde el botón). Sin ids internos, tokens, correo ni teléfono completo (viene enmascarado), sin factura
 * fiscal (sin NIT/FEL/SAT), pago honesto («Sin pago registrado»), fechas en America/Guatemala y moneda GTQ. Sin escrituras en
 * `localStorage`/`sessionStorage`, sin `Blob` ni descargas. Un fallo HTTP nunca se presenta como estado del pedido.
 */
export function ReceiptScreen({ orderId }: { orderId: string }) {
  const t = useTranslations('receipt');
  const locale = useLocale();
  const simulation = useIsSimulation();
  const token = readGuestToken(orderId);
  const receipt = useOrderReceipt(orderId, token);
  const data = receipt.data;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);

  // `document.title = Recibo MON-001042` (nombre sugerido al guardar como PDF); se restaura al salir.
  const number = data?.displayNumber;
  useEffect(() => {
    if (!number) return;
    const previous = document.title;
    document.title = t('documentTitle', { a: number });
    return () => {
      document.title = previous;
    };
  }, [number, t]);

  useEffect(() => {
    if (data && !focused.current) {
      focused.current = true;
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [data]);

  const back = (
    <Link
      href={`/pedidos/${orderId}`}
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-secondary no-underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('back')}
    </Link>
  );

  if (
    receipt.noCredentials ||
    (receipt.isError && previewErrorKind(receipt.error).kind === 'denied')
  ) {
    return (
      <div
        className="wrap receipt-page max-w-[760px] pb-12 pt-6 sm:pt-10"
        data-testid="receipt-lost"
      >
        <h1 className="disp mb-3 text-[24px]">{t('lostTitle')}</h1>
        <div role="alert" className="notice notice-warn">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{t('lostBody')}</p>
        </div>
        <div className="mt-3">{back}</div>
      </div>
    );
  }

  if (receipt.isError) {
    const failure = previewErrorKind(receipt.error);
    return (
      <div className="wrap receipt-page max-w-[760px] pb-12 pt-6 sm:pt-10">
        <div className="mb-3">{back}</div>
        <ErrorNotice
          key={receipt.errorUpdatedAt}
          message={t(`error.${failure.kind}`)}
          cooldownSec={failure.retryAfterSec}
          onRetry={() => void receipt.refetch()}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('loading')}
        className="wrap receipt-page max-w-[760px] pb-12 pt-6 sm:pt-10"
      >
        <Skeleton className="h-10 w-56" />
        <Skeleton className="mt-5 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const money = (value: string) => formatMoney((moneyToCents(value) ?? 0) / 100, locale);
  const delivery = data.fulfillment.type === 'DELIVERY';
  const discount = (moneyToCents(data.discountTotal) ?? 0) > 0;
  const extras = (moneyToCents(data.extrasTotal) ?? 0) > 0;
  const negative = NEGATIVE.includes(data.status);

  return (
    <div className="wrap receipt-page max-w-[820px] pb-12 pt-5 sm:pt-8" data-testid="receipt-page">
      <div data-print-hide className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          {simulation ? <SimulationBadge kind="simulation" /> : null}
          <button
            type="button"
            className="btn btn-primary !min-h-[44px]"
            data-testid="print-receipt"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> {t('print')}
          </button>
        </div>
      </div>
      <p data-print-hide className="m-0 mb-3 text-[13px] text-muted">
        {t('printHint')}
      </p>

      <article
        className="receipt rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8"
        aria-labelledby="receipt-title"
        data-testid="receipt"
        data-fiscal={data.fiscalStatus}
      >
        <div className="receipt-row mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-display text-[22px]">{t('brand')}</p>
            <p className="m-0 text-[14px] font-bold">{data.branch.name}</p>
            <p className="m-0 text-[13px] text-muted">{data.branch.address}</p>
            {data.branch.phone ? (
              <p className="m-0 text-[13px] text-muted">
                {t('phone')}: {data.branch.phone}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="m-0 text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
              {t('title')}
            </p>
            <h1
              id="receipt-title"
              ref={titleRef}
              tabIndex={-1}
              className="disp text-[clamp(26px,5vw,34px)] outline-none"
              data-testid="receipt-number"
            >
              {data.displayNumber}
            </h1>
            <p className="m-0 text-[13px] text-muted">
              {formatDateTime(data.placedAt, locale)} · {t('timeZone')}
            </p>
          </div>
        </div>

        <div className="receipt-row mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-muted">{t('status')}:</span>
          <PublicStatusChip
            publicStatus={data.publicStatus}
            fulfillmentType={data.fulfillment.type}
            terminal={['delivered', 'picked_up', 'rejected', 'cancelled'].includes(data.status)}
          />
        </div>

        {negative ? (
          <p
            className="receipt-row m-0 mb-3 rounded-xl border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[14px] font-bold"
            data-testid="receipt-negative"
          >
            {t(data.status === 'rejected' ? 'banner.rejected' : 'banner.cancelled')}{' '}
            {data.payment.status === 'PAID' ? t('payment.other') : t('banner.noPayment')}
          </p>
        ) : null}

        <Section title={t('delivery.title')}>
          <p className="m-0 font-bold">
            {delivery ? t('delivery.delivery') : t('delivery.pickup')}
          </p>
          {data.fulfillment.provider === 'OWN' ? (
            <p className="m-0 text-[13px] text-muted">{t('delivery.own')}</p>
          ) : data.fulfillment.provider === 'PEDIDOSYA' ? (
            <p className="m-0 text-[13px] text-muted">{t('delivery.pedidosya')}</p>
          ) : null}
          {data.address ? (
            <p className="m-0 mt-1">
              {data.address.addressLine}
              <span className="block text-[13px] text-muted">
                {data.address.municipalityName}
                {data.address.zone ? ` · ${data.address.zone}` : ''}
                {data.address.referenceNote
                  ? ` · ${t('delivery.reference')}: ${data.address.referenceNote}`
                  : ''}
              </span>
            </p>
          ) : null}
        </Section>

        <Section title={t('customer')}>
          <p className="m-0 font-bold">{data.contact.fullName}</p>
          <p className="m-0 text-[13px] text-muted">{data.contact.phoneMasked}</p>
        </Section>

        <Section title={t('lines')}>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {data.lines.map((line, i) => (
              <li
                key={`${line.productName}-${i}`}
                className="receipt-row flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="m-0 font-bold">
                    {line.quantity} × {line.productName}{' '}
                    <span className="font-normal text-muted">({money(line.unitPrice)})</span>
                  </p>
                  {line.modifiers.length > 0 ? (
                    <p className="m-0 text-[13px] text-muted">
                      {t('extras')}:{' '}
                      {line.modifiers.map((m) => `${m.name} (+${money(m.extraPrice)})`).join(', ')}
                    </p>
                  ) : null}
                  {line.notes ? (
                    <p className="m-0 text-[13px] text-muted">
                      {t('note')}: {line.notes}
                    </p>
                  ) : null}
                </div>
                <span className="flex-none font-bold">{money(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </Section>

        {data.promotions.length > 0 ? (
          <Section title={t('promotions')}>
            <ul className="m-0 list-none p-0">
              {data.promotions.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex justify-between gap-3">
                  <span>{p.name}</span>
                  <span>−{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {data.notes ? (
          <Section title={t('notes')}>
            <p className="m-0">{data.notes}</p>
          </Section>
        ) : null}

        <Section title={t('totals')}>
          <dl className="m-0 flex flex-col gap-1">
            <Row label={t('subtotal')}>
              {money(data.subtotal)}
              {extras ? (
                <span className="block text-[12px] font-normal text-muted">
                  {t('includesExtras', { a: money(data.extrasTotal) })}
                </span>
              ) : null}
            </Row>
            {discount ? <Row label={t('discount')}>−{money(data.discountTotal)}</Row> : null}
            {delivery ? <Row label={t('fee')}>{money(data.deliveryFee)}</Row> : null}
            <Row label={t('total')} strong>
              <span data-testid="receipt-total">{money(data.total)}</span>
            </Row>
          </dl>
        </Section>

        <Section title={t('payment.title')}>
          <div data-testid="receipt-payment">
            <PaymentStatus
              payment={data.payment}
              receipt={data.payment}
              closed={negative}
              fulfillmentType={data.fulfillment.type}
            />
          </div>
        </Section>

        <p
          className="receipt-row receipt-legend m-0 mt-3 rounded-xl border border-line bg-subtle px-3.5 py-2.5 text-[13px] font-bold"
          data-testid="receipt-legend"
        >
          {t('notFiscal')}
        </p>
        <p className="m-0 mt-2 text-[12px] text-muted">
          {t('generatedAt', { a: formatDateTime(data.generatedAt, locale) })}
        </p>
      </article>
    </div>
  );
}

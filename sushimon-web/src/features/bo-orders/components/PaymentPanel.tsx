'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { AdminOrderDetail, AdminOrderPaymentSummary } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import { localDate, localTime } from '@/lib/time';
import { blockedKey } from '../cash-payment-model';
import { useAdminOrderPayment, useAdminOrderPaymentHistory } from '../payment-hooks';
import { CashPaymentModal } from './CashPaymentModal';
import { PaymentBadge } from './PaymentBadge';

const money = (value: string) => formatMoney(Number(value));
const stamp = (iso: string) => `${localDate(new Date(iso))} ${localTime(new Date(iso))}`;

/**
 * F24 (spec 025 §12.2) — Panel «Pago» del detalle del pedido (F22). Efectivo, estado `PENDING|PAID` (independiente del estado del
 * pedido), total, pendiente y, con `PAID`, la recepción. La acción «Registrar pago en efectivo» aparece SOLO si el servidor la
 * permite (`registration.allowed`); si no, se explica el motivo. Un pago `PAID` es de solo lectura (no hay anulación ni reembolso).
 */
export function PaymentPanel({ order }: { order: AdminOrderDetail }) {
  const t = useTranslations('backoffice.orders.live.payment');
  const { grants } = useShell();
  const client = useDataClient();
  const canRead = can(grants, 'payments.read', order.branchId);
  const query = useAdminOrderPayment(order.id, canRead);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const summary: AdminOrderPaymentSummary = order.payment;
  // El pago completo solo reemplaza al resumen del detalle si no es MÁS VIEJO (PAID jamás vuelve a PENDING).
  const full =
    query.data && !(summary.status === 'PAID' && query.data.status !== 'PAID') ? query.data : null;
  const current: AdminOrderPaymentSummary = full ?? summary;
  const reception = full?.reception ?? null;
  const paid = current.status === 'PAID';
  // El historial solo se pide si el pago ya está cobrado o la persona expande la sección.
  const history = useAdminOrderPaymentHistory(order.id, canRead && (paid || historyOpen));
  const finished = order.status === 'delivered' || order.status === 'picked_up';
  const blocked = blockedKey(current.registration.blockedReason);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="bo-payment-title"
      data-testid="payment-panel"
      className="outline-none"
    >
      <div className="sect-t" id="bo-payment-title">
        {t('title')}{' '}
        {client.kind === 'mock' ? <SimulationBadge kind="simulation" zone="bo" /> : null}
      </div>

      {current.possibleRefundReview ? (
        <Banner zone="bo" tone="warning" role="status">
          {t('refundReview')}
        </Banner>
      ) : null}
      {!paid && finished ? (
        <Banner zone="bo" tone="info" role="status">
          {t('deliveredPending')}
        </Banner>
      ) : null}

      <div className="info-list">
        <div className="info-row">
          <div className="grow">
            <div className="strong">{t('cash')}</div>
            <div className="muted sm" style={{ fontWeight: 600 }}>
              {t('order', { code: order.displayNumber })}
            </div>
          </div>
          <PaymentBadge status={current.status} />
        </div>
        <div className="totals">
          <div className="tline">
            <span>{t('amountDue')}</span>
            <span className="num" data-testid="payment-due">
              {money(current.amountDue)}
            </span>
          </div>
          <div className="tline">
            <span>{t('outstanding')}</span>
            <span className="num" data-testid="payment-outstanding">
              {money(current.outstanding)}
            </span>
          </div>
          {paid && reception ? (
            <>
              <div className="tline">
                <span>{t('tendered')}</span>
                <span className="num" data-testid="payment-tendered">
                  {money(reception.tendered)}
                </span>
              </div>
              <div className="tline">
                <span>{t('change')}</span>
                <span className="num" data-testid="payment-change">
                  {money(reception.change)}
                </span>
              </div>
            </>
          ) : null}
        </div>
        {paid ? (
          <div className="muted sm" style={{ fontWeight: 600 }}>
            {current.paidAt ? t('paidAt', { when: stamp(current.paidAt) }) : null}
            {reception?.collectorName
              ? ` · ${t('collector', { name: reception.collectorName })}`
              : ''}
            {reception ? ` · ${t(`context.${reception.context}`)}` : ''}
          </div>
        ) : null}
      </div>

      {canRead && query.isError && !full ? (
        <Banner zone="bo" tone="warning" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="link-btn" onClick={() => void query.refetch()}>
            {t('retry')}
          </button>
        </Banner>
      ) : canRead && query.isPending ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton zone="bo" style={{ height: 20, borderRadius: 8 }} />
        </div>
      ) : null}

      {current.registration.allowed && !paid ? (
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 8 }}
          onClick={() => setOpen(true)}
        >
          {t('register')}
        </button>
      ) : !paid ? (
        <div className="muted sm" style={{ fontWeight: 600, marginTop: 8 }}>
          {t(`blocked.${blocked}`)}
        </div>
      ) : (
        <div className="muted sm" style={{ fontWeight: 600, marginTop: 8 }}>
          {t('readOnly')}
        </div>
      )}

      {canRead ? (
        <details style={{ marginTop: 8 }} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
          <summary className="sm" style={{ fontWeight: 700, cursor: 'pointer' }}>
            {t('history.title')}
          </summary>
          {history.data ? (
            history.data.items.length > 0 ? (
              <div className="hist">
                {history.data.items.map((e) => (
                  <div key={e.seq}>
                    <span className="num strong">{stamp(e.at)}</span>
                    <span>
                      {t(
                        `history.event.${e.type === 'CASH_RECEIVED' ? 'CASH_RECEIVED' : 'CREATED'}`,
                      )}
                      {e.actorName ? ` · ${t('history.by', { name: e.actorName })}` : ''}
                      {e.tendered && e.change
                        ? ` · ${t('history.amounts', { tendered: money(e.tendered), change: money(e.change) })}`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="xs muted">{t('history.empty')}</div>
            )
          ) : history.isError ? (
            <div className="xs muted" role="alert">
              {t('history.error')}
            </div>
          ) : (
            <div className="xs muted">{t('loading')}</div>
          )}
        </details>
      ) : null}

      {open ? (
        <CashPaymentModal
          payment={{
            orderId: order.id,
            amountDue: current.amountDue,
            outstanding: current.outstanding,
          }}
          code={order.displayNumber}
          onClose={() => {
            setOpen(false);
            // Si el botón que abrió el modal ya no existe (se cobró), el foco va al panel y no cae al body.
            setTimeout(() => {
              const active = document.activeElement;
              if (!active || active === document.body) sectionRef.current?.focus();
            }, 0);
          }}
        />
      ) : null}
    </section>
  );
}

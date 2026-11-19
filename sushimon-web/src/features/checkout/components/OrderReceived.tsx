'use client';

import {
  Banknote,
  Check,
  ClipboardList,
  Copy,
  FileText,
  MapPin,
  Phone,
  RotateCcw,
  Store,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { moneyToCents } from '@/lib/checkout-quote';
import type { OrderDetail } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { usePublicBranches } from '@/features/branches/hooks';
import { ReorderDialog } from '@/features/orders/components/reorder-dialog';
import { PublicStatusChip } from '@/features/orders/components/public-status-chip';
import { isFinalStatus } from '@/features/orders/reorder/reorder-model';
import { publicStatusOf } from '@/features/tracking/tracking-model';
import { STORE_ROUTES } from '@/features/store-shell/nav';

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-subtle text-secondary"
        aria-hidden="true"
      >
        {icon}
      </span>
      <dt className="w-[34%] flex-none text-[13px] font-bold text-muted">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 break-words text-[15px] font-bold">{children}</dd>
    </div>
  );
}

/**
 * F20 — «Pedido recibido»: el pedido PERSISTIDO tal como lo devuelve la API (`OrderDetail`). Es honesto: dice «recibido», no
 * «aceptado» ni «pagado»; el método de pago es solo una PREFERENCIA y no se afirma ningún cobro. Número `MON-000000`, estado real
 * (`pending`), líneas con extras, importes, entrega/retiro y contacto ENMASCARADO tal cual lo entrega el servidor. No calcula
 * importes ni muestra línea de tiempo (seguimiento: F21). `simulated` rotula el pedido del adaptador mock.
 */
export function OrderReceived({
  order,
  simulated = false,
  focusTitle = true,
  unsaved = false,
}: {
  order: OrderDetail;
  simulated?: boolean;
  focusTitle?: boolean;
  /** `sessionStorage` no pudo guardar la credencial: avisa que se guarde el número (no se podrá reabrir tras recargar). */
  unsaved?: boolean;
}) {
  const t = useTranslations('orders.received');
  const tc = useTranslations('common');
  const to = useTranslations('orders');
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [reordering, setReordering] = useState(false);
  const locale = useLocale();
  const branches = usePublicBranches().data;
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Al llegar a la confirmación, el foco pasa al título para que los lectores de pantalla anuncien el resultado.
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);

  const money = (value: string) => formatMoney((moneyToCents(value) ?? 0) / 100, locale);
  const branch = branches?.find((b) => b.id === order.branchId)?.name;
  const delivery = order.fulfillmentType === 'DELIVERY';
  const payment =
    order.payment.methodPreference === 'cash'
      ? t('payCash')
      : order.payment.methodPreference === 'bank_transfer'
        ? t('payTransfer')
        : t('payNone');
  const discount = (moneyToCents(order.discountTotal) ?? 0) > 0;
  // F23: el mismo detalle sirve a la confirmación recién hecha (`pending`) y al historial: con otro estado no es «recién recibido».
  const fresh = order.status === 'pending';
  const finished = isFinalStatus(order.status);

  return (
    <div className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10" data-testid="order-received">
      <div className="mb-5 flex flex-col items-center gap-2 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success"
          aria-hidden="true"
        >
          <Check className="h-7 w-7" />
        </span>
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="disp text-[clamp(28px,6vw,42px)] outline-none"
          data-testid="order-received-title"
        >
          {fresh ? t('title') : t('detailTitle')}
        </h1>
        <p className="m-0 max-w-[520px] text-muted">{fresh ? t('intro') : t('detailIntro')}</p>
        {simulated ? <SimulationBadge kind="simulation" /> : null}
        <p className="m-0 mt-1 text-[13px] font-bold uppercase tracking-[0.12em] text-muted">
          {t('number')}
        </p>
        <p className="disp m-0 text-[clamp(26px,6vw,36px)]" data-testid="order-number">
          {order.displayNumber}
        </p>
        <button
          type="button"
          className="btn !min-h-[44px] text-sm"
          aria-label={t('copyAria', { a: order.displayNumber })}
          onClick={() => {
            navigator.clipboard?.writeText(order.displayNumber).then(
              () => setCopy('ok'),
              () => setCopy('fail'),
            ) ?? setCopy('fail');
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" /> {t('copy')}
        </button>
        <p
          role="status"
          className="m-0 min-h-[1.25rem] text-[13px] text-muted"
          data-testid="copy-status"
        >
          {copy === 'ok' ? t('copied') : copy === 'fail' ? t('copyFailed') : ''}
        </p>
        {fresh ? (
          <p
            className="m-0 text-[13px] font-bold"
            data-testid={unsaved ? 'unsaved-warning' : 'save-note'}
          >
            {unsaved ? t('unsaved') : t('saveNote')}
          </p>
        ) : null}
      </div>

      <section aria-label={t('sectionAria')} className="flex flex-col gap-4">
        <dl className="m-0 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <Fact icon={<ClipboardList className="h-4 w-4" />} label={t('status')}>
            <span data-testid="order-status" className="flex flex-col items-start gap-1">
              <PublicStatusChip
                publicStatus={publicStatusOf(order.status)}
                fulfillmentType={order.fulfillmentType}
                terminal={finished}
              />
              {order.status === 'pending' ? (
                <span className="text-[13px] font-normal text-muted">{t('statusPending')}</span>
              ) : null}
            </span>
          </Fact>
          {branch ? (
            <Fact icon={<Store className="h-4 w-4" />} label={t('branch')}>
              {branch}
            </Fact>
          ) : null}
          <Fact
            icon={delivery ? <Truck className="h-4 w-4" /> : <Store className="h-4 w-4" />}
            label={t('mode')}
          >
            {delivery ? t('delivery') : t('pickup')}
          </Fact>
          {order.address ? (
            <Fact icon={<MapPin className="h-4 w-4" />} label={t('address')}>
              {order.address.addressLine}
              <span className="block text-[13px] font-normal text-muted">
                {order.address.municipalityName}
                {order.address.zone ? ` · ${order.address.zone}` : ''}
                {order.address.referenceNote
                  ? ` · ${t('reference')}: ${order.address.referenceNote}`
                  : ''}
              </span>
            </Fact>
          ) : null}
          <Fact icon={<Phone className="h-4 w-4" />} label={t('contact')}>
            {order.contact.fullName}
            <span className="block text-[13px] font-normal text-muted">
              {order.contact.phoneMasked}
            </span>
          </Fact>
          <Fact icon={<Banknote className="h-4 w-4" />} label={t('payment')}>
            {payment}
            <span className="block text-[13px] font-normal text-muted">{t('payNote')}</span>
          </Fact>
        </dl>

        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h2 className="lbl">{t('products')}</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {order.lines.map((line, i) => (
              <li
                key={`${line.productName}-${i}`}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="m-0 font-bold">
                    {line.quantity} × {line.productName}
                  </p>
                  {line.modifiers.length > 0 ? (
                    <p className="m-0 text-[13px] text-muted">
                      {t('extras')}: {line.modifiers.map((m) => m.name).join(', ')}
                    </p>
                  ) : null}
                  {line.notes ? <p className="m-0 text-[13px] text-muted">{line.notes}</p> : null}
                </div>
                <span className="flex-none font-bold">{money(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="m-0 mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-[15px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('subtotal')}</dt>
              <dd className="m-0">{money(order.subtotal)}</dd>
            </div>
            {discount ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">
                  {t('discount')}
                  {order.promotions.length
                    ? ` (${order.promotions.map((p) => p.name).join(', ')})`
                    : ''}
                </dt>
                <dd className="m-0">−{money(order.discountTotal)}</dd>
              </div>
            ) : null}
            {delivery ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('fee')}</dt>
                <dd className="m-0">{money(order.deliveryFee)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 text-[18px] font-extrabold">
              <dt>{t('total')}</dt>
              <dd className="m-0" data-testid="order-total">
                {money(order.total)}
              </dd>
            </div>
          </dl>
          {order.notes ? (
            <p className="m-0 mt-3 text-[13px] text-muted">
              {t('notes')}: {order.notes}
            </p>
          ) : null}
        </div>

        {unsaved || !fresh ? null : (
          <p className="m-0 text-center text-[13px] text-muted">{t('keepTab')}</p>
        )}
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
          {/* F21: el seguimiento vive en su propia ruta (el token de invitado sigue en `sessionStorage`, nunca en la URL). */}
          <Link
            href={`/pedidos/${order.id}/seguimiento`}
            className={`btn w-full no-underline sm:w-auto ${finished ? '' : 'btn-primary'}`}
            data-testid="view-tracking"
          >
            {t('viewTracking')}
          </Link>
          {/* F23: recibo NO fiscal imprimible y «Volver a pedir» (vista previa contra el catálogo vigente; no crea pedidos). */}
          <Link
            href={`/pedidos/${order.id}/recibo`}
            className="btn w-full no-underline sm:w-auto"
            data-testid="view-receipt"
          >
            <FileText className="h-4 w-4" aria-hidden="true" /> {t('viewReceipt')}
          </Link>
          <button
            type="button"
            className={`btn w-full sm:w-auto ${finished ? 'btn-primary' : ''}`}
            data-testid="reorder"
            onClick={() => setReordering(true)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> {to('again')}
          </button>
          <Link href={STORE_ROUTES.menu} className="btn w-full no-underline sm:w-auto">
            {tc('goMenu')}
          </Link>
        </div>
      </section>
      {reordering ? (
        <ReorderDialog
          orderId={order.id}
          displayNumber={order.displayNumber}
          inProgress={!finished}
          onClose={() => setReordering(false)}
        />
      ) : null}
    </div>
  );
}

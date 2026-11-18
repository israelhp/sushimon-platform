'use client';

import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { isApiError } from '@/lib/data-access/errors';
import type { Incident, DraftOrder } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCreateIncident, useOrder } from '@/features/orders/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useIncidentOrders } from '@/features/tracking/hooks';
import { lookupHref } from '@/features/tracking/components/order-detail';
import { arrangeIncidentOrders, openIncidents } from '../orders';
import {
  DESCRIPTION_MAX,
  EMPTY_INCIDENT_DRAFT,
  INCIDENT_RESOLUTIONS,
  INCIDENT_TYPES,
  TYPES_REQUIRING_ITEMS,
  firstInvalidField,
  toIncidentRequest,
  validateIncident,
  type IncidentDraft,
  type IncidentField,
} from '../validation';

const OPTION =
  'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2 text-[15px] font-bold has-[:checked]:border-primary has-[:checked]:bg-primary-soft';

function Group({
  id,
  legend,
  error,
  children,
}: {
  id: string;
  legend: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      className="m-0 min-w-0 border-0 p-0"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="lbl">{legend}</legend>
      <div className="grid gap-2">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="err" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Paso previo: elegir el pedido (mis pedidos / otro pedido por número + teléfono). */
function OrderPicker() {
  const t = useTranslations('incidents');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const source = useIncidentOrders();
  const orders = arrangeIncidentOrders(source.orders, null);
  return (
    <div>
      <p className="m-0 mb-3 font-extrabold">{t('myOrdersPick')}</p>
      {source.isPending ? (
        <div role="status" aria-busy="true" aria-label={tu('loading')}>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : source.isError ? (
        <ErrorNotice onRetry={source.refetch} />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/incidencias/nuevo?pedido=${encodeURIComponent(order.id)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-fg no-underline hover:bg-subtle"
              >
                <span className="font-extrabold">{order.id}</span>
                <span className="text-[13px] text-muted">
                  {formatDateTime(order.createdAt, locale)} · {formatMoney(order.total, locale)}
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/consultar?next=incidencia"
              className="flex items-center rounded-xl border border-dashed border-line px-3.5 py-3 font-bold text-secondary no-underline hover:bg-subtle"
            >
              {t('otherOrder')}
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}

function Confirmation({ incident, order }: { incident: Incident; order: DraftOrder }) {
  const t = useTranslations('incidents');
  return (
    <div
      role="status"
      className="rounded-2xl border border-success/40 bg-success-soft p-5 shadow-card"
    >
      <CircleCheck className="h-8 w-8 text-success" aria-hidden="true" />
      <h2 className="disp mt-2 text-[24px]">{t('successTitle')}</h2>
      <p className="m-0 mt-2 text-[14px]">
        {t('ticket')}: <strong>{incident.id}</strong>
      </p>
      <p className="m-0 mt-2 text-[14px]">{t('successText')}</p>
      <Link
        href={`/pedidos/${order.id}`}
        className="btn btn-primary mt-4 w-full no-underline sm:w-auto"
      >
        {t('viewOrder')}
      </Link>
    </div>
  );
}

function ReportForm({ order }: { order: DraftOrder }) {
  const t = useTranslations('incidents');
  const tcom = useTranslations('common');
  const create = useCreateIncident();
  const [draft, setDraft] = useState<IncidentDraft>(EMPTY_INCIDENT_DRAFT);
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<Incident | null>(null);

  const errors = submitted ? validateIncident(draft) : {};
  const open = openIncidents(order);
  const products = [...new Map(order.lines.map((l) => [l.productId, l.name])).entries()];
  const itemsRequired = !!draft.type && TYPES_REQUIRING_ITEMS.includes(draft.type);

  const focusField = (field: IncidentField) => {
    const target =
      field === 'description'
        ? document.getElementById('inc-description')
        : document.querySelector<HTMLElement>(`[data-field="${field}"] input`);
    target?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    create.reset();
    const found = validateIncident(draft);
    const invalid = firstInvalidField(found);
    if (invalid) {
      focusField(invalid);
      return;
    }
    create.mutate(toIncidentRequest(order.id, draft), { onSuccess: setCreated });
  };

  if (created) return <Confirmation incident={created} order={order} />;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-5 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <p className="m-0 text-[15px]">
        <span className="text-muted">{t('whichOrder')}</span> <strong>{order.id}</strong>
      </p>
      {open.length > 0 ? (
        <div role="status" className="notice">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>{t('openAlready', { a: open.map((i) => i.id).join(', ') })}</div>
        </div>
      ) : null}

      <div data-field="type">
        <Group id="inc-type" legend={t('whatHappened')} error={errors.type && t(errors.type)}>
          {INCIDENT_TYPES.map((type) => (
            <label key={type} className={OPTION}>
              <input
                type="radio"
                name="inc-type"
                value={type}
                checked={draft.type === type}
                onChange={() => setDraft((d) => ({ ...d, type }))}
              />
              {t(`types.${type}`)}
            </label>
          ))}
        </Group>
      </div>

      <div data-field="items">
        <Group
          id="inc-items"
          legend={`${t('affected')}${itemsRequired ? '' : ` (${tcom('optional')})`}`}
          error={errors.items && t(errors.items)}
        >
          {products.map(([productId, name]) => (
            <label key={productId} className={OPTION}>
              <input
                type="checkbox"
                name="inc-items"
                value={productId}
                checked={draft.items.includes(productId)}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    items: e.target.checked
                      ? [...d.items, productId]
                      : d.items.filter((i) => i !== productId),
                  }))
                }
              />
              {name}
            </label>
          ))}
        </Group>
      </div>

      <div>
        <label className="lbl" htmlFor="inc-description">
          {t('description')}
        </label>
        <textarea
          id="inc-description"
          className="input min-h-[120px] resize-y"
          rows={4}
          maxLength={DESCRIPTION_MAX}
          placeholder={t('descriptionPh')}
          value={draft.description}
          aria-invalid={!!errors.description}
          aria-describedby={`inc-description-count${errors.description ? ' inc-description-error' : ''}`}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
        <p id="inc-description-count" className="m-0 mt-1 text-right text-[12px] text-muted">
          {draft.description.length}/{DESCRIPTION_MAX}
        </p>
        {errors.description ? (
          <p id="inc-description-error" className="err" role="alert">
            {t(errors.description)}
          </p>
        ) : null}
      </div>

      <div data-field="resolution">
        <Group
          id="inc-resolution"
          legend={t('resolution')}
          error={errors.resolution && t(errors.resolution)}
        >
          {INCIDENT_RESOLUTIONS.map((resolution) => (
            <label key={resolution} className={OPTION}>
              <input
                type="radio"
                name="inc-resolution"
                value={resolution}
                checked={draft.resolution === resolution}
                onChange={() => setDraft((d) => ({ ...d, resolution }))}
              />
              {t(`resolutions.${resolution}`)}
            </label>
          ))}
        </Group>
      </div>

      <p className="m-0 text-[14px] text-muted">
        {t('contact')} <strong className="text-fg">{order.customer.phone}</strong>
      </p>

      {create.isError ? (
        <div role="alert" className="notice notice-warn">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>{t('errSend')}</div>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={create.isPending}
        aria-busy={create.isPending}
        className="btn btn-primary w-full sm:w-auto"
      >
        {create.isPending ? (
          <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
        ) : null}
        {create.isPending ? t('sending') : t('submit')}
      </button>
    </form>
  );
}

/**
 * Reclamo en la app (`/incidencias/nuevo?pedido=`): tipo de problema, productos afectados, descripción con
 * límite, solución preferida y envío con `POST /v1/incidents`; confirma con el número de incidencia y avisa
 * si el pedido ya tiene una abierta. Complementa el reclamo por WhatsApp del prototipo. La API decide si el
 * pedido es de esta sesión (404 → consulta de invitado).
 */
export function IncidentForm({ orderId }: { orderId: string | null }) {
  const t = useTranslations('incidents');
  const tu = useTranslations('ui');
  const tt = useTranslations('tracking');
  const query = useOrder(orderId);
  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);

  return (
    <div className="wrap max-w-[720px] pb-12 pt-5 sm:pt-8">
      <h1 className="disp mb-1 text-[clamp(28px,6vw,44px)]">{t('titleLong')}</h1>
      <p className="m-0 mb-5 text-muted">{t('intro')}</p>
      {!orderId ? (
        <OrderPicker />
      ) : query.data ? (
        <ReportForm order={query.data} />
      ) : denied ? (
        <div role="alert" className="notice notice-warn">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>
            {tt('noAccess')}{' '}
            <Link href={lookupHref(orderId)} className="link-btn !min-h-0 text-sm">
              {t('otherOrder')}
            </Link>
          </div>
        </div>
      ) : query.isError ? (
        <ErrorNotice onRetry={() => void query.refetch()} />
      ) : (
        <div role="status" aria-busy="true" aria-label={tu('loading')}>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}

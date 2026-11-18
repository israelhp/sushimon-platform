'use client';

import { ArrowRight, Loader2, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { cn } from '@/lib/cn';
import { configKey, moneyToCents } from '@/lib/checkout-quote';
import { formatMoney } from '@/lib/format';
import type { CheckoutData } from '../use-checkout-data';
import { QuoteBreakdown } from './QuoteBreakdown';
import { blockedLineIndexes, quoteLineName, rowNamesByConfig } from './quote-helpers';

export interface SummaryAction {
  label: string;
  onClick: () => void;
  busy: boolean;
  /**
   * Bloqueado por la cotización, la carga o la confirmación no disponible: el botón queda `aria-disabled` (NO `disabled`: sigue
   * enfocable), su `onClick` lleva el foco al motivo y `reason` lo explica en una frase visible enlazada con `aria-describedby`.
   */
  blocked: boolean;
  reason: string;
  isLast: boolean;
  /** Rotula «Simulación» aunque los datos no sean del mock (Pago/Confirmación: F20 aún no existe). */
  showSimulation: boolean;
}

/**
 * "Resumen de compra": un solo carrito (F18), las líneas con su estado y el desglose del SERVIDOR (F19). Los importes salen de
 * la cotización vigente; mientras llega solo se ve el subtotal local rotulado «estimado». Con datos simulados lleva la insignia
 * «Simulación». El botón de acción solo se habilita según `action.disabled` (cotización vigente y `canProceed` desde «Envío»).
 */
export function OrderSummary({
  data,
  onEdit,
  action,
}: {
  data: CheckoutData;
  onEdit: () => void;
  action: SummaryAction;
}) {
  const t = useTranslations();
  const titleId = useId();
  const reasonId = useId();
  const locale = useLocale();
  const money = (value: number) => formatMoney(value, locale);
  const { rows, serverQuote: quote } = data;
  const names = rowNamesByConfig(rows);
  const blocked = quote ? blockedLineIndexes(quote) : new Set<number>();

  return (
    <section
      className="rounded-2xl border border-line bg-surface shadow-card"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 id={titleId} className="disp flex-1 text-[20px]">
          {t('checkout.summary')}
        </h2>
        {data.isSimulation || action.showSimulation ? <SimulationBadge kind="simulation" /> : null}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-secondary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('common.edit')}
        </button>
      </div>
      <ul className="m-0 list-none px-4 pt-2">
        {quote
          ? quote.lines.map((line, index) => {
              const cents = moneyToCents(line.lineTotal);
              const sent = data.quoteInputs?.cart.lines[index];
              const key = sent ? configKey(sent.productId, sent.selections) : '';
              const row = rows.find((r) => configKey(r.line.productId, r.line.selections) === key);
              return (
                <li
                  key={`${line.productId}-${index}`}
                  className="flex justify-between gap-3 border-b border-dashed border-line py-2 text-[14px] last:border-0"
                  data-line-status={line.status}
                >
                  <span className="min-w-0">
                    <strong>{line.quantity}×</strong> {quoteLineName(names, sent, line.productId)}
                    {row?.line.display.options.map((o) => (
                      <small
                        key={`${o.groupId}:${o.optionId}`}
                        className="block text-[12px] text-muted"
                      >
                        + {o.optionName}
                      </small>
                    ))}
                    {blocked.has(index) ? (
                      <small className="block text-[12px] font-bold text-danger">
                        {t('checkout.quote.lineUnavailable')}
                      </small>
                    ) : null}
                  </span>
                  <span className={cn('flex-none font-bold', cents === null && 'text-muted')}>
                    {cents === null ? '—' : money(cents / 100)}
                  </span>
                </li>
              );
            })
          : rows.map(({ line, name, subtotalCents }) => (
              <li
                key={line.lineId}
                className="flex justify-between gap-3 border-b border-dashed border-line py-2 text-[14px] last:border-0"
              >
                <span className="min-w-0">
                  <strong>{line.quantity}×</strong> {name}
                  {line.display.options.map((o) => (
                    <small
                      key={`${o.groupId}:${o.optionId}`}
                      className="block text-[12px] text-muted"
                    >
                      + {o.optionName}
                    </small>
                  ))}
                  {line.note ? (
                    <small className="block truncate text-[12px] text-muted" title={line.note}>
                      {line.note}
                    </small>
                  ) : null}
                </span>
                <span className="flex-none font-bold text-muted">{money(subtotalCents / 100)}</span>
              </li>
            ))}
      </ul>
      <QuoteBreakdown data={data} />
      {data.isSimulation ? (
        <p className="m-0 px-4 pb-3 text-[12px] leading-snug text-muted">
          {t('checkout.quote.simulation')}
        </p>
      ) : null}
      <div className="hidden px-4 pb-4 lg:block">
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.busy}
          aria-disabled={action.blocked || undefined}
          aria-describedby={action.blocked ? reasonId : undefined}
          aria-busy={action.busy}
          // `.btn[aria-disabled]` desactiva el puntero: aquí el clic debe llegar para llevar el foco al motivo.
          className="btn btn-primary w-full !pointer-events-auto"
        >
          {action.busy ? <Loader2 className="anim-spin h-5 w-5" aria-hidden="true" /> : null}
          {action.label}
          {!action.isLast && !action.busy ? (
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          ) : null}
        </button>
        {action.blocked ? (
          <p
            id={reasonId}
            tabIndex={-1}
            data-reason
            className="m-0 mt-2 text-[13px] leading-snug text-fg outline-none"
          >
            {action.reason}
          </p>
        ) : null}
      </div>
    </section>
  );
}

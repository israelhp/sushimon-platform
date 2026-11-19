'use client';

import { Check, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { OrderTracking } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import { buildPhaseViews, phaseTextKey } from '../tracking-model';

/**
 * F21 (spec 022 §9.4) — Fases del recorrido con las `steps` del SERVIDOR. Alcanzadas: con su hora REAL (America/Guatemala);
 * actual: destacada (`aria-current="step"`); superadas sin registro: sin hora; futuras: atenuadas, de borde punteado y SIN hora.
 * Rechazado/cancelado cortan el recorrido: no hay etapas futuras. El estado nunca depende solo del color (ícono + texto para
 * lectores de pantalla). No decide ni valida transiciones: presenta lo recibido.
 */
export function TrackingPhases({
  tracking,
}: {
  tracking: Pick<OrderTracking, 'steps' | 'publicStatus' | 'terminal' | 'fulfillmentType'>;
}) {
  const t = useTranslations('tracking');
  const locale = useLocale();
  const views = buildPhaseViews(tracking);
  if (views.length === 0) return null;
  return (
    <ol className="m-0 grid list-none gap-0 p-0" aria-label={t('phasesAria')} data-testid="phases">
      {views.map((view, index) => {
        const label = t(`phase.${phaseTextKey(view.phase, tracking.fulfillmentType)}`);
        const done = view.state === 'done';
        const current = view.state === 'current';
        const skipped = view.state === 'skipped';
        const stateText = done
          ? t('phaseDone')
          : current
            ? t('phaseCurrent')
            : skipped
              ? t('phaseSkipped')
              : t('phasePending');
        return (
          <li
            key={`${view.phase}-${index}`}
            aria-current={current ? 'step' : undefined}
            data-state={view.state}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {index < views.length - 1 ? (
              <span
                className={cn(
                  'absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5',
                  done || skipped ? 'bg-success' : 'bg-line',
                )}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-extrabold',
                view.negative
                  ? 'bg-danger text-onprimary ring-4 ring-danger/20'
                  : done
                    ? 'bg-success text-ondeep'
                    : current
                      ? 'bg-primary text-onprimary ring-4 ring-primary/20'
                      : skipped
                        ? 'border border-success bg-surface text-success'
                        : 'border border-dashed border-line bg-surface text-muted',
              )}
              aria-hidden="true"
            >
              {done ? (
                <Check className="h-4 w-4" />
              ) : skipped ? (
                <Minus className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                'min-w-0 pt-1 text-[15px]',
                done || current ? 'font-extrabold text-fg' : 'text-muted',
              )}
            >
              {label}
              <span className="sr-only"> — {stateText}</span>
              {view.reachedAt ? (
                <time
                  dateTime={view.reachedAt}
                  className="block text-[13px] font-normal text-muted"
                  data-testid="phase-time"
                >
                  {formatDateTime(view.reachedAt, locale)}
                </time>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

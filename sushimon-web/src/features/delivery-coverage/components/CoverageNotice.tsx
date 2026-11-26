'use client';

import { Clock, TriangleAlert, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import type { AddressCoverageState } from '../hooks';
import { formatMoneyGtq, type CoverageOutcome } from '../summary';

/**
 * Resultado de cobertura para el cliente. Tres hechos distintos, nunca confundidos: confirmado (con la tarifa PROPIA que
 * devolvió el servidor), pendiente (PedidosYa no verificable: «no podemos confirmar», no «sin cobertura») y sin cobertura.
 * No muestra `integrationStatus` ni `reason` crudos. Sin cobertura solo informa (ADR-0036: no se ofrece recoger ni programar).
 */
export function CoverageNotice({
  state,
  outcome,
  branchName,
  municipalityUnavailable,
  onRetry,
}: {
  state: AddressCoverageState;
  outcome: CoverageOutcome | null;
  branchName: (branchId: string) => string;
  /** El departamento elegido no tiene municipios cargados todavía. */
  municipalityUnavailable?: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('coverage');
  if (municipalityUnavailable) {
    return (
      <p className="notice notice-info" role="status">
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        {t('onlyGuatemala')}
      </p>
    );
  }
  if (state === 'idle') return null;
  if (state === 'error') return <ErrorNotice onRetry={onRetry} message={t('error')} />;
  return (
    <div
      aria-live="polite"
      data-testid="coverage-notice"
      className="rounded-2xl border border-line bg-surface p-3.5 shadow-card"
    >
      {state === 'loading' || !outcome ? (
        <p className="m-0 flex items-center gap-2 text-sm font-bold text-muted">
          <Clock className="h-4 w-4" aria-hidden="true" /> {t('checking')}
        </p>
      ) : outcome.kind === 'confirmed' && outcome.provider === 'OWN' && outcome.fee !== null ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 flex items-start gap-2 text-sm font-bold">
            <Truck className="mt-0.5 h-4 w-4 flex-none text-secondary" aria-hidden="true" />
            {t('ownConfirmed', { branch: branchName(outcome.branchId) })}
          </p>
          <p className="m-0 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">{t('fee')}</span>
            <strong data-testid="coverage-fee">{formatMoneyGtq(outcome.fee)}</strong>
          </p>
        </div>
      ) : outcome.kind === 'confirmed' ? (
        <p className="m-0 flex flex-wrap items-start gap-2 text-sm font-bold">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{t('pyConfirmed')}</span>
          {outcome.simulated ? <SimulationBadge kind="simulation" /> : null}
        </p>
      ) : outcome.kind === 'pending' ? (
        <p className="m-0 flex items-start gap-2 text-sm font-bold">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          {t('pending')}
        </p>
      ) : (
        <p className="m-0 flex items-start gap-2 text-sm font-bold text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          {t('none')}
        </p>
      )}
    </div>
  );
}

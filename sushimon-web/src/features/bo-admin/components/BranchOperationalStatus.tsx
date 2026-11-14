'use client';

import { useTranslations } from 'next-intl';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { statusKind, type StatusKind } from '@/features/branch-schedule/availability-view';
import { useBranchAvailability } from '@/features/branch-schedule/hooks';
import { useAvailabilityText } from '@/features/branch-schedule/use-availability-text';
import type { AdminBranch } from '@/lib/data-access/models';

const TONE: Record<StatusKind, PillTone> = {
  open: 'success',
  closed: 'muted',
  closure: 'warning',
  notConfigured: 'info',
};

/**
 * Estado OPERATIVO de la sucursal, distinto del administrativo (`active`): abierta ahora, cerrada por horario, cierre
 * extraordinario o sin horario configurado, según `getBranchAvailability` (la calcula el servidor). Una sucursal inactiva
 * no tiene disponibilidad pública (404): se muestra solo «Inactiva».
 */
export function BranchOperationalStatus({ branch }: { branch: AdminBranch }) {
  const t = useTranslations('backoffice.branchSchedule.status');
  const text = useAvailabilityText();
  const availability = useBranchAvailability(branch.active ? branch.id : null);

  if (!branch.active) {
    return (
      <Pill zone="bo" tone="muted">
        {t('inactive')}
      </Pill>
    );
  }
  if (availability.isError) return <span className="sm muted">{t('error')}</span>;
  if (!availability.data) return <span className="sm muted">{t('loading')}</span>;
  const kind = statusKind(availability.data);
  return (
    <span className="row gap8" style={{ flexWrap: 'wrap' }}>
      <Pill zone="bo" tone={TONE[kind]}>
        {t(kind)}
      </Pill>
      <span className="xs muted" style={{ fontWeight: 700 }}>
        {text.detail(availability.data)}
      </span>
    </span>
  );
}

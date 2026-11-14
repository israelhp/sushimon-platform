'use client';

import { Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePublicBranches } from '@/features/branches/hooks';
import { useBranchesAvailability } from '../hooks';
import { useAvailabilityText } from '../use-availability-text';
import { AvailabilityBadge } from './AvailabilityBadge';
import { BranchHoursDisclosure } from './BranchHoursPanel';

/**
 * «Sucursales y horarios»: cada sucursal activa con su estado actual (del servidor) y el horario semanal real
 * desplegable. Usa la lista pública (F07) y `getBranchHours`/`getBranchAvailability` (F08); no calcula nada.
 */
export function PublicBranchesHours() {
  const t = useTranslations('branchSchedule');
  const tu = useTranslations('ui');
  const text = useAvailabilityText();
  const branches = usePublicBranches();
  const availability = useBranchesAvailability((branches.data ?? []).map((b) => b.id));

  return (
    <section aria-labelledby="branches-hours-title" className="mb-5">
      <h2 id="branches-hours-title" className="eyebrow mb-2 text-secondary">
        {t('branchesTitle')}
      </h2>
      {branches.isError ? (
        <p className="notice notice-warn" role="alert">
          {t('branchesError')}{' '}
          <button type="button" className="link-btn" onClick={() => void branches.refetch()}>
            {tu('retry')}
          </button>
        </p>
      ) : !branches.data ? (
        <Skeleton aria-hidden="true" className="h-24 w-full" />
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-2xl border border-line bg-surface p-0 shadow-card">
          {branches.data.map((b) => {
            const a = availability.byId[b.id];
            return (
              <li key={b.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
                    <Store className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold">{b.name}</span>
                      {a ? <AvailabilityBadge availability={a} /> : null}
                    </div>
                    <span className="block text-[13px] text-muted">{b.address}</span>
                    {a ? (
                      <span className="block text-[13px] text-muted">{text.detail(a)}</span>
                    ) : null}
                    <BranchHoursDisclosure branchId={b.id} name={b.name} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

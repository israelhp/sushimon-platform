'use client';

import { useTranslations } from 'next-intl';
import { IconBike, IconMapPin } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { formatLongDate } from '@/features/backoffice-shell/staff-display';
import { cn } from '@/lib/cn';
import { fromLocal } from '@/lib/time';
import {
  activeFilterCount,
  type CostFilter,
  type DeliveryFilters,
  type PeriodInfo,
  type ProviderFilter,
  type QuickRange,
  type SortKey,
  type StateFilter,
  type TimeFilter,
  type ZoneOption,
} from '../deliveries-view';
import { useDeliveryText } from '../use-delivery-text';
import { FilterSelect } from './FilterSelect';

const QUICK: readonly Exclude<QuickRange, 'custom'>[] = ['hoy', 'ayer', '7d', '30d', 'mes'];

export interface DeliveriesFiltersProps {
  period: PeriodInfo;
  periodLabel: string;
  range: QuickRange;
  onRange: (range: Exclude<QuickRange, 'custom'>) => void;
  onFrom: (iso: string) => void;
  onTo: (iso: string) => void;
  filters: DeliveryFilters;
  onFilters: (patch: Partial<DeliveryFilters>) => void;
  onClear: () => void;
  zones: readonly ZoneOption[];
  riders: readonly { name: string; count: number }[];
  total: number;
}

/** Tarjetas "Periodo" y "Filtros" de Entregas (periodo rápido, fechas, búsqueda, sucursal, repartidor, zona…). */
export function DeliveriesFilters({
  period,
  periodLabel,
  range,
  onRange,
  onFrom,
  onTo,
  filters,
  onFilters,
  onClear,
  zones,
  riders,
  total,
}: DeliveriesFiltersProps) {
  const t = useTranslations('backoffice.deliveries');
  const shell = useShell();
  const text = useDeliveryText();
  const count = activeFilterCount(filters);
  const seg = <T extends string>(
    title: string,
    value: T,
    onChange: (v: T) => void,
    options: [T, string][],
  ) => (
    <div className="field">
      <span className="flabel">{title}</span>
      <SegmentedControl
        zone="bo"
        label={title}
        value={value}
        onChange={onChange}
        options={options.map(([v, label]) => ({ value: v, label }))}
      />
    </div>
  );

  return (
    <>
      <section className="card">
        <div className="card-h">
          <div className="grow">
            <h2>{t('period.title')}</h2>
            <div className="muted sm" style={{ fontWeight: 600 }}>
              {periodLabel}
            </div>
          </div>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="toolbar">
            <SegmentedControl
              zone="bo"
              label={t('period.quickLabel')}
              value={range}
              onChange={(v) => v !== 'custom' && onRange(v)}
              options={QUICK.map((r) => ({ value: r, label: t(`period.quick.${r}`) }))}
            />
            <label className="row gap6 sm" style={{ fontWeight: 700 }}>
              {t('period.from')}{' '}
              <input
                className="inp"
                type="date"
                style={{ height: 40, width: 160 }}
                min={period.min}
                max={period.today}
                value={period.from}
                onChange={(e) => e.target.value && onFrom(e.target.value)}
              />
            </label>
            <label className="row gap6 sm" style={{ fontWeight: 700 }}>
              {t('period.to')}{' '}
              <input
                className="inp"
                type="date"
                style={{ height: 40, width: 160 }}
                min={period.min}
                max={period.today}
                value={period.to}
                onChange={(e) => e.target.value && onTo(e.target.value)}
              />
            </label>
          </div>
          {period.clipped ? (
            <Banner zone="bo" tone="warning" icon={null} role="status">
              {t('period.clipped', {
                min: formatLongDate(fromLocal(period.min, '12:00')),
              })}
            </Banner>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>{t('filters.title')}</h2>
          {count > 0 ? (
            <>
              <span className="count-chip">{t('filters.active', { count })}</span>
              <button type="button" className="link-btn" onClick={onClear}>
                {t('filters.clear')}
              </button>
            </>
          ) : null}
        </div>
        <div className="card-b hfilters">
          <div className="field">
            <span className="flabel">{t('filters.search')}</span>
            <SearchInput
              zone="bo"
              wrapperClassName="w-full"
              value={filters.query}
              onValueChange={(query) => onFilters({ query })}
              label={t('filters.searchLabel')}
              placeholder={t('filters.searchPlaceholder')}
            />
          </div>
          <div className="field">
            <span className="flabel">{t('filters.branch')}</span>
            <div className="chips" role="group" aria-label={t('filters.branchLabel')}>
              <button
                type="button"
                className={cn('chip', !shell.branchId && 'on')}
                aria-pressed={!shell.branchId}
                disabled={shell.branchLocked && !!shell.branchId}
                onClick={() => shell.setBranchId(undefined)}
              >
                {t('filters.branchAll')}
              </button>
              {shell.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn('chip', shell.branchId === b.id && 'on')}
                  aria-pressed={shell.branchId === b.id}
                  disabled={shell.branchLocked && shell.branchId !== b.id}
                  onClick={() => shell.setBranchId(b.id)}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="flabel">{t('filters.rider')}</span>
            <FilterSelect
              label={t('filters.rider')}
              icon={<IconBike size="sm" />}
              value={filters.rider}
              onChange={(rider) => onFilters({ rider })}
              options={[
                {
                  value: 'all',
                  label: t('filters.riderAll'),
                  sub: t('filters.riderCount', { count: total }),
                },
                ...riders.map((r) => ({
                  value: r.name,
                  label: r.name,
                  sub: t('filters.riderCount', { count: r.count }),
                })),
              ]}
            />
          </div>
          <div className="field">
            <span className="flabel">{t('filters.zone')}</span>
            <FilterSelect
              label={t('filters.zone')}
              icon={<IconMapPin size="sm" />}
              value={filters.zone}
              onChange={(zone) => onFilters({ zone })}
              options={[
                {
                  value: 'all',
                  label: t('filters.zoneAll'),
                  sub: t('filters.zoneCount', { count: total }),
                },
                ...zones.map((z) => ({
                  value: z.key,
                  label: text.zoneLabel(z.zoneNumber, z.municipality),
                  sub: t('filters.zoneCount', { count: z.count }),
                })),
              ]}
            />
          </div>
          {seg<ProviderFilter>(
            t('filters.provider'),
            filters.provider,
            (provider) => onFilters({ provider }),
            [
              ['todos', t('filters.providerAll')],
              ['pedidosya', t('filters.providerPedidosya')],
              ['own', t('filters.providerOwn')],
            ],
          )}
          {seg<StateFilter>(t('filters.state'), filters.state, (state) => onFilters({ state }), [
            ['todos', t('filters.stateAll')],
            ['sin', t('filters.stateSin')],
            ['proceso', t('filters.stateProceso')],
            ['entregado', t('filters.stateEntregado')],
            ['cancelado', t('filters.stateCancelado')],
          ])}
          {seg<TimeFilter>(t('filters.time'), filters.time, (time) => onFilters({ time }), [
            ['todos', t('filters.timeAll')],
            ['rapido', t('filters.timeRapido')],
            ['normal', t('filters.timeNormal')],
            ['lento', t('filters.timeLento')],
          ])}
          {seg<CostFilter>(t('filters.cost'), filters.cost, (cost) => onFilters({ cost }), [
            ['todos', t('filters.costAll')],
            ['dif', t('filters.costDif')],
            ['igual', t('filters.costIgual')],
          ])}
          {seg<SortKey>(t('filters.sort'), filters.sort, (sort) => onFilters({ sort }), [
            ['recientes', t('filters.sortRecientes')],
            ['antiguos', t('filters.sortAntiguos')],
            ['tiempo', t('filters.sortTiempo')],
            ['diferencia', t('filters.sortDiferencia')],
          ])}
        </div>
      </section>
    </>
  );
}

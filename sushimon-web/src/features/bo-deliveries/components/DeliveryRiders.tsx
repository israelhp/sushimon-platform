'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { IconBike, IconShop } from '@/components/icons/bo';
import { Pill } from '@/components/ui/Pill';
import { Switch } from '@/components/ui/Switch';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { DraftOrder, Rider } from '@/lib/data-access/models';
import type { PeriodRider } from '../deliveries-view';

/** "Repartidores del periodo": quién hizo cuántos envíos; tocar uno filtra la tabla por ese repartidor. */
export function PeriodRiders({
  riders,
  selected,
  onPick,
}: {
  riders: readonly PeriodRider[];
  selected: string;
  onPick: (name: string) => void;
}) {
  const t = useTranslations('backoffice.deliveries.riders');
  return (
    <section className="card">
      <div className="card-h">
        <div className="grow">
          <h2>{t('title')}</h2>
          <div className="muted sm" style={{ fontWeight: 600 }}>
            {t('sub')}
          </div>
        </div>
      </div>
      <div className="card-b">
        {riders.map((r) => {
          const active = selected === r.name;
          return (
            <div key={r.name} className="byb rider-row">
              <span className="row gap10">
                <span
                  className="avatar"
                  style={{
                    width: 32,
                    height: 32,
                    fontSize: 11,
                    background: 'var(--bo-secondary)',
                    color: 'var(--bo-on-secondary)',
                  }}
                >
                  <IconBike size="sm" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="strong trunc" style={{ display: 'block' }}>
                    {r.name}
                  </span>
                  <Pill
                    zone="bo"
                    tone={r.provider === 'own' ? 'confirmed' : 'info'}
                    style={{ height: 20, fontSize: 11, marginTop: 2 }}
                  >
                    {r.provider === 'own' ? t('providerOwn') : t('providerPedidosya')}
                  </Pill>
                </span>
              </span>
              <span className="hbar-track hide-sm">
                <span className="hbar-fill" style={{ width: `${r.width}%` }} />
              </span>
              <span className="num strong">{t('count', { count: r.count })}</span>
              <span className="num sm hide-sm" style={{ fontWeight: 600 }}>
                {r.avgMinutes != null ? t('avg', { minutes: r.avgMinutes }) : '—'}
              </span>
              <span style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className={cn('btn sm', active && 'btn-dark')}
                  aria-pressed={active}
                  onClick={() => onPick(r.name)}
                >
                  {active ? t('unfilter') : t('view')}
                </button>
              </span>
            </div>
          );
        })}
        {riders.length === 0 ? <div className="empty-mini">{t('empty')}</div> : null}
      </div>
    </section>
  );
}

const phoneHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/**
 * "Repartidores del restaurante": estado de hoy de cada repartidor propio (disponible, en ruta o fuera de turno),
 * el pedido que lleva y cuántos entregó hoy. El cambio de turno no tiene endpoint en el contrato todavía, por lo
 * que el interruptor es de solo lectura.
 */
export function OwnRiderCards({
  riders,
  todayOrders,
}: {
  riders: readonly Rider[];
  todayOrders: readonly DraftOrder[];
}) {
  const t = useTranslations('backoffice.deliveries.own');
  const { branchById } = useShell();
  const cards = useMemo(
    () =>
      riders.map((r) => {
        const mine = todayOrders.filter((o) => o.delivery?.riderId === r.id);
        const current = mine.find(
          (o) => o.delivery && o.delivery.status !== 'delivered' && o.delivery.status !== 'failed',
        );
        const done = mine.filter((o) => o.delivery?.status === 'delivered').length;
        return { rider: r, current, done };
      }),
    [riders, todayOrders],
  );
  return (
    <section className="card">
      <div className="card-h">
        <div className="grow">
          <h2>{t('title')}</h2>
          <div className="muted sm" style={{ fontWeight: 600 }}>
            {t('sub')}
          </div>
        </div>
      </div>
      <div className="card-b own-grid">
        {cards.map(({ rider, current, done }) => {
          const state = !rider.active ? 'off' : rider.busy ? 'busy' : 'free';
          return (
            <div key={rider.id} className="own-card">
              <div className="row gap10">
                <span
                  className="avatar"
                  style={{
                    width: 36,
                    height: 36,
                    background: 'var(--bo-primary-soft)',
                    color: 'var(--bo-primary)',
                  }}
                >
                  <IconShop size="sm" />
                </span>
                <div className="grow">
                  <div className="strong trunc">{rider.name}</div>
                  <div className="xs muted" style={{ fontWeight: 600 }}>
                    {branchById(rider.branchId)?.name ?? rider.branchId} · {rider.vehicle}
                  </div>
                </div>
                <Pill
                  zone="bo"
                  tone={state === 'off' ? 'muted' : state === 'busy' ? 'active' : 'success'}
                >
                  {t(state)}
                </Pill>
              </div>
              <div className="row gap8 sm" style={{ fontWeight: 600 }}>
                <span className="grow">
                  {current ? t('carrying', { id: current.id }) : rider.active ? t('noOrder') : '—'}
                </span>
                <span className="num">{t('done', { count: done })}</span>
              </div>
              <div className="row gap8">
                <span className="sw-row">
                  <Switch
                    zone="bo"
                    checked={rider.active}
                    onCheckedChange={() => undefined}
                    disabled
                    label={t('shiftLabel', { name: rider.name })}
                    title={t('shiftPending')}
                  />
                  {rider.active ? t('onShift') : t('off')}
                </span>
                <span className="spacer" />
                <a className="btn sm" href={phoneHref(rider.phone)}>
                  {t('call')}
                </a>
              </div>
            </div>
          );
        })}
        {cards.length === 0 ? <div className="empty-mini">{t('empty')}</div> : null}
      </div>
    </section>
  );
}

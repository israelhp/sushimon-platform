'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BoProductArt, IconCalendar, IconClock, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useBoPromotions, useSavePromotion } from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { errorMessage, isForbidden } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import type { Promotion } from '@/lib/data-access/models';
import { ISO_DAYS, PROMO_TONES, discountLabel, formatRange, isRunning } from '../catalog-view';
import { PromotionModal } from './PromotionModal';

const STATUS_TONE: Record<Promotion['status'], PillTone> = {
  current: 'success',
  scheduled: 'info',
  expired: 'warning',
  inactive: 'muted',
};

/** Pantalla Promociones: tarjetas con vigencia, días y horas; activar/desactivar y alta. */
export function PromotionsScreen() {
  const t = useTranslations('backoffice.promotions');
  const tu = useTranslations('ui');
  const toast = useToast();
  const promotions = useBoPromotions();
  const save = useSavePromotion();
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (isForbidden(promotions.error)) return <ForbiddenScreen reason="server" />;

  const list = promotions.data ?? [];
  const months = t('months').split(',');

  const toggle = (p: Promotion) => {
    setPendingId(p.id);
    save.mutate(
      { id: p.id, input: { active: !p.active } },
      {
        onSuccess: () => toast.notify(t(p.active ? 'toast.off' : 'toast.on', { name: p.name })),
        onError: (error) => toast.notify(t('saveError', { message: errorMessage(error) })),
        onSettled: () => setPendingId(null),
      },
    );
  };

  const switchState = (p: Promotion) =>
    p.status === 'expired'
      ? 'expired'
      : !p.active
        ? 'off'
        : p.status === 'scheduled'
          ? 'scheduled'
          : 'on';

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {t('subtitle', { active: list.filter(isRunning).length, total: list.length })}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={promotions.isPending}
          onClick={() => setCreating(true)}
        >
          <IconPlus size="sm" />
          {t('new')}
        </button>
      </div>

      {promotions.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void promotions.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {promotions.isPending ? (
        <div className="prgrid" aria-busy="true" aria-label={tu('loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 360, borderRadius: 16 }} />
          ))}
        </div>
      ) : list.length === 0 && !promotions.isError ? (
        <EmptyState zone="bo" title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="prgrid" role="list">
          {list.map((p, i) => {
            const state = switchState(p);
            const dayNames = ISO_DAYS.filter((d) => p.daysOfWeek.includes(d)).map((d) =>
              t(`days.${d}.full`),
            );
            return (
              <div
                key={p.id}
                role="listitem"
                className={cn('promo', (!p.active || p.status === 'expired') && 'off')}
              >
                <div className={cn('promo-art sg', PROMO_TONES[i % PROMO_TONES.length])}>
                  <BoProductArt kind="roll" />
                  <div>
                    <div className="promo-kicker">{t(`kicker.${p.kind}`)}</div>
                    <div className="promo-disc">{discountLabel(p)}</div>
                  </div>
                </div>
                <div className="promo-b">
                  <div className="row gap8">
                    <div className="promo-name grow">{p.name}</div>
                    <Pill zone="bo" tone={STATUS_TONE[p.status]}>
                      {t(`status.${p.status}`)}
                    </Pill>
                  </div>
                  <div className="muted sm" style={{ fontWeight: 600 }}>
                    {p.description}
                  </div>
                  <div className="pmeta">
                    <div>
                      <IconCalendar size="sm" />
                      {t('validity', { range: formatRange(p.validFrom, p.validTo, months) })}
                    </div>
                    <div>
                      <IconClock size="sm" />
                      {t('hours', { hours: `${p.startTime} – ${p.endTime}` })}
                    </div>
                  </div>
                  <div
                    className="days"
                    role="group"
                    aria-label={t('daysLabel', { days: dayNames.join(', ') })}
                  >
                    {ISO_DAYS.map((d) => (
                      <span
                        key={d}
                        className={p.daysOfWeek.includes(d) ? 'on' : undefined}
                        title={t(`days.${d}.full`)}
                      >
                        {t(`days.${d}.short`)}
                      </span>
                    ))}
                  </div>
                  <div className="row gap8 mt4">
                    <Switch
                      zone="bo"
                      checked={p.active}
                      label={t('activate', { name: p.name })}
                      disabled={pendingId === p.id || p.status === 'expired'}
                      onCheckedChange={() => toggle(p)}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {t(`switchState.${state}`)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating ? <PromotionModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

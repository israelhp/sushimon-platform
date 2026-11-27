'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useAdminBanners, useUpdateBanner } from '@/features/banners/hooks';
import { MediaThumb } from '@/features/bo-catalog/components/MediaThumb';
import { isForbidden } from '@/features/bo-orders/error-message';
import { queryKeys } from '@/features/query-keys';
import { BANNER_LIMIT } from '@/lib/banner-rules';
import { cn } from '@/lib/cn';
import type { AdminBanner } from '@/lib/data-access/models';
import { bannerServerError, canAddBanner } from '../banners-view';
import { BannerModal } from './BannerModal';
import { DeleteBannerModal } from './DeleteBannerModal';

type Dialog = { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string };

/**
 * Pantalla Banners (F16 simplificado, ADR-0033; sin prototipo: sigue el patrón de Promociones). Hasta 5 banners (activos más
 * inactivos) en el orden de creación, que es el del carrusel del Inicio. Cada uno: imagen, texto alternativo, estado y las acciones
 * activar/desactivar, editar y eliminar (con confirmación). Contador «n/5»; al llegar a 5 «Agregar banner» se deshabilita con aviso.
 * Ver exige `banners.read`; crear `banners.create`; editar, activar y eliminar `banners.update` (todos con alcance global). La UI solo
 * oculta o deshabilita: la API decide (401/403/404/409/422/503).
 */
export function BannersScreen() {
  const t = useTranslations('backoffice.banners');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { can, grants } = useShell();
  const update = useUpdateBanner();
  const banners = useAdminBanners();

  const titleRef = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Error persistente de activar (409/503…): se muestra con `role="alert"` además del aviso temporal. */
  const [actionError, setActionError] = useState<string | null>(null);

  if (isForbidden(banners.error)) return <ForbiddenScreen reason="server" />;

  const items = banners.data?.items ?? [];
  const count = items.length;
  const listReady = !banners.isPending && !banners.isError;
  const atLimit = listReady && !canAddBanner(count);

  const global = (permission: 'banners.create' | 'banners.update') =>
    can(permission) && Boolean(grants[permission]?.allBranches);
  const canCreate = global('banners.create');
  const canUpdate = global('banners.update');
  const noticeKey =
    canCreate && canUpdate
      ? null
      : canCreate
        ? 'noticeCreateOnly'
        : canUpdate
          ? 'noticeUpdateOnly'
          : 'noticeReadOnly';

  const toggle = (b: AdminBanner) => {
    setActionError(null);
    setPendingId(b.id);
    update.mutate(
      { id: b.id, input: { expectedVersion: b.version, active: !b.active } },
      {
        onSuccess: () => toast.notify(t(b.active ? 'toast.off' : 'toast.on')),
        onError: (error) => {
          const parsed = bannerServerError(error);
          const message = t('saveError', { message: parsed.message });
          toast.notify(message);
          setActionError(message);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.backoffice.banners });
        },
        onSettled: () => setPendingId(null),
      },
    );
  };

  const deleting = dialog?.kind === 'delete' ? items.find((b) => b.id === dialog.id) : undefined;

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1 ref={titleRef} tabIndex={-1} className="outline-none">
            {t('title')}
          </h1>
          <div className="page-sub" data-testid="banner-counter">
            {listReady
              ? t('counter', { count, max: BANNER_LIMIT })
              : t('counterPending', { max: BANNER_LIMIT })}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCreate || banners.isPending || atLimit}
          aria-describedby={atLimit ? 'banner-limit-note' : undefined}
          onClick={() => setDialog({ kind: 'create' })}
        >
          <IconPlus size="sm" />
          {t('new')}
        </button>
      </div>
      {atLimit ? (
        <Banner zone="bo" tone="info" role="status" id="banner-limit-note">
          {t('limitNote', { max: BANNER_LIMIT })}
        </Banner>
      ) : null}

      {noticeKey ? (
        <Banner zone="bo" tone="info" role="status">
          {t(noticeKey)}
        </Banner>
      ) : null}
      <Banner zone="bo" tone="info" role="note">
        {t('orderNote')}
      </Banner>

      {actionError ? (
        <Banner zone="bo" tone="alert" role="alert">
          {actionError}{' '}
          <button type="button" className="link-btn" onClick={() => setActionError(null)}>
            {tu('close')}
          </button>
        </Banner>
      ) : null}

      {banners.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void banners.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {banners.isPending ? (
        <div style={{ display: 'grid', gap: 12 }} aria-busy="true" aria-label={tu('loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 110, borderRadius: 16 }} />
          ))}
        </div>
      ) : items.length === 0 && !banners.isError ? (
        <EmptyState zone="bo" title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <ul style={{ display: 'grid', gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((b, i) => {
            const busy = pendingId === b.id;
            return (
              <li
                key={b.id}
                data-testid="banner-row"
                data-id={b.id}
                className={cn(
                  'card grid grid-cols-1 min-[560px]:grid-cols-[minmax(120px,200px)_1fr_auto]',
                  !b.active && 'off',
                )}
                style={{ gap: 12, padding: 14, alignItems: 'start', opacity: b.active ? 1 : 0.85 }}
              >
                <div
                  style={{
                    aspectRatio: '3 / 1',
                    overflow: 'hidden',
                    borderRadius: 10,
                    width: '100%',
                  }}
                >
                  <MediaThumb url={b.image.url} fill />
                </div>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{b.imageAlt}</strong>
                    <Pill zone="bo" tone={b.active ? 'success' : 'muted'}>
                      {t(b.active ? 'state.on' : 'state.off')}
                    </Pill>
                  </div>
                  <div className="xs muted" style={{ fontWeight: 600 }}>
                    {t('position', { n: i + 1 })}
                  </div>
                  <div className="row gap8 mt4">
                    <Switch
                      zone="bo"
                      checked={b.active}
                      label={t('activate', { name: b.imageAlt })}
                      disabled={!canUpdate || busy}
                      onCheckedChange={() => toggle(b)}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {t(b.active ? 'switchState.on' : 'switchState.off')}
                    </span>
                  </div>
                </div>
                <div className="row gap8" style={{ alignItems: 'center' }}>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    disabled={!canUpdate}
                    aria-label={t('editLabel', { name: b.imageAlt })}
                    title={t('edit')}
                    onClick={() => setDialog({ kind: 'edit', id: b.id })}
                  >
                    <IconPencil size="sm" />
                  </button>
                  <button
                    type="button"
                    className="btn sm danger"
                    disabled={!canUpdate || busy}
                    aria-label={t('deleteLabel', { name: b.imageAlt })}
                    onClick={() => setDialog({ kind: 'delete', id: b.id })}
                  >
                    {t('deleteButton')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <BannerModal
          bannerId={dialog.kind === 'edit' ? dialog.id : undefined}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteBannerModal
          banner={deleting}
          onClose={() => setDialog(null)}
          onDeleted={() => setTimeout(() => titleRef.current?.focus(), 0)}
        />
      ) : null}
    </div>
  );
}

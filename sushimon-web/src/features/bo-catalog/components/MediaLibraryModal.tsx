'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconFork } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import {
  useAttachProductMedia,
  useDeleteMedia,
  useInvalidateMedia,
  useMediaLibrary,
} from '@/features/media/hooks';
import { mediaErrorKind } from '@/features/media/media-view';
import type { AdminMediaAsset } from '@/lib/data-access/models';
import { formatBytes, type MediaErrorKind } from '@/lib/media-rules';
import { MediaThumb } from './MediaThumb';

const PAGE_SIZE = 12;

/**
 * Biblioteca de medios (F14): imágenes READY ya subidas para REUTILIZAR en el producto (`attachAdminProductMedia`) y, si ningún
 * producto las usa, eliminarlas con confirmación (409 `MEDIA_IN_USE` se explica). Lectura `catalog.read`; añadir y eliminar
 * exigen `catalog.update` con alcance global (`canWrite`).
 */
export function MediaLibraryModal({
  productId,
  attachedAssetIds,
  slots,
  canWrite,
  onClose,
}: {
  productId: string;
  attachedAssetIds: readonly string[];
  slots: number;
  canWrite: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.media');
  const toast = useToast();
  const [page, setPage] = useState(1);
  const library = useMediaLibrary({ status: 'READY', page, pageSize: PAGE_SIZE });
  const attach = useAttachProductMedia(productId);
  const remove = useDeleteMedia();
  const invalidate = useInvalidateMedia();
  const [error, setError] = useState<MediaErrorKind | null>(null);
  const [deleting, setDeleting] = useState<{ asset: AdminMediaAsset; n: number } | null>(null);
  const data = library.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const attached = new Set(attachedAssetIds);

  const fail = (e: unknown) => {
    const kind = mediaErrorKind(e);
    setError(kind);
    if (kind === 'notFound' || kind === 'inUse' || kind === 'alreadyAttached') void invalidate();
  };

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconFork />}
      title={t('libraryTitle')}
      description={t('libraryHelp')}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('close')}
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {error ? (
          <Banner zone="bo" tone="alert" role="alert">
            {t(`error.${error}`)}
          </Banner>
        ) : null}
        {library.isPending ? (
          <div aria-busy="true" aria-label={t('loading')}>
            <Skeleton zone="bo" style={{ height: 120, borderRadius: 12 }} />
          </div>
        ) : library.isError ? (
          <Banner zone="bo" tone="danger" role="alert">
            {t('libraryError')}{' '}
            <button type="button" className="link-btn" onClick={() => void library.refetch()}>
              {t('retry')}
            </button>
          </Banner>
        ) : data && data.items.length === 0 ? (
          <p className="sm muted" role="status">
            {t('libraryEmpty')}
          </p>
        ) : data ? (
          <>
            <ul
              className="m-0 grid list-none gap-2 p-0"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {data.items.map((a, i) => {
                const n = (page - 1) * PAGE_SIZE + i + 1;
                const here = attached.has(a.id);
                return (
                  <li
                    key={a.id}
                    className="card"
                    style={{ padding: 10, display: 'grid', gap: 8 }}
                    aria-label={t('libraryItem', { n })}
                  >
                    <div className="row gap8" style={{ alignItems: 'center' }}>
                      <MediaThumb url={a.url} size={56} />
                      <span style={{ display: 'grid', gap: 2 }}>
                        <strong className="sm">{t('libraryItem', { n })}</strong>
                        <span className="xs muted">
                          {t('libraryMeta', {
                            size: formatBytes(a.sizeBytes),
                            usage:
                              a.usageCount === 0
                                ? t('usageNone')
                                : t('usageCount', { count: a.usageCount }),
                          })}
                        </span>
                      </span>
                    </div>
                    <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn sm btn-primary"
                        aria-label={here ? undefined : t('attachLabel', { n })}
                        disabled={!canWrite || here || slots === 0 || attach.isPending}
                        onClick={() => {
                          setError(null);
                          attach.mutate(
                            { assetId: a.id },
                            {
                              onSuccess: () => toast.notify(t('attached')),
                              onError: fail,
                            },
                          );
                        }}
                      >
                        {here ? t('alreadyHere') : t('attach')}
                      </button>
                      {a.usageCount === 0 ? (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t('deleteLabel', { n })}
                          disabled={!canWrite || remove.isPending}
                          onClick={() => setDeleting({ asset: a, n })}
                        >
                          {t('delete')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {pages > 1 ? (
              <div className="row gap8" style={{ alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  {t('prev')}
                </button>
                <span className="xs muted" role="status">
                  {t('pager', { page, pages })}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {t('next')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {deleting ? (
        <ConfirmModal
          title={t('deleteTitle')}
          description={t('deleteBody')}
          confirmLabel={t('deleteConfirm')}
          cancelLabel={t('cancel')}
          pendingLabel={t('loading')}
          danger
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(deleting.asset.id, {
              onSuccess: () => {
                setDeleting(null);
                toast.notify(t('deleted'));
              },
              onError: (e) => {
                setDeleting(null);
                fail(e);
              },
            })
          }
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Modal>
  );
}

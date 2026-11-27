'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { MediaThumb } from '@/features/bo-catalog/components/MediaThumb';
import { useMediaLibrary } from '@/features/media/hooks';
import { mediaErrorKind } from '@/features/media/media-view';
import { useDataClient } from '@/lib/data-access/provider';
import { MEDIA_ALLOWED_MIME, formatBytes } from '@/lib/media-rules';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { progressPercent } from '@/features/media/media-view';
import type { ImageValue } from '../banners-view';
import { useBannerImageUpload } from '../use-banner-image-upload';

const LIBRARY_PAGE_SIZE = 8;

/**
 * Imagen del banner (F16): vista previa 3:1, SUBIR (optimiza en el navegador a 3:1, ≤ 1920 px y ≤ 1 MiB; intent → PUT → confirmar)
 * o ELEGIR una imagen de banner ya subida. Subir exige `catalog.update` con alcance global (en v1 solo administración: P18); sin
 * ese permiso solo se puede elegir de la biblioteca. Un error de subida no borra el texto alternativo.
 */
export function BannerImageField({
  value,
  onChange,
  canUpload,
  invalid,
  describedBy,
  disabled,
}: {
  value: ImageValue | null;
  onChange: (image: ImageValue) => void;
  canUpload: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('backoffice.banners.image');
  const tm = useTranslations('backoffice.media');
  const client = useDataClient();
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const { state, upload, reset, cancel } = useBannerImageUpload();
  const [library, setLibrary] = useState(false);
  const busy =
    state.status === 'optimizing' || state.status === 'uploading' || state.status === 'confirming';

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const image = await upload(file);
    if (image) onChange(image);
  };

  const statusText =
    state.status === 'optimizing'
      ? t('status.optimizing')
      : state.status === 'uploading'
        ? t('status.uploading', { percent: progressPercent(state.progress) })
        : state.status === 'confirming'
          ? t('status.confirming')
          : state.status === 'done'
            ? t('status.done', {
                before: formatBytes(state.before ?? 0),
                after: formatBytes(state.after ?? 0),
              })
            : null;

  return (
    <div className="field span-2" role="group" aria-labelledby={labelId}>
      <span className="flabel" id={labelId}>
        {t('label')}
      </span>
      <div
        style={{
          aspectRatio: '3 / 1',
          width: '100%',
          maxWidth: 480,
          borderRadius: 12,
          overflow: 'hidden',
          border: invalid ? '2px solid var(--bo-red-text)' : '1px solid var(--bo-line)',
        }}
      >
        {value ? (
          <MediaThumb url={value.url} src={value.previewSrc} alt={t('currentAlt')} fill />
        ) : (
          <div
            className="sm muted"
            style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 8 }}
          >
            {t('empty')}
          </div>
        )}
      </div>
      {value ? (
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {t('meta', { size: formatBytes(value.sizeBytes) })}
        </span>
      ) : null}
      <div className="row gap8" style={{ flexWrap: 'wrap' }}>
        <input
          ref={input}
          type="file"
          hidden
          accept={MEDIA_ALLOWED_MIME.join(',')}
          aria-label={t('inputLabel')}
          onChange={(e) => void onFiles(e)}
        />
        <button
          type="button"
          className="btn sm"
          data-field={canUpload ? 'image' : undefined}
          disabled={disabled || busy || !canUpload}
          aria-describedby={describedBy}
          onClick={() => input.current?.click()}
        >
          {value ? t('replace') : t('upload')}
        </button>
        <button
          type="button"
          className="btn sm"
          data-field={canUpload ? undefined : 'image'}
          disabled={disabled || busy}
          aria-describedby={describedBy}
          onClick={() => setLibrary(true)}
        >
          {t('library')}
        </button>
        {busy ? (
          <button type="button" className="btn sm" onClick={cancel}>
            {t('cancel')}
          </button>
        ) : null}
        {client.kind === 'mock' ? (
          <SimulationBadge kind="demo">{t('simulated')}</SimulationBadge>
        ) : null}
      </div>
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('help')}
      </span>
      {!canUpload ? (
        <Banner zone="bo" tone="info" role="note">
          {t('uploadScope')}
        </Banner>
      ) : null}
      <div role="status" aria-live="polite" className="sm" style={{ fontWeight: 700 }}>
        {statusText}
      </div>
      {state.status === 'error' && state.error ? (
        <Banner zone="bo" tone="alert" role="alert">
          {state.error === 'tooLarge' ? t('tooLarge') : tm(`error.${state.error}`)}
          {state.error === 'storageUnavailable' ? ` ${t('storageDown')}` : ''}
        </Banner>
      ) : null}
      {library ? (
        <BannerLibraryModal
          selected={value?.assetId ?? null}
          onPick={(image) => {
            reset();
            onChange(image);
            setLibrary(false);
          }}
          onClose={() => setLibrary(false)}
        />
      ) : null}
    </div>
  );
}

/** Imágenes de banner ya subidas (READY, `kind=BANNER_IMAGE`) para reutilizar. Lectura `catalog.read`. */
function BannerLibraryModal({
  selected,
  onPick,
  onClose,
}: {
  selected: string | null;
  onPick: (image: ImageValue) => void;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.banners.image');
  const [page, setPage] = useState(1);
  const library = useMediaLibrary({
    kind: 'BANNER_IMAGE',
    status: 'READY',
    page,
    pageSize: LIBRARY_PAGE_SIZE,
  });
  const data = library.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const failed = library.isError ? mediaErrorKind(library.error) : null;

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t('libraryTitle')}
      description={t('libraryHelp')}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('close')}
        </button>
      }
    >
      {library.isPending ? (
        <div aria-busy="true" aria-label={t('loading')}>
          <Skeleton zone="bo" style={{ height: 120, borderRadius: 12 }} />
        </div>
      ) : library.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {failed === 'forbidden' ? t('libraryForbidden') : t('libraryError')}{' '}
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
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          >
            {data.items.map((a, i) => {
              const n = (page - 1) * LIBRARY_PAGE_SIZE + i + 1;
              return (
                <li key={a.id} className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
                  <div style={{ aspectRatio: '3 / 1', overflow: 'hidden', borderRadius: 8 }}>
                    <MediaThumb url={a.url} fill />
                  </div>
                  <span className="xs muted">
                    {t('libraryMeta', { size: formatBytes(a.sizeBytes), count: a.usageCount })}
                  </span>
                  <button
                    type="button"
                    className="btn sm btn-primary"
                    aria-label={t('pickLabel', { n })}
                    disabled={a.id === selected}
                    onClick={() =>
                      onPick({
                        assetId: a.id,
                        url: a.url,
                        mimeType: a.mimeType,
                        sizeBytes: a.sizeBytes,
                      })
                    }
                  >
                    {a.id === selected ? t('picked') : t('pick')}
                  </button>
                </li>
              );
            })}
          </ul>
          {pages > 1 ? (
            <div className="row gap8" style={{ alignItems: 'center', marginTop: 10 }}>
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
    </Modal>
  );
}

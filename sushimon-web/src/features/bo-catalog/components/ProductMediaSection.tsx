'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { IconChevronDown, IconChevronUp } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Pill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import {
  useDetachProductMedia,
  useInvalidateMedia,
  useReorderProductMedia,
  useUpdateProductMedia,
} from '@/features/media/hooks';
import {
  displayFileName,
  isAuthKind,
  isActive,
  mediaErrorKind,
  progressPercent,
  type QueueItem,
} from '@/features/media/media-view';
import { useUploadQueue } from '@/features/media/use-upload-queue';
import { moveWithin } from '@/lib/category-tree';
import { useDataClient } from '@/lib/data-access/provider';
import type { AdminProduct, AdminProductMedia } from '@/lib/data-access/models';
import {
  MEDIA_ALLOWED_MIME,
  MEDIA_ALT_MAX,
  MEDIA_PER_PRODUCT_MAX,
  remainingSlots,
  type MediaErrorKind,
} from '@/lib/media-rules';
import { canGlobally } from '@/lib/permissions';
import { MediaLibraryModal } from './MediaLibraryModal';
import { MediaThumb } from './MediaThumb';

/**
 * Sección «Imágenes» del editor de producto (F14): carga múltiple (selector y arrastrar y soltar), cola con estado por archivo
 * (optimizando → subiendo con progreso → confirmando → añadiendo → listo / error con reintentar y quitar), imagen principal =
 * la primera, reordenar con subir/bajar (anuncio `aria-live`, foco conservado), texto alternativo, desvincular con confirmación
 * (el archivo NO se borra) y biblioteca para reutilizar o eliminar. Cada acción se aplica de inmediato contra la API de medios
 * (no forma parte del botón «Guardar producto»). Escritura: `catalog.update` con alcance global; sin él, solo lectura.
 */
export function ProductMediaSection({ product }: { product: AdminProduct }) {
  const t = useTranslations('backoffice.media');
  const toast = useToast();
  const client = useDataClient();
  const { grants } = useShell();
  const canWrite = canGlobally(grants, 'catalog.update');
  const items = [...product.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const queue = useUploadQueue(product.id, items.length);
  const reorder = useReorderProductMedia(product.id);
  const detach = useDetachProductMedia(product.id);
  const updateAlt = useUpdateProductMedia(product.id);
  const invalidate = useInvalidateMedia();
  const [error, setError] = useState<MediaErrorKind | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [detachTarget, setDetachTarget] = useState<{ media: AdminProductMedia; n: number } | null>(
    null,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const titleId = useId();
  const busy = reorder.isPending || detach.isPending || updateAlt.isPending;
  const slots = remainingSlots(items.length);
  const storageDown =
    queue.items.some((i) => i.error === 'storageUnavailable') || error === 'storageUnavailable';
  const doneCount = queue.items.filter((i) => i.status === 'done').length;

  // Anuncia cada imagen terminada (una sola vez por elemento) y la lista se recarga sola al invalidar.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const i of queue.items) {
      if (i.status === 'done' && !announced.current.has(i.id)) {
        announced.current.add(i.id);
        setAnnouncement(t('uploaded', { name: displayFileName(i.name) }));
      }
    }
  }, [queue.items, t]);

  // Devuelve el foco al botón recién usado: el que se movió puede quedar deshabilitado en un extremo.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-media-id="${CSS.escape(target.id)}"]`,
    );
    const preferred = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  }, [product.media]);

  const onMutationError = (e: unknown) => {
    const kind = mediaErrorKind(e);
    setError(kind);
    if (kind === 'reorderMismatch' || kind === 'notFound' || kind === 'productNotFound') {
      void invalidate();
    }
  };

  const pick = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0 || !canWrite) return;
    setError(null);
    queue.add(list);
  };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    pick(e.target.files);
    e.target.value = ''; // permite elegir el mismo archivo otra vez
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const move = (m: AdminProductMedia, dir: -1 | 1) => {
    if (busy) return;
    const ids = items.map((x) => x.id);
    const next = moveWithin(ids, m.id, dir);
    if (!next) return;
    setError(null);
    focusAfter.current = { id: m.id, dir: dir === -1 ? 'up' : 'down' };
    reorder.mutate(next, {
      onSuccess: () =>
        setAnnouncement(t('moved', { position: next.indexOf(m.id) + 1, total: next.length })),
      onError: onMutationError,
    });
  };

  const confirmDetach = () => {
    if (!detachTarget) return;
    detach.mutate(detachTarget.media.id, {
      onSuccess: () => {
        setDetachTarget(null);
        toast.notify(t('detached'));
        setAnnouncement(t('detached'));
      },
      onError: (e) => {
        setDetachTarget(null);
        onMutationError(e);
      },
    });
  };

  return (
    <section aria-labelledby={titleId} className="span-2" style={{ display: 'grid', gap: 10 }}>
      <div className="row gap8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 id={titleId} className="sm" style={{ fontWeight: 800, margin: 0 }}>
          {t('title')}
        </h3>
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {items.length}/{MEDIA_PER_PRODUCT_MAX}
        </span>
        {client.kind === 'mock' ? <SimulationBadge kind="simulation" zone="bo" /> : null}
      </div>
      <p className="xs muted" style={{ margin: 0 }}>
        {t('help', { max: MEDIA_PER_PRODUCT_MAX })}
      </p>
      {client.kind === 'mock' ? (
        <p className="xs muted" style={{ margin: 0 }}>
          {t('simulation')}
        </p>
      ) : null}
      {!canWrite ? (
        <Banner zone="bo" tone="info" role="status">
          {t('readOnly')}
        </Banner>
      ) : null}
      {storageDown ? (
        <Banner zone="bo" tone="warning" role="status">
          <strong>{t('storageDown')}</strong> {t('storageDownHelp')}
        </Banner>
      ) : null}
      {error ? (
        <Banner zone="bo" tone="alert" role="alert">
          {t(`error.${error}`)}
        </Banner>
      ) : null}

      {canWrite ? (
        <div
          role="group"
          aria-label={t('dropLabel')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className="row gap8"
          style={{
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: 12,
            borderRadius: 12,
            border: `2px dashed ${dragging ? 'var(--bo-primary)' : 'var(--bo-line-strong)'}`,
            background: dragging ? 'var(--bo-primary-soft)' : 'transparent',
          }}
        >
          <span className="sm" style={{ fontWeight: 600 }}>
            {t('dropText')}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={slots === 0 && queue.items.every((i) => !isActive(i.status))}
            onClick={() => inputRef.current?.click()}
          >
            {t('choose')}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={MEDIA_ALLOWED_MIME.join(',')}
            aria-label={t('chooseInput')}
            tabIndex={-1}
            className="sr-only"
            onChange={onInput}
          />
          <button type="button" className="btn sm" onClick={() => setLibraryOpen(true)}>
            {t('library')}
          </button>
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {slots > 0 ? t('slotsLeft', { count: slots }) : t('slotsFull')}
          </span>
        </div>
      ) : (
        <div>
          <button type="button" className="btn sm" onClick={() => setLibraryOpen(true)}>
            {t('library')}
          </button>
        </div>
      )}

      {queue.items.length > 0 ? (
        <div>
          <ul
            aria-label={t('queue')}
            className="m-0 flex list-none flex-col gap-2 p-0"
            data-testid="media-queue"
          >
            {queue.items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                onRetry={() => queue.retry(item.id)}
                onRemove={() => queue.remove(item.id)}
              />
            ))}
          </ul>
          {doneCount > 0 ? (
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 6 }}
              onClick={queue.clearDone}
            >
              {t('clearDone')}
            </button>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="sm muted" role="status" style={{ margin: 0 }}>
          {t('empty')}
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-label={t('listLabel')}
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {items.map((m, i) => (
            <MediaRow
              key={m.id}
              media={m}
              index={i}
              total={items.length}
              canWrite={canWrite}
              busy={busy}
              onMove={(dir) => move(m, dir)}
              onDetach={() => setDetachTarget({ media: m, n: i + 1 })}
              onSaveAlt={(alt) =>
                updateAlt.mutate(
                  { mediaId: m.id, altText: alt },
                  {
                    onSuccess: () => {
                      setError(null);
                      toast.notify(t('altSaved'));
                    },
                    onError: onMutationError,
                  },
                )
              }
            />
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {detachTarget ? (
        <ConfirmModal
          title={t('detachTitle')}
          description={t('detachBody')}
          confirmLabel={t('detachConfirm')}
          cancelLabel={t('cancel')}
          pendingLabel={t('loading')}
          danger
          pending={detach.isPending}
          onConfirm={confirmDetach}
          onClose={() => setDetachTarget(null)}
        />
      ) : null}
      {libraryOpen ? (
        <MediaLibraryModal
          productId={product.id}
          attachedAssetIds={items.flatMap((m) => (m.assetId ? [m.assetId] : []))}
          slots={slots}
          canWrite={canWrite}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </section>
  );
}

function MediaRow({
  media,
  index,
  total,
  canWrite,
  busy,
  onMove,
  onDetach,
  onSaveAlt,
}: {
  media: AdminProductMedia;
  index: number;
  total: number;
  canWrite: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onDetach: () => void;
  onSaveAlt: (alt: string | null) => void;
}) {
  const t = useTranslations('backoffice.media');
  const n = index + 1;
  const [alt, setAlt] = useState(media.altText ?? '');
  // Si el servidor cambia el texto (guardado, otra sesión), el borrador lo sigue sin recrear la fila (se conserva el foco).
  const [seen, setSeen] = useState(media.altText);
  if (seen !== media.altText) {
    setSeen(media.altText);
    setAlt(media.altText ?? '');
  }
  const changed = alt.trim() !== (media.altText ?? '');
  return (
    <li
      data-media-id={media.id}
      className="card"
      style={{ padding: 10, display: 'grid', gap: 8 }}
      aria-label={t('imageOf', { n, total })}
    >
      <div className="row gap8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <MediaThumb url={media.url} alt={media.altText ?? ''} />
        <span className="sm" style={{ fontWeight: 700 }}>
          {t('imageOf', { n, total })}
        </span>
        {index === 0 ? (
          <Pill zone="bo" tone="success">
            {t('primary')}
          </Pill>
        ) : null}
        {!media.assetId ? (
          <Pill zone="bo" tone="muted">
            {t('external')}
          </Pill>
        ) : null}
        <span className="row gap8" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="icon-btn bordered"
            data-move="up"
            aria-label={t('up', { n })}
            disabled={!canWrite || busy || index === 0}
            onClick={() => onMove(-1)}
          >
            <IconChevronUp size="sm" />
          </button>
          <button
            type="button"
            className="icon-btn bordered"
            data-move="down"
            aria-label={t('down', { n })}
            disabled={!canWrite || busy || index === total - 1}
            onClick={() => onMove(1)}
          >
            <IconChevronDown size="sm" />
          </button>
          <button
            type="button"
            className="btn sm"
            aria-label={t('detachLabel', { n })}
            disabled={!canWrite || busy}
            onClick={onDetach}
          >
            {t('detach')}
          </button>
        </span>
      </div>
      <div className="row gap8" style={{ alignItems: 'center' }}>
        <input
          className="inp"
          type="text"
          autoComplete="off"
          maxLength={MEDIA_ALT_MAX * 2}
          placeholder={t('altPlaceholder')}
          aria-label={t('alt', { n })}
          value={alt}
          disabled={!canWrite}
          onChange={(e) => setAlt(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          className="btn sm"
          aria-label={t('altSaveLabel', { n })}
          disabled={!canWrite || busy || !changed}
          onClick={() => onSaveAlt(alt.trim() || null)}
        >
          {t('altSave')}
        </button>
      </div>
    </li>
  );
}

function QueueRow({
  item,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('backoffice.media');
  const name = displayFileName(item.name);
  const percent = progressPercent(item.progress);
  const statusText =
    item.status === 'uploading' ? t('status.uploading', { percent }) : t(`status.${item.status}`);
  const failed = item.status === 'error';
  return (
    <li
      className="card"
      aria-label={t('queueItem', { name })}
      data-status={item.status}
      style={{ padding: 10, display: 'grid', gap: 6 }}
    >
      <div className="row gap8" style={{ alignItems: 'center' }}>
        <MediaThumb src={item.previewUrl} size={44} />
        <span
          className="sm"
          style={{ fontWeight: 700, minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}
        >
          {name}
        </span>
        <span
          className="xs"
          role={failed ? undefined : 'status'}
          style={{ fontWeight: 700, color: failed ? 'var(--bo-red-text)' : undefined }}
        >
          {statusText}
        </span>
        {failed ? (
          <>
            {item.error && !isAuthKind(item.error) ? (
              <button
                type="button"
                className="btn sm"
                aria-label={t('retryLabel', { name })}
                onClick={onRetry}
              >
                {t('retry')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn sm"
              aria-label={t('removeQueueLabel', { name })}
              onClick={onRemove}
            >
              {t('removeQueue')}
            </button>
          </>
        ) : item.status === 'uploading' ? (
          <button
            type="button"
            className="btn sm"
            aria-label={t('cancelLabel', { name })}
            onClick={onRemove}
          >
            {t('cancel')}
          </button>
        ) : null}
      </div>
      {item.status === 'uploading' ? (
        <progress
          value={percent}
          max={100}
          aria-label={t('progress', { name })}
          style={{ width: '100%' }}
        />
      ) : null}
      {failed && item.error ? (
        <span className="xs" role="alert" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
          {t(`error.${item.error}`)}
        </span>
      ) : null}
    </li>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { IconChevronDown, IconChevronUp } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Pill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useDataClient } from '@/lib/data-access/provider';
import { MEDIA_ALLOWED_MIME, MEDIA_ALT_MAX, MEDIA_PER_PRODUCT_MAX } from '@/lib/media-rules';
import { displayFileName } from '@/features/media/media-view';
import type { StagedImages } from '../staged-images';
import { MediaThumb } from './MediaThumb';

/**
 * Sección «Imágenes» del ALTA de producto: elige archivos (selector o arrastrar y soltar), vista previa local, quitar, reordenar
 * (la primera es la principal) y texto alternativo opcional. NO llama a la API: al guardar, `ProductModal` crea el producto y
 * encola estos archivos en la cola de subida de F14. Sin `canWrite` (rol que crea pero no adjunta) solo explica el límite.
 */
export function StagedImagesSection({
  staged,
  canWrite,
  disabled,
}: {
  staged: StagedImages;
  canWrite: boolean;
  /** Mientras se crea el producto. */
  disabled: boolean;
}) {
  const t = useTranslations('backoffice.media');
  const client = useDataClient();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const { items } = staged;
  const slots = MEDIA_PER_PRODUCT_MAX - items.length;

  const pick = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0 || !canWrite || disabled) return;
    const r = staged.add(list);
    const parts: string[] = [];
    if (r.rejectedType > 0) parts.push(t('stagedRejectedType', { count: r.rejectedType }));
    if (r.rejectedFull > 0) {
      parts.push(t('stagedRejectedFull', { count: r.rejectedFull, max: MEDIA_PER_PRODUCT_MAX }));
    }
    setNotice(parts.join(' '));
    if (r.added > 0) setAnnouncement(t('stagedAdded', { count: r.added }));
  };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    pick(e.target.files);
    e.target.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const move = (id: string, dir: -1 | 1) => {
    focusAfter.current = { id, dir: dir === -1 ? 'up' : 'down' };
    const position = staged.move(id, dir);
    if (position !== null) {
      setAnnouncement(t('moved', { position: position + 1, total: items.length }));
      // Devuelve el foco al botón usado (el movido puede quedar deshabilitado en un extremo).
      queueMicrotask(() => {
        const target = focusAfter.current;
        focusAfter.current = null;
        if (!target) return;
        const row = listRef.current?.querySelector<HTMLElement>(
          `[data-staged-id="${CSS.escape(target.id)}"]`,
        );
        const preferred = row?.querySelector<HTMLButtonElement>(
          `button[data-move="${target.dir}"]`,
        );
        const other = row?.querySelector<HTMLButtonElement>(
          `button[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
        );
        (preferred && !preferred.disabled ? preferred : other)?.focus();
      });
    }
  };

  const remove = (id: string, n: number) => {
    staged.remove(id);
    setAnnouncement(t('stagedRemoved', { n }));
    // El foco no puede quedar en un nodo que desaparece: vuelve al selector de archivos.
    queueMicrotask(() => document.getElementById(`${titleId}-choose`)?.focus());
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
          {t('createNoPermission')}
        </Banner>
      ) : (
        <>
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
              id={`${titleId}-choose`}
              type="button"
              className="btn sm"
              disabled={disabled || slots <= 0}
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
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {slots > 0 ? t('slotsLeft', { count: slots }) : t('slotsFull')}
            </span>
          </div>
          <p className="xs muted" style={{ margin: 0 }}>
            {t('stagedHelp')}
          </p>
          {notice ? (
            <Banner zone="bo" tone="warning" role="status">
              {notice}
            </Banner>
          ) : null}
        </>
      )}

      {items.length > 0 ? (
        <ul
          ref={listRef}
          aria-label={t('stagedList')}
          className="m-0 flex list-none flex-col gap-2 p-0"
          data-testid="staged-images"
        >
          {items.map((item, index) => {
            const n = index + 1;
            const name = displayFileName(item.file.name);
            return (
              <li
                key={item.id}
                data-staged-id={item.id}
                className="card"
                aria-label={t('imageOf', { n, total: items.length })}
                style={{ padding: 10, display: 'grid', gap: 8 }}
              >
                <div className="row gap8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <MediaThumb src={item.previewUrl} size={44} />
                  <span
                    className="sm"
                    style={{ fontWeight: 700, minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}
                  >
                    {name}
                  </span>
                  {index === 0 ? (
                    <Pill zone="bo" tone="success">
                      {t('primary')}
                    </Pill>
                  ) : null}
                  <span className="row gap8">
                    <button
                      type="button"
                      className="icon-btn bordered"
                      data-move="up"
                      aria-label={t('up', { n })}
                      disabled={disabled || index === 0}
                      onClick={() => move(item.id, -1)}
                    >
                      <IconChevronUp size="sm" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn bordered"
                      data-move="down"
                      aria-label={t('down', { n })}
                      disabled={disabled || index === items.length - 1}
                      onClick={() => move(item.id, 1)}
                    >
                      <IconChevronDown size="sm" />
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={t('stagedRemoveLabel', { name })}
                      disabled={disabled}
                      onClick={() => remove(item.id, n)}
                    >
                      {t('removeQueue')}
                    </button>
                  </span>
                </div>
                <input
                  className="inp"
                  type="text"
                  autoComplete="off"
                  maxLength={MEDIA_ALT_MAX}
                  placeholder={t('altPlaceholder')}
                  aria-label={t('alt', { n })}
                  value={item.alt}
                  disabled={disabled}
                  onChange={(e) => staged.setAlt(item.id, e.target.value)}
                />
              </li>
            );
          })}
        </ul>
      ) : canWrite ? (
        <p className="sm muted" style={{ margin: 0 }}>
          {t('stagedEmpty')}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

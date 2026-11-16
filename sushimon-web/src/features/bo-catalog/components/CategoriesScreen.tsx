'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import {
  useAdminCategories,
  useReorderCategories,
  useUpdateCategory,
} from '@/features/categories/hooks';
import { queryKeys } from '@/features/query-keys';
import { cn } from '@/lib/cn';
import { MAX_CATEGORY_DEPTH, descendantIds, moveWithin, siblingsInList } from '@/lib/category-tree';
import type { AdminCategory } from '@/lib/data-access/models';
import { canGlobally } from '@/lib/permissions';
import { categoryServerError } from '../categories-view';
import { isForbidden } from '@/features/bo-orders/error-message';
import { CategoryFormModal } from './CategoryFormModal';

type Dialog =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'edit'; id: string }
  | { kind: 'status'; id: string };

/**
 * Pantalla Categorías (F10): árbol del menú como lista indentada (hasta 3 niveles) con alta, edición (nombre, slug,
 * descripción, padre), activar/desactivar con confirmación (muestra la visibilidad EFECTIVA: un hijo activo bajo un padre
 * inactivo sigue oculto) y reordenar entre hermanos con botones subir/bajar (teclado y anuncio). La vista exige
 * `catalog.read`; las acciones `catalog.create`/`catalog.update` con alcance GLOBAL (si no, se deshabilitan con aviso:
 * el servidor responde 403 de todos modos). Sin borrado: solo se desactiva.
 */
export function CategoriesScreen() {
  const t = useTranslations('backoffice.categories');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { grants, can } = useShell();
  const categories = useAdminCategories();
  const update = useUpdateCategory();
  const reorder = useReorderCategories();

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [statusError, setStatusError] = useState('');
  const [actionError, setActionError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  const list = useMemo(() => categories.data?.items ?? [], [categories.data]);
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list]);
  const canCreate = canGlobally(grants, 'catalog.create');
  const canUpdate = canGlobally(grants, 'catalog.update');
  const anyWrite = can('catalog.create') || can('catalog.update');
  const noticeKey = canCreate || canUpdate ? null : anyWrite ? 'noticeScope' : 'noticeReadOnly';

  // Devuelve el foco al botón recién usado: al reordenar el navegador puede soltarlo (botón deshabilitado).
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-cat-id="${CSS.escape(target.id)}"]`,
    );
    const preferred = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  }, [list]);

  if (isForbidden(categories.error)) return <ForbiddenScreen reason="server" />;

  const close = () => {
    setDialog(null);
    setStatusError('');
  };

  const move = (c: AdminCategory, dir: -1 | 1) => {
    if (reorder.isPending) return;
    const siblings = siblingsInList(list, c.parentId);
    const next = moveWithin(
      siblings.map((s) => s.id),
      c.id,
      dir,
    );
    if (!next) return;
    setActionError('');
    focusAfter.current = { id: c.id, dir: dir === -1 ? 'up' : 'down' };
    reorder.mutate(
      { parentId: c.parentId, orderedIds: next },
      {
        onSuccess: () =>
          setAnnouncement(
            t('moved', { name: c.name, position: next.indexOf(c.id) + 1, total: next.length }),
          ),
        onError: (error) => {
          const parsed = categoryServerError(error);
          setActionError(parsed.message);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.categories.all });
        },
      },
    );
  };

  const target = dialog && dialog.kind !== 'create' ? byId.get(dialog.id) : undefined;
  const confirmStatus = (c: AdminCategory) => {
    update.mutate(
      { id: c.id, input: { active: !c.active } },
      {
        onSuccess: () => {
          toast.notify(t(c.active ? 'toastDeactivated' : 'toastActivated', { name: c.name }));
          close();
        },
        onError: (error) => {
          const parsed = categoryServerError(error);
          setStatusError(parsed.message);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.categories.all });
        },
      },
    );
  };

  const statusDescription = (c: AdminCategory) => {
    if (c.active) {
      const hidden = descendantIds(list, c.id).size;
      return t('deactivateBody', { name: c.name, count: hidden });
    }
    const blocker = (function find(id: string | null): AdminCategory | undefined {
      const parent = id ? byId.get(id) : undefined;
      if (!parent) return undefined;
      return parent.active ? find(parent.parentId) : parent;
    })(c.parentId);
    return blocker
      ? t('activateBlocked', { name: c.name, parent: blocker.name })
      : t('activateBody', { name: c.name });
  };

  return (
    <div className="page" style={{ maxWidth: 980, animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{t('subtitle', { max: MAX_CATEGORY_DEPTH })}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCreate || categories.isPending}
          onClick={() => setDialog({ kind: 'create', parentId: null })}
        >
          <IconPlus size="sm" />
          {t('new')}
        </button>
      </div>

      {noticeKey ? (
        <Banner zone="bo" tone="info" role="status">
          {t(noticeKey)}
        </Banner>
      ) : null}
      {actionError ? (
        <Banner zone="bo" tone="alert" role="alert">
          {actionError}
        </Banner>
      ) : null}
      {categories.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void categories.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      <section className="card" aria-labelledby="cat-tree-title">
        <div className="card-h">
          <h2 id="cat-tree-title">{t('listTitle')}</h2>
          <span className="count-chip">{list.length}</span>
        </div>
        <div ref={listRef} style={{ borderTop: '1px solid var(--bo-line)' }} role="list">
          {categories.isPending ? (
            <div aria-busy="true" aria-label={tu('loading')} style={{ padding: 14 }}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton
                  key={i}
                  zone="bo"
                  style={{ height: 52, borderRadius: 12, marginBottom: 8 }}
                />
              ))}
            </div>
          ) : list.length === 0 && !categories.isError ? (
            <EmptyState
              zone="bo"
              title={t('empty')}
              description={canCreate ? t('emptyHint') : undefined}
            />
          ) : (
            list.map((c) => {
              const siblings = siblingsInList(list, c.parentId);
              const index = siblings.findIndex((s) => s.id === c.id);
              const parent = c.parentId ? byId.get(c.parentId) : undefined;
              const hiddenByAncestor = c.active && !c.effectivelyVisible;
              return (
                <div
                  key={c.id}
                  role="listitem"
                  data-cat-id={c.id}
                  data-depth={c.depth}
                  className={cn('crow', !c.effectivelyVisible && 'off')}
                  style={{ paddingLeft: 20 + (c.depth - 1) * 28 }}
                >
                  <span className="cpos" title={t('position', { n: index + 1 })}>
                    {index + 1}
                  </span>
                  <div className="grow">
                    <div className="cname">{c.name}</div>
                    <div className="sm muted" style={{ fontWeight: 600 }}>
                      <code>{c.slug}</code>
                      {' · '}
                      {t('level', { depth: c.depth })}
                      {parent ? ` · ${t('inside', { parent: parent.name })}` : ''}
                    </div>
                    {c.description ? (
                      <div className="sm muted" style={{ fontWeight: 500 }}>
                        {c.description}
                      </div>
                    ) : null}
                  </div>
                  {c.effectivelyVisible ? (
                    <Pill zone="bo" tone="success">
                      {t('visible')}
                    </Pill>
                  ) : hiddenByAncestor ? (
                    <Pill zone="bo" tone="warning">
                      {t('hiddenByParent')}
                    </Pill>
                  ) : (
                    <Pill zone="bo" tone="muted">
                      {t('inactive')}
                    </Pill>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={!canUpdate}
                    aria-label={t(c.active ? 'deactivateLabel' : 'activateLabel', { name: c.name })}
                    onClick={() => setDialog({ kind: 'status', id: c.id })}
                  >
                    {t(c.active ? 'deactivate' : 'activate')}
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    disabled={!canUpdate}
                    aria-label={t('edit', { name: c.name })}
                    onClick={() => setDialog({ kind: 'edit', id: c.id })}
                  >
                    <IconPencil size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    disabled={!canCreate || !c.active || c.depth >= MAX_CATEGORY_DEPTH}
                    aria-label={t('addChild', { name: c.name })}
                    title={c.depth >= MAX_CATEGORY_DEPTH ? t('maxDepth') : undefined}
                    onClick={() => setDialog({ kind: 'create', parentId: c.id })}
                  >
                    <IconPlus size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="up"
                    aria-label={t('up', { name: c.name })}
                    disabled={!canUpdate || reorder.isPending || index === 0}
                    onClick={() => move(c, -1)}
                  >
                    <IconChevronUp size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="down"
                    aria-label={t('down', { name: c.name })}
                    disabled={!canUpdate || reorder.isPending || index === siblings.length - 1}
                    onClick={() => move(c, 1)}
                  >
                    <IconChevronDown size="sm" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {dialog?.kind === 'create' ? (
        <CategoryFormModal parentId={dialog.parentId} list={list} onClose={close} />
      ) : null}
      {dialog?.kind === 'edit' && target ? (
        <CategoryFormModal category={target} list={list} onClose={close} />
      ) : null}
      {dialog?.kind === 'status' && target ? (
        <ConfirmModal
          title={t(target.active ? 'deactivateTitle' : 'activateTitle', { name: target.name })}
          description={t('statusNow', {
            state: target.effectivelyVisible
              ? t('visible')
              : target.active
                ? t('hiddenByParent')
                : t('inactive'),
          })}
          confirmLabel={t(target.active ? 'deactivate' : 'activate')}
          cancelLabel={t('cancel')}
          pendingLabel={t('saving')}
          danger={target.active}
          pending={update.isPending}
          error={statusError}
          onConfirm={() => confirmStatus(target)}
          onClose={close}
        >
          {statusDescription(target)}
        </ConfirmModal>
      ) : null}
    </div>
  );
}

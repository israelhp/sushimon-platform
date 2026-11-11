'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconGrip, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useBoCategories, useBoProducts, useSaveCategory } from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { errorMessage, isForbidden } from '@/features/bo-orders/error-message';
import { queryKeys } from '@/features/query-keys';
import { cn } from '@/lib/cn';
import { countByCategory, moveId, orderChanges, sortCategories } from '../catalog-view';

/**
 * Pantalla Categorías: orden del menú (subir/bajar con botones, accesible por teclado y con anuncio),
 * visibilidad en la web y alta. Los cambios se guardan por el servicio y la tienda los lee en la misma sesión.
 */
export function CategoriesScreen() {
  const t = useTranslations('backoffice.categories');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const categories = useBoCategories();
  const products = useBoProducts();
  const save = useSaveCategory();

  const [newName, setNewName] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  /** Orden local mientras se guarda (los botones responden al instante). */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const newRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const inflight = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(categories.data);
  useEffect(() => {
    latest.current = categories.data;
  }, [categories.data]);

  const sorted = useMemo(() => sortCategories(categories.data ?? []), [categories.data]);
  const list = useMemo(() => {
    if (!localOrder) return sorted;
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const ordered = localOrder.flatMap((id) => byId.get(id) ?? []);
    return [...ordered, ...sorted.filter((c) => !localOrder.includes(c.id))];
  }, [sorted, localOrder]);
  const counts = useMemo(() => countByCategory(products.data ?? []), [products.data]);

  // Devuelve el foco al botón recién usado: al reordenar, el navegador puede soltarlo.
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

  const persist = (ids: string[]) => {
    inflight.current += 1;
    chain.current = chain.current
      .then(async () => {
        for (const change of orderChanges(latest.current ?? [], ids)) {
          await save.mutateAsync({ id: change.id, input: { sortOrder: change.sortOrder } });
          // Mantener `latest` al día evita reenviar cambios ya aplicados.
          latest.current = (latest.current ?? []).map((c) =>
            c.id === change.id ? { ...c, sortOrder: change.sortOrder } : c,
          );
        }
      })
      .catch((error: unknown) => {
        toast.notify(t('saveError', { message: errorMessage(error) }));
      })
      .finally(async () => {
        inflight.current -= 1;
        if (inflight.current === 0) {
          await qc.invalidateQueries({ queryKey: queryKeys.backoffice.categories });
          setLocalOrder(null);
        }
      });
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = list.map((c) => c.id);
    const next = moveId(ids, id, dir);
    if (!next) return;
    const name = list.find((c) => c.id === id)?.name ?? '';
    setLocalOrder(next);
    focusAfter.current = { id, dir: dir === -1 ? 'up' : 'down' };
    setAnnouncement(t('moved', { name, position: next.indexOf(id) + 1, total: next.length }));
    persist(next);
  };

  const toggleVisible = (id: string, name: string, visible: boolean) => {
    save.mutate(
      { id, input: { visible } },
      {
        onSuccess: () => toast.notify(t(visible ? 'shown' : 'hiddenToast', { name })),
        onError: (error) => toast.notify(t('saveError', { message: errorMessage(error) })),
      },
    );
  };

  const add = () => {
    const name = newName.trim();
    if (!name) {
      setNameInvalid(true);
      toast.notify(t('emptyName'));
      newRef.current?.focus();
      return;
    }
    save.mutate(
      { input: { name } },
      {
        onSuccess: () => {
          setNewName('');
          toast.notify(t('added', { name }));
        },
        onError: (error) => toast.notify(t('saveError', { message: errorMessage(error) })),
      },
    );
  };

  return (
    <div className="page" style={{ maxWidth: 900, animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{t('subtitle')}</div>
        </div>
      </div>
      <form
        className="toolbar"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={newRef}
          className="inp grow"
          style={{ maxWidth: 420 }}
          placeholder={t('newPlaceholder')}
          aria-label={t('newLabel')}
          aria-invalid={nameInvalid}
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            setNameInvalid(false);
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={save.isPending && !!newName}>
          <IconPlus size="sm" />
          {t('add')}
        </button>
      </form>

      {categories.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void categories.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      <section className="card" aria-labelledby="cat-order-title">
        <div className="card-h">
          <h2 id="cat-order-title">{t('listTitle')}</h2>
          <span className="count-chip">{list.length}</span>
        </div>
        <div ref={listRef} style={{ borderTop: '1px solid var(--line)' }} role="list">
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
            <EmptyState zone="bo" title={t('empty')} />
          ) : (
            list.map((c, i) => (
              <div
                key={c.id}
                role="listitem"
                data-cat-id={c.id}
                className={cn('crow', !c.visible && 'off')}
              >
                <IconGrip style={{ color: 'var(--muted)' }} />
                <span className="cpos">{i + 1}</span>
                <div className="grow">
                  <div className="cname">{c.name}</div>
                  <div className="sm muted" style={{ fontWeight: 600 }}>
                    {c.kind === 'happy_hour'
                      ? t('happyHour')
                      : t('productCount', { count: counts.get(c.id) ?? 0 })}
                  </div>
                </div>
                <span className="sw-row">
                  <Switch
                    zone="bo"
                    checked={c.visible}
                    label={t('visibleLabel', { name: c.name })}
                    onCheckedChange={(visible) => toggleVisible(c.id, c.name, visible)}
                  />
                  {c.visible ? t('visible') : t('hidden')}
                </span>
                <button
                  type="button"
                  className="icon-btn bordered"
                  data-move="up"
                  aria-label={t('up', { name: c.name })}
                  disabled={i === 0}
                  onClick={() => move(c.id, -1)}
                >
                  <IconChevronUp size="sm" />
                </button>
                <button
                  type="button"
                  className="icon-btn bordered"
                  data-move="down"
                  aria-label={t('down', { name: c.name })}
                  disabled={i === list.length - 1}
                  onClick={() => move(c.id, 1)}
                >
                  <IconChevronDown size="sm" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}

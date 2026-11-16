'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import {
  useAdminModifierGroups,
  useAdminProductModifiers,
  useReplaceProductModifierGroups,
} from '@/features/modifiers/hooks';
import { queryKeys } from '@/features/query-keys';
import { moveWithin } from '@/lib/category-tree';
import { canGlobally } from '@/lib/permissions';
import { PRODUCT_MODIFIER_GROUPS_MAX } from '@/lib/modifier-rules';
import {
  addableGroups,
  canAddMoreGroups,
  modifierServerError,
  ruleText,
  sameIds,
} from '../modifiers-view';

/**
 * Extras de un producto (F12), dentro del editor: grupos asociados en orden, quitar, subir/bajar y añadir grupos ACTIVOS
 * (máx. 10). «Guardar extras» REEMPLAZA la lista completa (`PUT …/modifier-groups`); es independiente de «Guardar producto».
 * Un grupo ya asociado que luego se desactivó puede permanecer (se marca «inactivo» y la tienda no lo ofrece). Escribir exige
 * `catalog.update` con alcance GLOBAL; sin él, solo lectura con aviso (el servidor decide).
 */
export function ProductModifiersSection({ productId }: { productId: string }) {
  const t = useTranslations('backoffice.modifiers.product');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { grants } = useShell();
  const canWrite = canGlobally(grants, 'catalog.update');
  const current = useAdminProductModifiers(productId);
  const available = useAdminModifierGroups({ active: true, pageSize: 100 });
  const replace = useReplaceProductModifierGroups();
  const selectId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  const [ids, setIds] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const saved = current.data?.groups.map((g) => g.id);
  // Sincroniza la lista editable con lo guardado cada vez que llega un resultado NUEVO del servidor (patrón «estado derivado»).
  const [syncedFrom, setSyncedFrom] = useState<typeof current.data>(undefined);
  if (current.data && current.data !== syncedFrom) {
    setSyncedFrom(current.data);
    setIds(current.data.groups.map((g) => g.id));
  }

  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-group-id="${CSS.escape(target.id)}"]`,
    );
    const preferred = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  }, [ids]);

  // Nombres de TODOS los grupos conocidos (asociados + activos disponibles).
  const known = new Map<string, { name: string; min: number; max: number; active: boolean }>();
  for (const g of available.data?.items ?? []) {
    known.set(g.id, { name: g.name, min: g.minSelect, max: g.maxSelect, active: g.active });
  }
  for (const g of current.data?.groups ?? []) {
    known.set(g.id, { name: g.name, min: g.minSelect, max: g.maxSelect, active: g.active });
  }

  if (current.isPending) {
    return (
      <p className="sm muted" aria-busy="true">
        {t('loading')}
      </p>
    );
  }
  if (current.isError || !saved || !ids) {
    return (
      <Banner zone="bo" tone="danger" role="alert">
        {t('error')}{' '}
        <button type="button" className="link-btn" onClick={() => void current.refetch()}>
          {t('retry')}
        </button>
      </Banner>
    );
  }

  const options = addableGroups(available.data?.items ?? [], ids);
  const dirty = !sameIds(saved, ids);
  const full = !canAddMoreGroups(ids);

  const add = () => {
    if (!pick || full) return;
    const name = known.get(pick)?.name ?? '';
    setIds([...ids, pick]);
    setPick('');
    setError('');
    setAnnouncement(t('added', { name }));
  };
  const remove = (id: string) => {
    setIds(ids.filter((x) => x !== id));
    setError('');
    setAnnouncement(t('removed', { name: known.get(id)?.name ?? '' }));
  };
  const move = (id: string, dir: -1 | 1) => {
    const next = moveWithin(ids, id, dir);
    if (!next) return;
    focusAfter.current = { id, dir: dir === -1 ? 'up' : 'down' };
    setIds(next);
    setAnnouncement(
      t('moved', {
        name: known.get(id)?.name ?? '',
        position: next.indexOf(id) + 1,
        total: next.length,
      }),
    );
  };
  const save = () => {
    if (!dirty || replace.isPending) return;
    setError('');
    replace.mutate(
      { productId, groupIds: ids },
      {
        onSuccess: () => toast.notify(t('toastSaved')),
        onError: (e) => {
          const parsed = modifierServerError(e);
          setError(parsed.message);
          if (parsed.reload) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.modifiers.all });
          }
        },
      },
    );
  };

  return (
    <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="flabel">{t('title')}</legend>
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('hint', { max: PRODUCT_MODIFIER_GROUPS_MAX })}
      </span>
      {!canWrite ? (
        <Banner zone="bo" tone="info" role="status">
          {t('readOnly')}
        </Banner>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {ids.length === 0 ? (
        <p className="sm muted m-0">{t('empty')}</p>
      ) : (
        <ul
          ref={listRef}
          className="m-0 flex list-none flex-col gap-2 p-0"
          aria-label={t('listLabel')}
        >
          {ids.map((id, i) => {
            const g = known.get(id);
            const name = g?.name ?? id;
            return (
              <li
                key={id}
                data-group-id={id}
                className="card"
                style={{
                  padding: 8,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div className="cell-main">{name}</div>
                  {g ? <div className="cell-sub">{ruleText(g.min, g.max)}</div> : null}
                </div>
                {g && !g.active ? (
                  <Pill zone="bo" tone="muted">
                    {t('inactive')}
                  </Pill>
                ) : null}
                <span className="row gap8">
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="up"
                    aria-label={t('moveUp', { name })}
                    disabled={!canWrite || i === 0}
                    onClick={() => move(id, -1)}
                  >
                    <IconChevronUp size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="down"
                    aria-label={t('moveDown', { name })}
                    disabled={!canWrite || i === ids.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <IconChevronDown size="sm" />
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('remove', { name })}
                    disabled={!canWrite}
                    onClick={() => remove(id)}
                  >
                    {t('removeShort')}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row gap8" style={{ flexWrap: 'wrap' }}>
        <label className="sr-only" htmlFor={selectId}>
          {t('pickLabel')}
        </label>
        <select
          id={selectId}
          className="inp"
          style={{ maxWidth: 280 }}
          value={pick}
          disabled={!canWrite || full || options.length === 0}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">
            {options.length === 0 ? t('noneAvailable') : t('pickPlaceholder')}
          </option>
          {options.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn sm"
          disabled={!canWrite || !pick || full}
          onClick={add}
        >
          <IconPlus size="sm" />
          {t('add')}
        </button>
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {ids.length}/{PRODUCT_MODIFIER_GROUPS_MAX}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary sm"
          disabled={!canWrite || !dirty || replace.isPending}
          onClick={save}
        >
          {replace.isPending ? t('saving') : t('save')}
        </button>
      </div>
      {error ? (
        <Banner zone="bo" tone="alert" role="alert">
          {error}
        </Banner>
      ) : null}
    </fieldset>
  );
}

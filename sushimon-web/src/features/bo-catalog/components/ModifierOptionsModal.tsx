'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { IconChevronDown, IconChevronUp, IconLayers, IconPencil } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
  useAdminModifierGroup,
  useCreateModifier,
  useReorderModifiers,
  useUpdateModifier,
} from '@/features/modifiers/hooks';
import { queryKeys } from '@/features/query-keys';
import { moveWithin } from '@/lib/category-tree';
import type { AdminModifier } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import {
  MODIFIER_NAME_MAX,
  MODIFIER_OPTIONS_MAX,
  extraPriceToCents,
  normalizeModifierName,
  parseExtraPriceInput,
} from '@/lib/modifier-rules';
import {
  PRICE_MESSAGE,
  modifierServerError,
  ruleText,
  validateOptionName,
} from '../modifiers-view';

const money = (price: string) => formatMoney((extraPriceToCents(price) ?? 0) / 100);

/**
 * Opciones de un grupo (F12): crear (al final), editar nombre y precio extra (cadena decimal en Q), activar/desactivar y
 * reordenar con botones subir/bajar (sin arrastrar: teclado y anuncio `aria-live`, el foco se conserva en el botón usado).
 * Desactivar una opción que deje un grupo activo con menos opciones activas que su mínimo lo rechaza el servidor
 * (`MODIFIER_GROUP_UNSATISFIABLE`). Sin borrado. Solo lectura si falta permiso o alcance global (el servidor decide).
 */
export function ModifierOptionsModal({
  groupId,
  canCreate,
  canUpdate,
  onClose,
}: {
  groupId: string;
  canCreate: boolean;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.modifiers.options');
  const toast = useToast();
  const queryClient = useQueryClient();
  const detail = useAdminModifierGroup(groupId);
  const createOption = useCreateModifier();
  const updateOption = useUpdateModifier();
  const reorder = useReorderModifiers();
  const formId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newErrors, setNewErrors] = useState<{ name?: string; price?: string }>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editErrors, setEditErrors] = useState<{ name?: string; price?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const group = detail.data;
  const options = useMemo(() => group?.options ?? [], [group]);
  const busy = createOption.isPending || updateOption.isPending || reorder.isPending;
  const atLimit = options.length >= MODIFIER_OPTIONS_MAX;

  // Devuelve el foco al botón recién usado: al reordenar, el que se movió puede quedar deshabilitado en un extremo.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-option-id="${CSS.escape(target.id)}"]`,
    );
    const preferred = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  }, [options]);

  const onError = (e: unknown) => {
    const parsed = modifierServerError(e);
    setError(parsed.message);
    if (parsed.reload) void queryClient.invalidateQueries({ queryKey: queryKeys.modifiers.all });
    return parsed;
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const nameProblem = validateOptionName(newName);
    const price = parseExtraPriceInput(newPrice);
    const found = {
      name: nameProblem ?? undefined,
      price: price === null ? PRICE_MESSAGE : undefined,
    };
    setNewErrors(found);
    setError('');
    if (found.name || found.price || price === null) {
      if (found.name) nameRef.current?.focus();
      return;
    }
    createOption.mutate(
      { groupId, input: { name: normalizeModifierName(newName), extraPrice: price } },
      {
        onSuccess: (created) => {
          toast.notify(t('toastCreated', { name: created.name }));
          setNewName('');
          setNewPrice('');
          setNewErrors({});
          nameRef.current?.focus();
        },
        onError: (err) => {
          const parsed = onError(err);
          if (parsed.fields.optionName) setNewErrors({ name: parsed.fields.optionName });
        },
      },
    );
  };

  const startEdit = (o: AdminModifier) => {
    setEditingId(o.id);
    setEditName(o.name);
    setEditPrice(o.extraPrice);
    setEditErrors({});
    setError('');
  };

  const saveEdit = (o: AdminModifier) => {
    if (busy) return;
    const nameProblem = validateOptionName(editName);
    const price = parseExtraPriceInput(editPrice);
    setEditErrors({
      name: nameProblem ?? undefined,
      price: price === null ? PRICE_MESSAGE : undefined,
    });
    setError('');
    if (nameProblem || price === null) return;
    const name = normalizeModifierName(editName);
    const input: { name?: string; extraPrice?: string } = {};
    if (name !== o.name) input.name = name;
    if (price !== o.extraPrice) input.extraPrice = price;
    if (Object.keys(input).length === 0) {
      setEditingId(null);
      return;
    }
    updateOption.mutate(
      { id: o.id, input },
      {
        onSuccess: () => {
          toast.notify(t('toastUpdated', { name }));
          setEditingId(null);
        },
        onError: (err) => {
          const parsed = onError(err);
          if (parsed.fields.optionName) setEditErrors({ name: parsed.fields.optionName });
        },
      },
    );
  };

  const toggle = (o: AdminModifier) => {
    if (busy) return;
    setError('');
    updateOption.mutate(
      { id: o.id, input: { active: !o.active } },
      {
        onSuccess: () =>
          toast.notify(t(o.active ? 'toastDeactivated' : 'toastActivated', { name: o.name })),
        onError,
      },
    );
  };

  const move = (o: AdminModifier, dir: -1 | 1) => {
    if (busy) return;
    const next = moveWithin(
      options.map((x) => x.id),
      o.id,
      dir,
    );
    if (!next) return;
    setError('');
    focusAfter.current = { id: o.id, dir: dir === -1 ? 'up' : 'down' };
    reorder.mutate(
      { groupId, orderedIds: next },
      {
        onSuccess: () =>
          setAnnouncement(
            t('moved', { name: o.name, position: next.indexOf(o.id) + 1, total: next.length }),
          ),
        onError,
      },
    );
  };

  const fieldError = (id: string, text?: string) =>
    text ? (
      <span
        id={id}
        className="xs"
        role="alert"
        style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
      >
        {text}
      </span>
    ) : null;

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconLayers />}
      title={t('title', { name: group?.name ?? '' })}
      description={
        group
          ? `${group.required ? t('required') : t('optional')} · ${ruleText(group.minSelect, group.maxSelect)}`
          : undefined
      }
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('close')}
        </button>
      }
    >
      {detail.isPending ? (
        <div aria-busy="true" aria-label={t('loading')}>
          <Skeleton zone="bo" style={{ height: 48, borderRadius: 12 }} />
        </div>
      ) : detail.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void detail.refetch()}>
            {t('retry')}
          </button>
        </Banner>
      ) : (
        <div className="flex flex-col gap-3">
          {!canUpdate || !canCreate ? (
            <Banner zone="bo" tone="info" role="status">
              {t('readOnly')}
            </Banner>
          ) : null}
          {error ? (
            <Banner zone="bo" tone="alert" role="alert">
              {error}
            </Banner>
          ) : null}
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>

          {options.length === 0 ? (
            <p className="sm muted m-0">{t('empty')}</p>
          ) : (
            <ul
              ref={listRef}
              className="m-0 flex list-none flex-col gap-2 p-0"
              aria-label={t('listLabel')}
            >
              {options.map((o, i) => (
                <li
                  key={o.id}
                  data-option-id={o.id}
                  className="card"
                  style={{
                    padding: 10,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  {editingId === o.id ? (
                    <>
                      <div className="field" style={{ flex: '2 1 160px' }}>
                        <input
                          className="inp"
                          type="text"
                          autoComplete="off"
                          maxLength={MODIFIER_NAME_MAX * 2}
                          aria-label={t('nameOf', { name: o.name })}
                          aria-invalid={editErrors.name ? true : undefined}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                        />
                        {fieldError(`${formId}-e-name`, editErrors.name)}
                      </div>
                      <div className="field" style={{ flex: '1 1 100px' }}>
                        <input
                          className="inp"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={t('priceOf', { name: o.name })}
                          aria-invalid={editErrors.price ? true : undefined}
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                        />
                        {fieldError(`${formId}-e-price`, editErrors.price)}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary sm"
                        disabled={busy}
                        onClick={() => saveEdit(o)}
                      >
                        {t('save')}
                      </button>
                      <button type="button" className="btn sm" onClick={() => setEditingId(null)}>
                        {t('cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: '2 1 160px', minWidth: 0 }}>
                        <div className="cell-main">{o.name}</div>
                        <div className="cell-sub">{t('extra', { price: money(o.extraPrice) })}</div>
                      </div>
                      <Pill zone="bo" tone={o.active ? 'success' : 'muted'}>
                        {o.active ? t('active') : t('inactive')}
                      </Pill>
                      <span className="row gap8">
                        <button
                          type="button"
                          className="icon-btn bordered"
                          data-move="up"
                          aria-label={t('moveUp', { name: o.name })}
                          disabled={!canUpdate || busy || i === 0}
                          onClick={() => move(o, -1)}
                        >
                          <IconChevronUp size="sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn bordered"
                          data-move="down"
                          aria-label={t('moveDown', { name: o.name })}
                          disabled={!canUpdate || busy || i === options.length - 1}
                          onClick={() => move(o, 1)}
                        >
                          <IconChevronDown size="sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn bordered"
                          aria-label={t('edit', { name: o.name })}
                          disabled={!canUpdate || busy}
                          onClick={() => startEdit(o)}
                        >
                          <IconPencil size="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t(o.active ? 'deactivateLabel' : 'activateLabel', {
                            name: o.name,
                          })}
                          disabled={!canUpdate || busy}
                          onClick={() => toggle(o)}
                        >
                          {t(o.active ? 'deactivate' : 'activate')}
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form id={formId} noValidate onSubmit={add} className="card" style={{ padding: 12 }}>
            <div className="flabel" style={{ marginBottom: 6 }}>
              {t('addTitle')}
            </div>
            <div
              className="grid items-start gap-2"
              style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto' }}
            >
              <div className="field">
                <input
                  ref={nameRef}
                  className="inp"
                  type="text"
                  autoComplete="off"
                  maxLength={MODIFIER_NAME_MAX * 2}
                  placeholder={t('namePh')}
                  aria-label={t('newName')}
                  aria-invalid={newErrors.name ? true : undefined}
                  value={newName}
                  disabled={!canCreate}
                  onChange={(e) => setNewName(e.target.value)}
                />
                {fieldError(`${formId}-n-name`, newErrors.name)}
              </div>
              <div className="field">
                <input
                  className="inp"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t('pricePh')}
                  aria-label={t('newPrice')}
                  aria-invalid={newErrors.price ? true : undefined}
                  value={newPrice}
                  disabled={!canCreate}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
                {fieldError(`${formId}-n-price`, newErrors.price)}
              </div>
              <button
                type="submit"
                className="btn btn-primary sm"
                disabled={!canCreate || busy || atLimit}
              >
                {t('add')}
              </button>
            </div>
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('count', { count: options.length, max: MODIFIER_OPTIONS_MAX })}
            </span>
          </form>
        </div>
      )}
    </Modal>
  );
}

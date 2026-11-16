'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconLayers, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCreateModifierGroup, useUpdateModifierGroup } from '@/features/modifiers/hooks';
import { queryKeys } from '@/features/query-keys';
import type { AdminModifierGroupSummary } from '@/lib/data-access/models';
import {
  MODIFIER_MAX_SELECT_LIMIT,
  MODIFIER_NAME_MAX,
  MODIFIER_OPTIONS_MAX,
} from '@/lib/modifier-rules';
import {
  emptyGroupForm,
  firstGroupError,
  groupToForm,
  modifierServerError,
  newOptionRow,
  toCreateGroupRequest,
  toUpdateGroupRequest,
  validateGroupForm,
  type GroupField,
  type GroupFormErrors,
  type GroupFormValues,
} from '../modifiers-view';

type FieldEl = HTMLInputElement | HTMLButtonElement;

/**
 * Alta y edición de un grupo de modificadores (F12): nombre (único sin distinguir mayúsculas), mínimo y máximo de selección
 * (0 ≤ min ≤ max, máx. 1–20; «obligatorio» es DERIVADO: mínimo ≥ 1), estado inicial y, solo al crear, opciones iniciales
 * (nombre + precio extra) para poder crear un grupo obligatorio ya satisfecho. Editar no toca las opciones (se gestionan en su
 * propio diálogo). Los errores del servidor se muestran por campo y en un aviso sin cerrar el modal (por `code`).
 */
export function ModifierGroupModal({
  group,
  onClose,
}: {
  /** Grupo a editar; sin él, alta. */
  group?: AdminModifierGroupSummary;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.modifiers.form');
  const toast = useToast();
  const queryClient = useQueryClient();
  const create = useCreateModifierGroup();
  const update = useUpdateModifierGroup();
  const editing = Boolean(group);
  const pending = create.isPending || update.isPending;

  const [values, setValues] = useState<GroupFormValues>(() =>
    group ? groupToForm(group) : emptyGroupForm(),
  );
  const [errors, setErrors] = useState<GroupFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<Partial<Record<GroupField, FieldEl | null>>>({});
  const formId = useId();
  const inputId = (f: GroupField) => `${formId}-${f}`;
  const errId = (f: GroupField) => `${formId}-${f}-err`;

  const set = (patch: Partial<GroupFormValues>, field?: GroupField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const parsed = modifierServerError(error);
    setErrors({
      name: parsed.fields.name,
      minSelect: parsed.fields.minSelect,
      maxSelect: parsed.fields.maxSelect,
      options: parsed.fields.options,
    });
    setServerError(parsed.message);
    if (parsed.reload) void queryClient.invalidateQueries({ queryKey: queryKeys.modifiers.all });
    const first = firstGroupError(parsed.fields);
    if (first) refs.current[first]?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateGroupForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError('');
    const first = firstGroupError(found);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    if (group) {
      const patch = toUpdateGroupRequest(values, group);
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: group.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(t('toastUpdated', { name: values.name.trim() }));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(toCreateGroupRequest(values), {
      onSuccess: () => {
        toast.notify(t('toastCreated', { name: values.name.trim() }));
        onClose();
      },
      onError: fail,
    });
  };

  const describedBy = (f: GroupField) => (errors[f] ? errId(f) : undefined);
  const fieldError = (f: GroupField) =>
    errors[f] ? (
      <span
        id={errId(f)}
        className="xs"
        role="alert"
        style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
      >
        {errors[f]}
      </span>
    ) : null;

  const patchRow = (key: string, change: { name?: string; price?: string }) =>
    set(
      { options: values.options.map((o) => (o.key === key ? { ...o, ...change } : o)) },
      'options',
    );

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconLayers />}
      title={editing ? t('titleEdit') : t('titleNew')}
      description={group?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('name')}>
            {t('name')}
          </label>
          <input
            id={inputId('name')}
            ref={(el) => {
              refs.current.name = el;
            }}
            className="inp"
            type="text"
            autoComplete="off"
            aria-required="true"
            maxLength={MODIFIER_NAME_MAX * 2}
            value={values.name}
            onChange={(e) => set({ name: e.target.value }, 'name')}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('name')}
          />
          {fieldError('name')}
        </div>

        <div className="field">
          <label className="flabel" htmlFor={inputId('minSelect')}>
            {t('min')}
          </label>
          <input
            id={inputId('minSelect')}
            ref={(el) => {
              refs.current.minSelect = el;
            }}
            className="inp"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-required="true"
            value={values.minSelect}
            onChange={(e) => set({ minSelect: e.target.value }, 'minSelect')}
            aria-invalid={errors.minSelect ? true : undefined}
            aria-describedby={describedBy('minSelect')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('minHint')}
          </span>
          {fieldError('minSelect')}
        </div>

        <div className="field">
          <label className="flabel" htmlFor={inputId('maxSelect')}>
            {t('max')}
          </label>
          <input
            id={inputId('maxSelect')}
            ref={(el) => {
              refs.current.maxSelect = el;
            }}
            className="inp"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-required="true"
            value={values.maxSelect}
            onChange={(e) => set({ maxSelect: e.target.value }, 'maxSelect')}
            aria-invalid={errors.maxSelect ? true : undefined}
            aria-describedby={describedBy('maxSelect')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('maxHint', { max: MODIFIER_MAX_SELECT_LIMIT })}
          </span>
          {fieldError('maxSelect')}
        </div>

        {!editing ? (
          <fieldset
            className="field span-2"
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            aria-describedby={describedBy('options')}
          >
            <legend className="flabel">{t('options')}</legend>
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('optionsHint', { max: MODIFIER_OPTIONS_MAX })}
            </span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('options')}>
              {values.options.map((row, i) => (
                <li
                  key={row.key}
                  className="grid items-start gap-2"
                  style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto' }}
                >
                  <input
                    ref={
                      i === 0
                        ? (el) => {
                            refs.current.options = el;
                          }
                        : undefined
                    }
                    className="inp"
                    type="text"
                    autoComplete="off"
                    maxLength={MODIFIER_NAME_MAX * 2}
                    placeholder={t('optionNamePh')}
                    aria-label={t('optionName', { n: i + 1 })}
                    value={row.name}
                    onChange={(e) => patchRow(row.key, { name: e.target.value })}
                    aria-invalid={errors.options ? true : undefined}
                  />
                  <input
                    className="inp"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={t('optionPricePh')}
                    aria-label={t('optionPrice', { n: i + 1 })}
                    value={row.price}
                    onChange={(e) => patchRow(row.key, { price: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('optionRemove', { n: i + 1 })}
                    onClick={() =>
                      set({ options: values.options.filter((o) => o.key !== row.key) }, 'options')
                    }
                  >
                    {t('optionRemoveShort')}
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <button
                type="button"
                className="btn sm"
                disabled={values.options.length >= MODIFIER_OPTIONS_MAX}
                onClick={() => set({ options: [...values.options, newOptionRow()] }, 'options')}
              >
                <IconPlus size="sm" />
                {t('optionAdd')}
              </button>
              <span className="xs muted" style={{ fontWeight: 600, marginLeft: 8 }}>
                {values.options.length}/{MODIFIER_OPTIONS_MAX}
              </span>
            </div>
            {fieldError('options')}
          </fieldset>
        ) : null}

        {!editing ? (
          <label className="row gap8 span-2">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            <span className="sm" style={{ fontWeight: 700 }}>
              {t('active')}
            </span>
          </label>
        ) : null}
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}

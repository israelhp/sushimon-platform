'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconGrid } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCreateCategory, useUpdateCategory } from '@/features/categories/hooks';
import { queryKeys } from '@/features/query-keys';
import { parentOptions } from '@/lib/category-tree';
import {
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
} from '@/lib/category-tree';
import type { AdminCategory } from '@/lib/data-access/models';
import {
  categoryServerError,
  categoryToForm,
  emptyCategoryForm,
  firstCategoryError,
  toCreateRequest,
  toUpdateRequest,
  validateCategoryForm,
  type CategoryField,
  type CategoryFormErrors,
  type CategoryFormValues,
} from '../categories-view';

/**
 * Alta y edición de una categoría (F10): nombre, slug (vacío al crear = se genera), descripción, padre y estado inicial
 * (alta). En edición cambiar el padre MUEVE la categoría al final de sus nuevos hermanos; activar/desactivar se hace aparte
 * con confirmación. Los errores del servidor (409 slug, 422 ciclo/profundidad/padre, 400, 403, 404) se muestran por campo y en un
 * aviso sin cerrar el modal.
 */
export function CategoryFormModal({
  category,
  parentId,
  list,
  onClose,
}: {
  /** Categoría a editar; sin ella es un alta. */
  category?: AdminCategory;
  /** Padre preseleccionado en un alta (subcategoría). */
  parentId?: string | null;
  list: readonly AdminCategory[];
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.categories.form');
  const toast = useToast();
  const queryClient = useQueryClient();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const editing = Boolean(category);
  const pending = create.isPending || update.isPending;
  const [values, setValues] = useState<CategoryFormValues>(() =>
    category ? categoryToForm(category) : emptyCategoryForm(parentId ?? ''),
  );
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<
    Partial<
      Record<CategoryField, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>
    >
  >({});
  const formId = useId();
  const inputId = (f: CategoryField) => `${formId}-${f}`;
  const errId = (f: CategoryField) => `${formId}-${f}-err`;
  const hintId = (f: CategoryField) => `${formId}-${f}-hint`;

  const options = parentOptions(list, category?.id ?? null);
  // El padre actual se conserva como opción aunque esté inactivo (si no se toca, no se envía).
  const currentParent = category?.parentId ? list.find((c) => c.id === category.parentId) : null;
  const selectable =
    currentParent && !options.some((o) => o.id === currentParent.id)
      ? [currentParent, ...options]
      : options;

  const set = (patch: Partial<CategoryFormValues>, field?: CategoryField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const parsed = categoryServerError(error);
    setErrors(parsed.fields);
    setServerError(parsed.message);
    if (parsed.reload) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
    }
    const first = firstCategoryError(parsed.fields);
    if (first) refs.current[first]?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateCategoryForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError('');
    const first = firstCategoryError(found);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    if (category) {
      const patch = toUpdateRequest(values, category);
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: category.id, input: patch },
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
    create.mutate(toCreateRequest(values), {
      onSuccess: () => {
        toast.notify(t('toastCreated', { name: values.name.trim() }));
        onClose();
      },
      onError: fail,
    });
  };

  const describedBy = (f: CategoryField, hint = false) =>
    [errors[f] ? errId(f) : null, hint ? hintId(f) : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (f: CategoryField) =>
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

  return (
    <Modal
      open
      zone="bo"
      title={editing ? t('editTitle') : t('createTitle')}
      description={category?.name}
      icon={<IconGrid />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : editing ? t('save') : t('create')}
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
            maxLength={CATEGORY_NAME_MAX * 2}
            value={values.name}
            onChange={(e) => set({ name: e.target.value }, 'name')}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('name')}
          />
          {fieldError('name')}
        </div>
        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('slug')}>
            {t('slug')}
          </label>
          <input
            id={inputId('slug')}
            ref={(el) => {
              refs.current.slug = el;
            }}
            className="inp"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={values.slug}
            onChange={(e) => set({ slug: e.target.value }, 'slug')}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={describedBy('slug', true)}
          />
          <span id={hintId('slug')} className="xs muted" style={{ fontWeight: 600 }}>
            {editing ? t('slugHintEdit') : t('slugHintCreate', { max: CATEGORY_SLUG_MAX })}
          </span>
          {fieldError('slug')}
        </div>
        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('parentId')}>
            {t('parent')}
          </label>
          <select
            id={inputId('parentId')}
            ref={(el) => {
              refs.current.parentId = el;
            }}
            className="inp"
            value={values.parentId}
            onChange={(e) => set({ parentId: e.target.value }, 'parentId')}
            aria-invalid={errors.parentId ? true : undefined}
            aria-describedby={describedBy('parentId', true)}
          >
            <option value="">{t('rootOption')}</option>
            {selectable.map((c) => (
              <option key={c.id} value={c.id}>
                {`${'— '.repeat(c.depth - 1)}${c.name}`}
              </option>
            ))}
          </select>
          <span id={hintId('parentId')} className="xs muted" style={{ fontWeight: 600 }}>
            {editing ? t('parentHintEdit') : t('parentHintCreate')}
          </span>
          {fieldError('parentId')}
        </div>
        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('description')}>
            {t('description')}
          </label>
          <textarea
            id={inputId('description')}
            ref={(el) => {
              refs.current.description = el;
            }}
            className="inp"
            rows={3}
            value={values.description}
            onChange={(e) => set({ description: e.target.value }, 'description')}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy('description', true)}
          />
          <span id={hintId('description')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('descriptionHint', { max: CATEGORY_DESCRIPTION_MAX })}
          </span>
          {fieldError('description')}
        </div>
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

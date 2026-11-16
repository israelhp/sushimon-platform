'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconChevronDown, IconChevronUp, IconFork, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { queryKeys } from '@/features/query-keys';
import { useCreateProduct, useUpdateProduct } from '@/features/products/hooks';
import { moveWithin } from '@/lib/category-tree';
import type { AdminCategory, AdminProduct } from '@/lib/data-access/models';
import {
  PRODUCT_ALT_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MEDIA_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SKU_MAX,
  PRODUCT_SLUG_MAX,
} from '@/lib/product-rules';
import {
  emptyProductForm,
  firstProductError,
  newMediaRow,
  productServerError,
  productToForm,
  selectableCategories,
  toCreateRequest,
  toUpdateRequest,
  validateProductForm,
  type ProductField,
  type ProductFormErrors,
  type ProductFormValues,
} from '../products-view';
import { ProductModifiersSection } from './ProductModifiersSection';

interface ProductModalProps {
  /** Producto a editar; sin él, alta. */
  product?: AdminProduct;
  /** Lista plana de categorías de F10 (activas e inactivas, depth-first). */
  categories: readonly AdminCategory[];
  onClose: () => void;
}

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

/**
 * Alta y edición de un producto (F11): nombre, slug (vacío al crear = se genera), SKU opcional, categoría (solo ACTIVAS),
 * precio (cadena decimal; se envía `"85.00"`), descripción de texto plano, estado inicial (alta) y hasta 8 imágenes por URL
 * https con texto alternativo, reordenables. Las imágenes SE REFERENCIAN: la subida de archivos es F14. Editar con `media`
 * REEMPLAZA la lista. Los errores del servidor se muestran por campo y en un aviso sin cerrar el modal (por `code`).
 */
export function ProductModal({ product, categories, onClose }: ProductModalProps) {
  const t = useTranslations('backoffice.products.form');
  const toast = useToast();
  const queryClient = useQueryClient();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const editing = Boolean(product);
  const pending = create.isPending || update.isPending;
  const options = selectableCategories(categories, product?.categoryId);

  const [values, setValues] = useState<ProductFormValues>(() =>
    product ? productToForm(product) : emptyProductForm(options[0]?.id ?? ''),
  );
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<Partial<Record<ProductField, FieldEl | null>>>({});
  const formId = useId();
  const inputId = (f: ProductField) => `${formId}-${f}`;
  const errId = (f: ProductField) => `${formId}-${f}-err`;
  const hintId = (f: ProductField) => `${formId}-${f}-hint`;

  const set = (patch: Partial<ProductFormValues>, field?: ProductField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const parsed = productServerError(error);
    setErrors(parsed.fields);
    setServerError(parsed.message);
    if (parsed.reload) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    }
    const first = firstProductError(parsed.fields);
    if (first) refs.current[first]?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateProductForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError('');
    const first = firstProductError(found);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    if (product) {
      const patch = toUpdateRequest(values, product);
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: product.id, input: patch },
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

  const describedBy = (f: ProductField, hint = false) =>
    [errors[f] ? errId(f) : null, hint ? hintId(f) : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (f: ProductField) =>
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

  const moveRow = (key: string, dir: -1 | 1) => {
    const keys = moveWithin(
      values.media.map((m) => m.key),
      key,
      dir,
    );
    if (!keys) return;
    set({ media: keys.map((k) => values.media.find((m) => m.key === k)!) }, 'media');
  };
  const patchRow = (key: string, change: { url?: string; altText?: string }) =>
    set({ media: values.media.map((m) => (m.key === key ? { ...m, ...change } : m)) }, 'media');

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconFork />}
      title={editing ? t('titleEdit') : t('titleNew')}
      description={product?.name}
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
            maxLength={PRODUCT_NAME_MAX * 2}
            value={values.name}
            onChange={(e) => set({ name: e.target.value }, 'name')}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('name')}
          />
          {fieldError('name')}
        </div>

        <div className="field">
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
            maxLength={PRODUCT_SLUG_MAX}
            value={values.slug}
            onChange={(e) => set({ slug: e.target.value }, 'slug')}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={describedBy('slug', true)}
          />
          <span id={hintId('slug')} className="xs muted" style={{ fontWeight: 600 }}>
            {editing ? t('slugHintEdit') : t('slugHintCreate')}
          </span>
          {fieldError('slug')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={inputId('sku')}>
            {t('sku')}
          </label>
          <input
            id={inputId('sku')}
            ref={(el) => {
              refs.current.sku = el;
            }}
            className="inp"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={PRODUCT_SKU_MAX}
            value={values.sku}
            onChange={(e) => set({ sku: e.target.value }, 'sku')}
            aria-invalid={errors.sku ? true : undefined}
            aria-describedby={describedBy('sku', true)}
          />
          <span id={hintId('sku')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('skuHint')}
          </span>
          {fieldError('sku')}
        </div>

        <div className="field">
          <label className="flabel" htmlFor={inputId('categoryId')}>
            {t('category')}
          </label>
          <select
            id={inputId('categoryId')}
            ref={(el) => {
              refs.current.categoryId = el;
            }}
            className="inp"
            aria-required="true"
            value={values.categoryId}
            onChange={(e) => set({ categoryId: e.target.value }, 'categoryId')}
            aria-invalid={errors.categoryId ? true : undefined}
            aria-describedby={describedBy('categoryId', true)}
          >
            <option value="">{t('categoryPlaceholder')}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {`${'— '.repeat(c.depth - 1)}${c.name}${c.active ? '' : ` (${t('categoryInactive')})`}`}
              </option>
            ))}
          </select>
          <span id={hintId('categoryId')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('categoryHint')}
          </span>
          {fieldError('categoryId')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={inputId('price')}>
            {t('price')}
          </label>
          <span className="inp-prefix">
            <span aria-hidden="true">Q</span>
            <input
              id={inputId('price')}
              ref={(el) => {
                refs.current.price = el;
              }}
              className="inp"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-required="true"
              value={values.price}
              onChange={(e) => set({ price: e.target.value }, 'price')}
              aria-invalid={errors.price ? true : undefined}
              aria-describedby={describedBy('price', true)}
            />
          </span>
          <span id={hintId('price')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('priceHint')}
          </span>
          {fieldError('price')}
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
            {t('descriptionHint', { max: PRODUCT_DESCRIPTION_MAX })}
          </span>
          {fieldError('description')}
        </div>

        <fieldset
          className="field span-2"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          aria-describedby={describedBy('media', true)}
        >
          <legend className="flabel">{t('media')}</legend>
          <span id={hintId('media')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('mediaHint', { max: PRODUCT_MEDIA_MAX })}
          </span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('media')}>
            {values.media.map((row, i) => (
              <li
                key={row.key}
                className="grid items-start gap-2"
                style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto' }}
              >
                <input
                  ref={
                    i === 0
                      ? (el) => {
                          refs.current.media = el;
                        }
                      : undefined
                  }
                  className="inp"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://"
                  aria-label={t('mediaUrl', { n: i + 1 })}
                  value={row.url}
                  onChange={(e) => patchRow(row.key, { url: e.target.value })}
                  aria-invalid={errors.media ? true : undefined}
                />
                <input
                  className="inp"
                  type="text"
                  autoComplete="off"
                  maxLength={PRODUCT_ALT_MAX * 2}
                  placeholder={t('mediaAltPlaceholder')}
                  aria-label={t('mediaAlt', { n: i + 1 })}
                  value={row.altText}
                  onChange={(e) => patchRow(row.key, { altText: e.target.value })}
                />
                <span className="row gap8">
                  <button
                    type="button"
                    className="icon-btn bordered"
                    aria-label={t('mediaUp', { n: i + 1 })}
                    disabled={i === 0}
                    onClick={() => moveRow(row.key, -1)}
                  >
                    <IconChevronUp size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    aria-label={t('mediaDown', { n: i + 1 })}
                    disabled={i === values.media.length - 1}
                    onClick={() => moveRow(row.key, 1)}
                  >
                    <IconChevronDown size="sm" />
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('mediaRemove', { n: i + 1 })}
                    onClick={() =>
                      set({ media: values.media.filter((m) => m.key !== row.key) }, 'media')
                    }
                  >
                    {t('mediaRemoveShort')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              className="btn sm"
              disabled={values.media.length >= PRODUCT_MEDIA_MAX}
              onClick={() => set({ media: [...values.media, newMediaRow()] }, 'media')}
            >
              <IconPlus size="sm" />
              {t('mediaAdd')}
            </button>
            <span className="xs muted" style={{ fontWeight: 600, marginLeft: 8 }}>
              {values.media.length}/{PRODUCT_MEDIA_MAX}
            </span>
          </div>
          {fieldError('media')}
        </fieldset>

        {product ? <ProductModifiersSection productId={product.id} /> : null}

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

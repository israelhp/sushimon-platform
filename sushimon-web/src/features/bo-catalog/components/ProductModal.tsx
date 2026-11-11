'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { BoProductArt, IconFork } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useSaveProduct } from '@/features/backoffice/hooks';
import { errorMessage } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import type { Branch, Category, Product } from '@/lib/data-access/models';
import {
  categoryLook,
  emptyProductForm,
  parsePrice,
  productToForm,
  validateProductForm,
  type ProductField,
  type ProductFormError,
  type ProductFormValues,
} from '../catalog-view';

interface ProductModalProps {
  /** Producto a editar; sin él, alta. */
  product?: Product;
  /** Categorías de productos (sin Happy Hour), en el orden del menú. */
  categories: readonly Category[];
  /** Sucursales activas. */
  branches: readonly Branch[];
  onClose: () => void;
}

/** Modal Producto (alta/edición, solo admin): validación accesible, foco al primer error. */
export function ProductModal({ product, categories, branches, onClose }: ProductModalProps) {
  const t = useTranslations('backoffice.products.form');
  const tp = useTranslations('backoffice.products');
  const toast = useToast();
  const save = useSaveProduct();
  const ids = useId();
  const branchIds = branches.map((b) => b.id);

  const [values, setValues] = useState<ProductFormValues>(() =>
    product
      ? productToForm(product, branchIds)
      : emptyProductForm(categories[0]?.id ?? '', branchIds),
  );
  const [errors, setErrors] = useState<ProductFormError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const focusField = (field: ProductField) =>
    ({ name: nameRef, price: priceRef, categoryId: categoryRef })[field].current?.focus();

  const patch = (change: Partial<ProductFormValues>) => {
    setValues((v) => ({ ...v, ...change }));
    setErrors([]);
    setServerError(null);
  };

  const invalid = (field: ProductField) => errors.some((e) => e.field === field);
  const firstError = errors[0];
  const bannerId = `${ids}-error`;
  const describe = (field: ProductField) => (invalid(field) ? bannerId : undefined);
  const look = categoryLook(values.categoryId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateProductForm(values);
    setErrors(found);
    setServerError(null);
    if (found[0]) {
      focusField(found[0].field);
      return;
    }
    const category = categories.find((c) => c.id === values.categoryId);
    try {
      await save.mutateAsync({
        id: product?.id,
        input: {
          name: values.name.trim(),
          nameEn: values.nameEn.trim(),
          description: values.description.trim(),
          descriptionEn: values.descriptionEn.trim(),
          price: parsePrice(values.price) ?? 0,
          categoryId: values.categoryId,
          featured: values.featured,
          availability: branches.map((b) => ({
            branchId: b.id,
            available: values.availability[b.id] ?? false,
          })),
          ...(product ? {} : { illustration: category?.illustration ?? 'roll' }),
        },
      });
      toast.notify(tp(product ? 'toast.updated' : 'toast.created'));
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  };

  const message = firstError ? t(`errors.${firstError.code}`) : serverError;

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconFork />}
      title={product ? t('titleEdit') : t('titleNew')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            form={`${ids}-form`}
            className="btn btn-primary"
            disabled={save.isPending}
          >
            {save.isPending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={`${ids}-form`} noValidate onSubmit={submit} style={{ display: 'contents' }}>
        <div className="photo-drop">
          <div className={cn('photo-prev', look.tile)}>
            <BoProductArt kind={look.art} variant="thumb" strokeWidth={6} />
          </div>
          <div
            className="grow"
            style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}
          >
            <div className="strong">{t('photo')}</div>
            <div className="sm muted" style={{ fontWeight: 600 }}>
              {t('photoHint')}
            </div>
            <button type="button" className="btn sm" onClick={() => toast.notify(t('uploadToast'))}>
              {t('upload')}
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field span-2">
            <span className="flabel">{t('name')}</span>
            <input
              ref={nameRef}
              className="inp"
              value={values.name}
              aria-required="true"
              aria-invalid={invalid('name')}
              aria-describedby={describe('name')}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label className="field span-2">
            <span className="flabel">{t('nameEn')}</span>
            <input
              className="inp"
              lang="en"
              value={values.nameEn}
              onChange={(e) => patch({ nameEn: e.target.value })}
            />
          </label>
          <label className="field span-2">
            <span className="flabel">{t('description')}</span>
            <textarea
              className="inp"
              value={values.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <label className="field span-2">
            <span className="flabel">{t('descriptionEn')}</span>
            <textarea
              className="inp"
              lang="en"
              value={values.descriptionEn}
              onChange={(e) => patch({ descriptionEn: e.target.value })}
            />
          </label>
          <div className="field span-2">
            <span className="flabel" id={`${ids}-cat`}>
              {t('category')}
            </span>
            <div className="chips" role="group" aria-labelledby={`${ids}-cat`}>
              {categories.map((c, i) => (
                <button
                  key={c.id}
                  ref={i === 0 ? categoryRef : undefined}
                  type="button"
                  className={cn('chip', values.categoryId === c.id && 'on')}
                  aria-pressed={values.categoryId === c.id}
                  aria-describedby={describe('categoryId')}
                  onClick={() => patch({ categoryId: c.id })}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="flabel">{t('price')}</span>
            <span className="inp-prefix">
              <span aria-hidden="true">Q</span>
              <input
                ref={priceRef}
                className="inp"
                type="number"
                min="0"
                step="0.50"
                inputMode="decimal"
                value={values.price}
                aria-required="true"
                aria-invalid={invalid('price')}
                aria-describedby={describe('price')}
                onChange={(e) => patch({ price: e.target.value })}
              />
            </span>
          </label>
          <div className="field">
            <span className="flabel">{t('featured')}</span>
            <span className="sw-row">
              <Switch
                zone="bo"
                checked={values.featured}
                onCheckedChange={(featured) => patch({ featured })}
                label={t('featured')}
              />
              <span className="xs muted" style={{ fontWeight: 700 }}>
                {t('featuredHint')}
              </span>
            </span>
          </div>
        </div>

        <div className="field">
          <span className="flabel">{t('availability')}</span>
          <div className="info-list">
            {branches.map((b) => {
              const on = values.availability[b.id] ?? false;
              return (
                <div className="brsw" key={b.id}>
                  <div className="grow">
                    <div className="strong">{b.name}</div>
                    <div className="xs muted" style={{ fontWeight: 700 }}>
                      {b.zoneLabel}
                    </div>
                  </div>
                  <span className="sw-row">
                    <Switch
                      zone="bo"
                      checked={on}
                      label={tp('switchLabel', { name: b.name })}
                      onCheckedChange={(next) =>
                        patch({ availability: { ...values.availability, [b.id]: next } })
                      }
                    />
                    {on ? tp('stateOn') : tp('stateOff')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {message ? (
          <Banner zone="bo" tone="alert" role="alert" id={bannerId} icon={null}>
            {message}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}

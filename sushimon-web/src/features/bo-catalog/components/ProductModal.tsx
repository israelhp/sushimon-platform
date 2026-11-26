'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { IconFork } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { queryKeys } from '@/features/query-keys';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isActive } from '@/features/media/media-view';
import { useUploadQueue } from '@/features/media/use-upload-queue';
import { useAdminProduct, useCreateProduct, useUpdateProduct } from '@/features/products/hooks';
import type { AdminCategory, AdminProduct } from '@/lib/data-access/models';
import { canGlobally } from '@/lib/permissions';
import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SKU_MAX,
  PRODUCT_SLUG_MAX,
} from '@/lib/product-rules';
import {
  emptyProductForm,
  firstProductError,
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
import { useStagedImages } from '../staged-images';
import { ProductMediaPanel } from './ProductMediaSection';
import { StagedImagesSection } from './StagedImagesSection';
import { ProductBranchesSection } from './ProductBranchesSection';
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
 * precio (cadena decimal; se envía `"85.00"`), descripción de texto plano y estado (activo). Las imágenes (F14) NUNCA viajan en
 * este formulario (no se envía `media`): al EDITAR se gestionan con `ProductMediaPanel` (efecto inmediato); al CREAR se eligen
 * en `StagedImagesSection` (solo navegador) y, con el id devuelto por el alta, se encolan en la cola de F14 (optimizar → intent →
 * PUT → complete → attach). Si el producto se creó pero alguna imagen falla, el modal pasa a EDITAR ese producto (no se vuelve a
 * crear) conservando los archivos fallidos con «Reintentar»/«Quitar». Los errores del servidor se muestran por campo y en un aviso
 * sin cerrar el modal (por `code`).
 */
export function ProductModal({ product, categories, onClose }: ProductModalProps) {
  const t = useTranslations('backoffice.products.form');
  const tm = useTranslations('backoffice.media');
  const toast = useToast();
  const queryClient = useQueryClient();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const { grants } = useShell();
  const canWriteMedia = canGlobally(grants, 'catalog.update');
  // Alta: al crear, el producto recién devuelto pasa a ser «el producto» del modal (edición) y se mantiene fresco por consulta.
  const [created, setCreated] = useState<AdminProduct | null>(null);
  const liveCreated = useAdminProduct(created?.id, created ?? undefined).data;
  const current: AdminProduct | undefined = product ?? liveCreated ?? created ?? undefined;
  const editing = Boolean(current);
  const staged = useStagedImages();
  const queue = useUploadQueue(current?.id, current?.media.length ?? 0);
  const createLock = useRef(false);
  const [handedOff, setHandedOff] = useState(false);
  const sawFailure = useRef(false);
  const closed = useRef(false);
  const uploading = queue.items.some((i) => isActive(i.status));
  const failedCount = queue.items.filter((i) => i.status === 'error').length;
  const doneCount = queue.items.filter((i) => i.status === 'done').length;
  const pending = create.isPending || update.isPending || uploading;
  const options = selectableCategories(categories, current?.categoryId);

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
    // El producto ya no existe: al recargar la lista el editor se desmonta y el aviso del modal se perdería; va también en un aviso.
    if (parsed.kind === 'notFound') toast.notify(parsed.message, { tone: 'warn' });
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
    if (current) {
      const patch = toUpdateRequest(values, current);
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: current.id, input: patch },
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
    // Un solo producto aunque pulsen dos veces: el candado cubre el hueco antes de que `isPending` se refleje.
    if (createLock.current) return;
    createLock.current = true;
    create.mutate(toCreateRequest(values), {
      onSuccess: (made) => {
        const name = values.name.trim();
        const files = staged.items;
        if (files.length === 0) {
          toast.notify(t('toastCreated', { name }));
          onClose();
          return;
        }
        if (!canWriteMedia) {
          // Puede crear pero no adjuntar medios (`catalog.update` global): el producto queda creado, sin fallar a medias.
          toast.notify(t('toastCreatedNoMedia', { name }), { tone: 'warn' });
          onClose();
          return;
        }
        // Pasa a edición del producto recién creado y encola las imágenes con su id.
        setCreated(made);
        setValues(productToForm(made));
        setHandedOff(true);
        queue.add(
          files.map((f) => f.file),
          { productId: made.id, altTexts: files.map((f) => f.alt.trim() || null) },
        );
        staged.clear();
        createLock.current = false;
      },
      onError: (error) => {
        createLock.current = false;
        fail(error);
      },
    });
  };

  // Tras el alta con imágenes: si todo se subió, cierra con aviso; si algo falló, se queda en edición (banner + reintentar).
  useEffect(() => {
    if (!handedOff || closed.current || uploading) return;
    if (failedCount > 0) {
      sawFailure.current = true;
      return;
    }
    if (doneCount > 0 && !sawFailure.current) {
      closed.current = true;
      toast.notify(t('toastCreatedWithImages', { name: values.name.trim(), count: doneCount }));
      onClose();
    }
  }, [handedOff, uploading, failedCount, doneCount, toast, t, values.name, onClose]);

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

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconFork />}
      title={editing ? t('titleEdit') : t('titleNew')}
      description={current?.name}
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

        {handedOff && uploading ? (
          <p role="status" aria-live="polite" className="sm span-2" style={{ margin: 0 }}>
            {tm('creatingUploads', { done: doneCount, total: queue.items.length })}
          </p>
        ) : null}
        {handedOff && !uploading && failedCount > 0 ? (
          <Banner zone="bo" tone="warning" role="alert" className="span-2">
            <strong>{tm('createdPartial', { count: failedCount })}</strong>{' '}
            {tm('createdPartialHelp')}
          </Banner>
        ) : null}

        {current ? (
          <ProductMediaPanel product={current} queue={queue} />
        ) : (
          <StagedImagesSection staged={staged} canWrite={canWriteMedia} disabled={pending} />
        )}

        {current ? <ProductModifiersSection productId={current.id} /> : null}
        {current ? <ProductBranchesSection productId={current.id} /> : null}

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
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}

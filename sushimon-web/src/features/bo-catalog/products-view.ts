import { ancestorsOf } from '@/lib/category-tree';
import { isApiError } from '@/lib/data-access/errors';
import type { AdminCategory, AdminProduct, UpdateProductRequest } from '@/lib/data-access/models';
import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SKU_MAX,
  PRODUCT_SLUG_MAX,
  PRODUCT_SLUG_PATTERN,
  hasDisallowedControlChars,
  isValidSku,
  normalizeProductName,
  normalizeSku,
  parsePriceInput,
} from '@/lib/product-rules';
import { errorMessage } from '@/features/bo-orders/error-message';
import type { CreateProductInput } from '@/services/products';

/**
 * F11 — Lógica pura del formulario y de los errores de productos del backoffice. Sin React ni red. El servidor decide siempre:
 * esta validación solo avisa antes de enviar. Los errores de negocio se ramifican por `code` (nunca por `message`).
 */

// ── Formulario ─────────────────────────────────────────────────────────────────────────────

export interface ProductFormValues {
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  /** Texto del campo (`85`, `85.5`, `85,50`): se valida al enviar. */
  price: string;
  description: string;
  active: boolean;
}

/** F14: las imágenes ya no son parte del formulario; se gestionan con `ProductMediaSection` (API de medios, efecto inmediato). */

export const PRODUCT_FIELDS = [
  'name',
  'slug',
  'sku',
  'categoryId',
  'price',
  'description',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductFormErrors = Partial<Record<ProductField, string>>;

export const emptyProductForm = (categoryId = ''): ProductFormValues => ({
  name: '',
  slug: '',
  sku: '',
  categoryId,
  price: '',
  description: '',
  active: true,
});

export const productToForm = (p: AdminProduct): ProductFormValues => ({
  name: p.name,
  slug: p.slug,
  sku: p.sku ?? '',
  categoryId: p.categoryId,
  price: p.basePrice,
  description: p.description ?? '',
  active: p.active,
});

export const NAME_MESSAGE = `Escribe un nombre de 1 a ${PRODUCT_NAME_MAX} caracteres.`;
export const SLUG_MESSAGE = `Usa minúsculas, números y guiones (p. ej. roll-acevichado), hasta ${PRODUCT_SLUG_MAX} caracteres.`;
export const SKU_MESSAGE = `El SKU admite de 1 a ${PRODUCT_SKU_MAX} caracteres: letras, números, punto, guion o guion bajo.`;
export const CATEGORY_MESSAGE = 'Elige una categoría activa.';
export const PRICE_MESSAGE =
  'Escribe un precio mayor a Q0.00 y hasta Q999,999.99 (máximo 2 decimales).';
export const DESCRIPTION_MESSAGE = `La descripción admite hasta ${PRODUCT_DESCRIPTION_MAX} caracteres de texto.`;

/** Mismas reglas que el servidor (forma y rangos) para avisar antes de enviar. `mode` solo cambia el slug (obligatorio al editar). */
export function validateProductForm(
  values: ProductFormValues,
  mode: 'create' | 'edit',
): ProductFormErrors {
  const errors: ProductFormErrors = {};
  const name = normalizeProductName(values.name);
  if (name.length < 1 || name.length > PRODUCT_NAME_MAX) errors.name = NAME_MESSAGE;
  const slug = values.slug.trim();
  if (
    slug === ''
      ? mode === 'edit'
      : !PRODUCT_SLUG_PATTERN.test(slug) || slug.length > PRODUCT_SLUG_MAX
  ) {
    errors.slug = SLUG_MESSAGE;
  }
  const sku = values.sku.trim();
  if (sku !== '' && !isValidSku(sku)) errors.sku = SKU_MESSAGE;
  if (!values.categoryId) errors.categoryId = CATEGORY_MESSAGE;
  if (parsePriceInput(values.price) === null) errors.price = PRICE_MESSAGE;
  if (
    values.description.length > PRODUCT_DESCRIPTION_MAX ||
    hasDisallowedControlChars(values.description)
  ) {
    errors.description = DESCRIPTION_MESSAGE;
  }
  return errors;
}

export const firstProductError = (errors: ProductFormErrors): ProductField | null =>
  PRODUCT_FIELDS.find((f) => errors[f]) ?? null;

/** Alta: el precio ya está validado (`parsePriceInput`). `slug`/`sku` vacíos no se envían (el servidor genera el slug). */
export function toCreateRequest(values: ProductFormValues): CreateProductInput {
  const sku = normalizeSku(values.sku);
  const slug = values.slug.trim();
  return {
    name: normalizeProductName(values.name),
    ...(slug ? { slug } : {}),
    ...(sku ? { sku } : {}),
    description: values.description.trim() || null,
    basePrice: parsePriceInput(values.price) as string,
    categoryId: values.categoryId,
    active: values.active,
  };
}

/** Solo lo que cambió (o `null` si nada): el PATCH exige al menos un campo. Nunca envía `media` (F14: se gestiona aparte). */
export function toUpdateRequest(
  values: ProductFormValues,
  current: AdminProduct,
): UpdateProductRequest | null {
  const patch: UpdateProductRequest = {};
  const name = normalizeProductName(values.name);
  if (name !== current.name) patch.name = name;
  const slug = values.slug.trim();
  if (slug !== current.slug) patch.slug = slug;
  const sku = normalizeSku(values.sku);
  if (sku !== current.sku) patch.sku = sku;
  const description = values.description.trim() || null;
  if (description !== current.description) patch.description = description;
  const price = parsePriceInput(values.price);
  if (price !== null && price !== current.basePrice) patch.basePrice = price;
  if (values.categoryId !== current.categoryId) patch.categoryId = values.categoryId;
  if (values.active !== current.active) patch.active = values.active;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ── Filtros y presentación ─────────────────────────────────────────────────────────────────

export type ProductStatusFilter = 'all' | 'active' | 'inactive';

export const statusToActive = (s: ProductStatusFilter): boolean | undefined =>
  s === 'all' ? undefined : s === 'active';

/** Por qué un producto no se ve en la tienda: inactivo (prioritario) o categoría oculta (ella o un ancestro inactivo). */
export type VisibilityReason = 'visible' | 'inactive' | 'categoryHidden';

export function visibilityReason(
  p: Pick<AdminProduct, 'active' | 'publiclyVisible'>,
): VisibilityReason {
  if (p.publiclyVisible) return 'visible';
  return p.active ? 'categoryHidden' : 'inactive';
}

/** Slugs de la categoría del producto y de sus ancestros (para el arte): la cadena se arma con la lista admin de F10. */
export function categorySlugChain(
  product: Pick<AdminProduct, 'categoryId' | 'category'>,
  categories: readonly AdminCategory[],
): string[] {
  return [product.category.slug, ...ancestorsOf(categories, product.categoryId).map((c) => c.slug)];
}

/**
 * Categorías elegibles en el formulario: solo ACTIVAS (el servidor rechaza una inactiva al crear o cambiar la categoría); al
 * editar se conserva la actual aunque esté inactiva (si no se toca, no se envía).
 */
export function selectableCategories(
  categories: readonly AdminCategory[],
  currentId?: string,
): AdminCategory[] {
  return categories.filter((c) => c.active || c.id === currentId);
}

// ── Errores del servidor ───────────────────────────────────────────────────────────────────

export type ProductErrorKind =
  | 'slugTaken'
  | 'skuTaken'
  | 'categoryInvalid'
  | 'mediaInvalid'
  | 'busy'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'notFound'
  | 'other';

export interface ProductServerError {
  kind: ProductErrorKind;
  message: string;
  fields: ProductFormErrors;
  /** Hay que volver a pedir datos (el producto o las categorías cambiaron en otra sesión). */
  reload: boolean;
}

const result = (
  kind: ProductErrorKind,
  message: string,
  fields: ProductFormErrors = {},
  reload = false,
): ProductServerError => ({ kind, message, fields, reload });

export const BUSY_MESSAGE = 'Hay otra edición en curso. Espera un momento y reintenta.';

/**
 * 409 `PRODUCT_SLUG_TAKEN` | `PRODUCT_SKU_TAKEN`; 422 `PRODUCT_CATEGORY_INVALID` | `PRODUCT_MEDIA_INVALID`;
 * 503 `PRODUCTS_BUSY`; 404 `PRODUCT_NOT_FOUND`; 400, 401, 403.
 */
export function productServerError(error: unknown): ProductServerError {
  if (!isApiError(error)) return result('other', errorMessage(error));
  switch (error.businessCode) {
    case 'PRODUCT_SLUG_TAKEN':
      return result(
        'slugTaken',
        'Ya existe un producto con ese slug. Elige otro o déjalo en blanco para generarlo.',
        { slug: 'Este slug ya está en uso.' },
      );
    case 'PRODUCT_SKU_TAKEN':
      return result('skuTaken', 'Ya existe un producto con ese SKU. Usa otro o déjalo en blanco.', {
        sku: 'Este SKU ya está en uso.',
      });
    case 'PRODUCT_CATEGORY_INVALID':
      return result(
        'categoryInvalid',
        'La categoría ya no existe o está desactivada. Se recargó la lista de categorías.',
        { categoryId: 'Elige una categoría activa.' },
        true,
      );
    case 'PRODUCT_MEDIA_INVALID':
      return result(
        'mediaInvalid',
        'Revisa las imágenes: máximo 8 por producto y texto alternativo de hasta 200 caracteres.',
      );
    case 'PRODUCTS_BUSY':
      return result('busy', BUSY_MESSAGE);
    case 'PRODUCT_NOT_FOUND':
      return result('notFound', 'El producto ya no existe. Se recargó la lista.', {}, true);
  }
  if (error.status === 400) {
    const fields: ProductFormErrors = {};
    const keys: Record<string, ProductField> = {
      name: 'name',
      slug: 'slug',
      sku: 'sku',
      description: 'description',
      categoryId: 'categoryId',
      basePrice: 'price',
    };
    for (const detail of error.details ?? []) {
      const key = Object.keys(keys).find(
        (k) => detail.startsWith(`${k}:`) || detail.startsWith(`${k}[`),
      );
      const field = key ? keys[key] : undefined;
      if (field) fields[field] ??= detail.slice(detail.indexOf(':') + 1).trim();
    }
    return result(
      'invalid',
      `Revisa los datos: ${(error.details ?? []).join(' · ') || error.message}`,
      fields,
    );
  }
  if (error.status === 401) {
    return result('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión en el backoffice.');
  }
  if (error.status === 403) {
    return result(
      'forbidden',
      'No tienes permiso para modificar productos: se requiere acceso a todas las sucursales.',
    );
  }
  if (error.status === 404) {
    return result('notFound', 'El producto ya no existe. Se recargó la lista.', {}, true);
  }
  return result('other', errorMessage(error));
}

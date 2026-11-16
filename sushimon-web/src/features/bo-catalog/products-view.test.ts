import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminCategory, AdminProduct } from '@/lib/data-access/models';
import {
  BUSY_MESSAGE,
  categorySlugChain,
  emptyProductForm,
  productServerError,
  productToForm,
  selectableCategories,
  statusToActive,
  toCreateRequest,
  toUpdateRequest,
  validateProductForm,
  visibilityReason,
  type ProductFormValues,
} from './products-view';

const product: AdminProduct = {
  id: 'p1',
  sku: 'ABC-1',
  slug: 'roll-mon',
  name: 'Roll Mon',
  description: 'Texto',
  basePrice: '48.50',
  categoryId: 'c1',
  category: { id: 'c1', slug: 'rolls', name: 'Rolls', active: true, effectivelyVisible: true },
  active: true,
  publiclyVisible: true,
  media: [
    { id: 'm2', url: 'https://a.test/2.jpg', altText: null, sortOrder: 1 },
    { id: 'm1', url: 'https://a.test/1.jpg', altText: 'uno', sortOrder: 0 },
  ],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const valid: ProductFormValues = { ...emptyProductForm('c1'), name: 'Roll Mon', price: '48,5' };

describe('formulario de producto', () => {
  it('productToForm no incluye imágenes (F14: se gestionan aparte)', () => {
    const form = productToForm(product);
    expect(form).not.toHaveProperty('media');
    expect(form).toMatchObject({ price: '48.50', sku: 'ABC-1', active: true });
  });

  it('valida nombre, categoría, precio, slug, SKU y descripción', () => {
    expect(validateProductForm(valid, 'create')).toEqual({});
    const bad = validateProductForm(
      {
        ...valid,
        name: ' ',
        categoryId: '',
        price: '0',
        slug: 'Mal Slug',
        sku: '-x',
        description: 'x'.repeat(2001),
      },
      'create',
    );
    expect(Object.keys(bad).sort()).toEqual([
      'categoryId',
      'description',
      'name',
      'price',
      'sku',
      'slug',
    ]);
    expect(validateProductForm({ ...valid, slug: '' }, 'edit').slug).toBeDefined();
    expect(validateProductForm({ ...valid, slug: '' }, 'create').slug).toBeUndefined();
  });

  it('toCreateRequest: precio "48.50", SKU en mayúsculas, sin slug/SKU vacíos y nunca `media`', () => {
    expect(toCreateRequest(valid)).toEqual({
      name: 'Roll Mon',
      description: null,
      basePrice: '48.50',
      categoryId: 'c1',
      active: true,
    });
    const full = toCreateRequest({
      ...valid,
      slug: ' roll-mon ',
      sku: 'rm-1',
      description: ' d ',
    });
    expect(full).toMatchObject({
      slug: 'roll-mon',
      sku: 'RM-1',
      description: 'd',
    });
    expect(full).not.toHaveProperty('media');
  });

  it('toUpdateRequest envía solo lo cambiado (nunca media); sin cambios => null', () => {
    expect(toUpdateRequest(productToForm(product), product)).toBeNull();
    const form = productToForm(product);
    expect(toUpdateRequest({ ...form, price: '60' }, product)).toEqual({ basePrice: '60.00' });
    expect(toUpdateRequest({ ...form, sku: '', description: '', active: false }, product)).toEqual({
      sku: null,
      description: null,
      active: false,
    });
  });
});

describe('presentación', () => {
  it('motivo de visibilidad: visible, inactivo (prioritario) o categoría oculta', () => {
    expect(visibilityReason({ active: true, publiclyVisible: true })).toBe('visible');
    expect(visibilityReason({ active: false, publiclyVisible: false })).toBe('inactive');
    expect(visibilityReason({ active: true, publiclyVisible: false })).toBe('categoryHidden');
    expect(statusToActive('all')).toBeUndefined();
    expect(statusToActive('active')).toBe(true);
    expect(statusToActive('inactive')).toBe(false);
  });

  const cat = (
    id: string,
    parentId: string | null,
    slug: string,
    active = true,
  ): AdminCategory => ({
    id,
    parentId,
    slug,
    name: slug,
    description: null,
    sortOrder: 0,
    active,
    createdAt: '',
    updatedAt: '',
    depth: parentId ? 2 : 1,
    effectivelyVisible: active,
  });
  const list = [
    cat('r', null, 'rolls'),
    cat('f', 'r', 'rolls-frios'),
    cat('x', null, 'oculta', false),
  ];

  it('cadena de slugs para el arte y categorías elegibles (solo activas + la actual)', () => {
    expect(
      categorySlugChain(
        { categoryId: 'f', category: { ...product.category, slug: 'rolls-frios' } },
        list,
      ),
    ).toEqual(['rolls-frios', 'rolls']);
    expect(selectableCategories(list).map((c) => c.id)).toEqual(['r', 'f']);
    expect(selectableCategories(list, 'x').map((c) => c.id)).toEqual(['r', 'f', 'x']);
  });
});

describe('errores del servidor por code (nunca por message)', () => {
  const api = (status: number, code?: string, details?: string[]) =>
    new ApiError(status, 'x', 'mensaje cualquiera', undefined, details, code);

  it.each([
    ['PRODUCT_SLUG_TAKEN', 409, 'slugTaken', 'slug', false],
    ['PRODUCT_SKU_TAKEN', 409, 'skuTaken', 'sku', false],
    ['PRODUCT_CATEGORY_INVALID', 422, 'categoryInvalid', 'categoryId', true],
  ] as const)('%s', (code, status, kind, field, reload) => {
    const e = productServerError(api(status, code));
    expect(e).toMatchObject({ kind, reload });
    expect(e.fields[field]).toBeDefined();
  });

  it('PRODUCT_MEDIA_INVALID: aviso general sin campo (las imágenes se gestionan aparte)', () => {
    const e = productServerError(api(422, 'PRODUCT_MEDIA_INVALID'));
    expect(e).toMatchObject({ kind: 'mediaInvalid', reload: false, fields: {} });
    expect(e.message).toMatch(/máximo 8/);
  });

  it('PRODUCTS_BUSY, 404, 401, 403, 400 con campos y otros', () => {
    expect(productServerError(api(503, 'PRODUCTS_BUSY'))).toMatchObject({
      kind: 'busy',
      message: BUSY_MESSAGE,
    });
    expect(productServerError(api(404, 'PRODUCT_NOT_FOUND'))).toMatchObject({
      kind: 'notFound',
      reload: true,
    });
    expect(productServerError(api(401))).toMatchObject({ kind: 'unauthorized' });
    expect(productServerError(api(403))).toMatchObject({ kind: 'forbidden' });
    const bad = productServerError(
      api(400, undefined, ['basePrice: cadena inválida', 'media[0]: mala']),
    );
    expect(bad.kind).toBe('invalid');
    expect(Object.keys(bad.fields).sort()).toEqual(['price']);
    expect(productServerError(new Error('x'))).toMatchObject({ kind: 'other', message: 'x' });
  });

  it('el mensaje del servidor no decide: un 409 sin code no es slugTaken', () => {
    expect(productServerError(api(409)).kind).toBe('other');
  });
});

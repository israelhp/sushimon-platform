import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminCategory } from '@/lib/data-access/models';
import {
  categoryServerError,
  categoryToForm,
  emptyCategoryForm,
  firstCategoryError,
  toCreateRequest,
  toUpdateRequest,
  validateCategoryForm,
} from './categories-view';

const current: AdminCategory = {
  id: 'c1',
  parentId: 'p1',
  slug: 'rolls',
  name: 'Rolls',
  description: 'Clásicos',
  sortOrder: 2,
  active: true,
  effectivelyVisible: true,
  depth: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const businessError = (status: number, code: string) =>
  new ApiError(
    status,
    status === 409 ? 'conflict' : 'unprocessable',
    'x',
    undefined,
    undefined,
    code,
  );

describe('formulario de categoría', () => {
  it('valida nombre, slug (opcional al crear, obligatorio al editar) y descripción', () => {
    expect(validateCategoryForm(emptyCategoryForm(), 'create')).toEqual({
      name: expect.any(String),
    });
    expect(validateCategoryForm({ ...emptyCategoryForm(), name: 'Bowls' }, 'create')).toEqual({});
    expect(
      validateCategoryForm({ ...emptyCategoryForm(), name: 'Bowls', slug: 'Mal Slug' }, 'create')
        .slug,
    ).toBeTruthy();
    expect(
      validateCategoryForm({ ...categoryToForm(current), slug: '' }, 'edit').slug,
    ).toBeTruthy();
    expect(
      validateCategoryForm({ ...emptyCategoryForm(), name: 'x'.repeat(81) }, 'create').name,
    ).toBeTruthy();
    expect(
      validateCategoryForm(
        { ...emptyCategoryForm(), name: 'ok', description: 'd'.repeat(501) },
        'create',
      ).description,
    ).toBeTruthy();
    expect(firstCategoryError({ slug: 's', name: 'n' })).toBe('name');
    expect(firstCategoryError({})).toBeNull();
  });

  it('arma las solicitudes: alta mínima y edición solo con lo que cambió', () => {
    expect(toCreateRequest({ ...emptyCategoryForm('p9'), name: '  Bowls  ' })).toEqual({
      name: 'Bowls',
      parentId: 'p9',
      active: true,
    });
    expect(
      toCreateRequest({
        ...emptyCategoryForm(),
        name: 'Bowls',
        slug: ' bowls ',
        description: ' d ',
      }),
    ).toEqual({ name: 'Bowls', slug: 'bowls', description: 'd', parentId: null, active: true });
    const form = categoryToForm(current);
    expect(toUpdateRequest(form, current)).toBeNull();
    expect(
      toUpdateRequest(
        { ...form, name: 'Rolls  de  la casa', parentId: '', active: false },
        current,
      ),
    ).toEqual({
      name: 'Rolls de la casa',
      parentId: null,
      active: false,
    });
    expect(toUpdateRequest({ ...form, description: '  ' }, current)).toEqual({ description: null });
  });
});

describe('mensajes por code (nunca por message)', () => {
  it('mapea cada código de negocio con su campo y recarga cuando corresponde', () => {
    const slug = categoryServerError(businessError(409, 'CATEGORY_SLUG_TAKEN'));
    expect(slug).toMatchObject({ kind: 'slugTaken', reload: false });
    expect(slug.fields.slug).toBeTruthy();
    const cycle = categoryServerError(businessError(422, 'CATEGORY_CYCLE'));
    expect(cycle).toMatchObject({ kind: 'cycle' });
    expect(cycle.fields.parentId).toBeTruthy();
    expect(categoryServerError(businessError(422, 'CATEGORY_DEPTH_EXCEEDED')).kind).toBe('depth');
    const parent = categoryServerError(businessError(422, 'CATEGORY_PARENT_INVALID'));
    expect(parent).toMatchObject({ kind: 'parentInvalid', reload: true });
    expect(categoryServerError(businessError(422, 'CATEGORY_REORDER_MISMATCH'))).toMatchObject({
      kind: 'reorderMismatch',
      reload: true,
    });
    expect(categoryServerError(businessError(422, 'CATEGORY_LIMIT_REACHED')).kind).toBe('limit');
    const busy = categoryServerError(
      new ApiError(503, 'server_error', 'x', undefined, undefined, 'CATEGORIES_BUSY'),
    );
    expect(busy).toMatchObject({ kind: 'busy', reload: false });
    expect(busy.message).toMatch(/otra edición en curso/);
  });

  it('ignora el texto de `message` al decidir', () => {
    const e = new ApiError(
      422,
      'unprocessable',
      'texto cualquiera ciclo',
      undefined,
      undefined,
      'CATEGORY_DEPTH_EXCEEDED',
    );
    expect(categoryServerError(e).kind).toBe('depth');
  });

  it('400 con campos, 401, 403, 404 y errores desconocidos', () => {
    const invalid = categoryServerError(
      new ApiError(400, 'bad_request', 'Datos inválidos', undefined, ['name: entre 1 y 80']),
    );
    expect(invalid.kind).toBe('invalid');
    expect(invalid.fields.name).toBe('entre 1 y 80');
    expect(categoryServerError(new ApiError(401, 'unauthorized', 'x')).kind).toBe('unauthorized');
    expect(categoryServerError(new ApiError(403, 'forbidden', 'x')).kind).toBe('forbidden');
    const nf = categoryServerError(new ApiError(404, 'not_found', 'x'));
    expect(nf).toMatchObject({ kind: 'notFound', reload: true });
    expect(categoryServerError(new Error('boom'))).toMatchObject({
      kind: 'other',
      message: 'boom',
    });
    expect(categoryServerError(new ApiError(0, 'offline', 'sin conexión')).kind).toBe('other');
  });
});

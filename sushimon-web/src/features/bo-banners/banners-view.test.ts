import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminBanner } from '@/lib/data-access/models';
import {
  bannerServerError,
  bannerToForm,
  canAddBanner,
  emptyBannerForm,
  previewBanner,
  toCreateRequest,
  toUpdateRequest,
  validateBannerForm,
  type ImageValue,
} from './banners-view';

const image: ImageValue = {
  assetId: 'asset-1',
  url: 'https://cdn.example/banners/a.webp',
  mimeType: 'image/webp',
  sizeBytes: 5000,
};

const current: AdminBanner = {
  id: 'b1',
  image: { assetId: 'asset-1', url: image.url, mimeType: 'image/webp', sizeBytes: 5000 },
  imageAlt: 'Rolls',
  active: true,
  version: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const apiError = (status: number, businessCode?: string) =>
  new ApiError(status, 'x', 'mensaje del servidor', undefined, undefined, businessCode);

describe('tope de 5', () => {
  it('se puede agregar mientras haya menos de 5', () => {
    expect([0, 3, 4].map(canAddBanner)).toEqual([true, true, true]);
    expect([5, 6].map(canAddBanner)).toEqual([false, false]);
  });
});

describe('formulario', () => {
  it('vacío: sin imagen ni texto y activo', () => {
    expect(emptyBannerForm()).toEqual({ image: null, imageAlt: '', active: true });
  });

  it('bannerToForm copia imagen, texto alternativo y estado', () => {
    expect(bannerToForm(current)).toEqual({ image, imageAlt: 'Rolls', active: true });
  });

  it('valida imagen y texto alternativo (obligatorios, 1..120)', () => {
    expect(validateBannerForm(emptyBannerForm())).toEqual([
      { field: 'image', problem: 'imageRequired' },
      { field: 'imageAlt', problem: 'altEmpty' },
    ]);
    expect(validateBannerForm({ image, imageAlt: 'a'.repeat(121), active: true })).toEqual([
      { field: 'imageAlt', problem: 'altTooLong' },
    ]);
    expect(validateBannerForm({ image, imageAlt: 'a\u0007', active: true })).toEqual([
      { field: 'imageAlt', problem: 'altChars' },
    ]);
    expect(validateBannerForm({ image, imageAlt: ' Texto ', active: false })).toEqual([]);
  });

  it('toCreateRequest envía solo imagen, texto recortado y activo', () => {
    expect(toCreateRequest({ image, imageAlt: '  Rolls  ', active: false })).toEqual({
      imageAssetId: 'asset-1',
      imageAlt: 'Rolls',
      active: false,
    });
  });

  it('toUpdateRequest envía solo lo que cambió con expectedVersion; sin cambios = null', () => {
    expect(toUpdateRequest(bannerToForm(current), current)).toBeNull();
    expect(toUpdateRequest({ ...bannerToForm(current), imageAlt: ' Rolls ' }, current)).toBeNull();
    expect(
      toUpdateRequest({ ...bannerToForm(current), imageAlt: 'Nuevo', active: false }, current),
    ).toEqual({ expectedVersion: 3, imageAlt: 'Nuevo', active: false });
    expect(
      toUpdateRequest(
        { ...bannerToForm(current), image: { ...image, assetId: 'asset-2' } },
        current,
      ),
    ).toEqual({ expectedVersion: 3, imageAssetId: 'asset-2' });
  });
});

describe('vista previa', () => {
  it('null sin imagen; con imagen usa la URL y el texto alternativo recortado', () => {
    expect(previewBanner(emptyBannerForm())).toBeNull();
    expect(previewBanner({ image, imageAlt: ' Rolls ', active: true })).toEqual({
      image: { url: image.url },
      alt: 'Rolls',
    });
  });
});

describe('errores del servidor (por businessCode, no por el texto)', () => {
  const e = (error: unknown) => bannerServerError(error);

  it('409 BANNER_LIMIT_REACHED: recarga y explica el tope', () => {
    expect(e(apiError(409, 'BANNER_LIMIT_REACHED'))).toMatchObject({
      kind: 'limitReached',
      reload: true,
    });
    expect(e(apiError(409, 'BANNER_LIMIT_REACHED')).message).toMatch(/5 banners/);
  });

  it('409 BANNER_VERSION_CONFLICT: recarga y avisa', () => {
    expect(e(apiError(409, 'BANNER_VERSION_CONFLICT'))).toMatchObject({
      kind: 'versionConflict',
      reload: true,
    });
  });

  it('422 de imagen y texto alternativo apuntan a su campo', () => {
    expect(e(apiError(422, 'BANNER_IMAGE_INVALID'))).toMatchObject({
      kind: 'imageInvalid',
      field: 'image',
    });
    expect(e(apiError(422, 'BANNER_ALT_INVALID'))).toMatchObject({
      kind: 'altInvalid',
      field: 'imageAlt',
    });
  });

  it('404, 503, 400, 401, 403 y otros', () => {
    expect(e(apiError(404, 'BANNER_NOT_FOUND'))).toMatchObject({ kind: 'notFound', reload: true });
    expect(e(apiError(503, 'BANNERS_BUSY'))).toMatchObject({ kind: 'busy', reload: false });
    expect(e(apiError(400))).toMatchObject({ kind: 'invalid' });
    expect(e(apiError(401))).toMatchObject({ kind: 'unauthorized' });
    expect(e(apiError(403))).toMatchObject({ kind: 'forbidden' });
    expect(e(apiError(500))).toMatchObject({ kind: 'other', message: 'mensaje del servidor' });
    expect(e(new Error('boom'))).toMatchObject({ kind: 'other', message: 'boom' });
  });
});

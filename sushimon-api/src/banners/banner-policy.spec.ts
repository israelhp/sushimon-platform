import {
  bannerCodeOf,
  createdAudit,
  deletedAudit,
  diffState,
  IMAGE_ALT_MAX,
  normalizeAlt,
} from './banner-policy.js';
import type { BannerState } from './banners.types.js';

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

describe('normalizeAlt', () => {
  it('NFC, controles a espacio, espacios colapsados, invisibles eliminados y recorte', () => {
    expect(normalizeAlt('  Roll ​ de\t\n salmón ')).toBe('Roll de salmón');
    expect(normalizeAlt('a­b﻿c')).toBe('abc');
  });

  it('en blanco tras normalizar => 422 BANNER_ALT_INVALID', () => {
    for (const raw of ['', '   ', '​', '\t\n⁠ ']) {
      const e = thrown(() => normalizeAlt(raw));
      expect(status(e)).toBe(422);
      expect(code(e)).toBe('BANNER_ALT_INVALID');
    }
  });

  it('NUL y controles bidireccionales => 400', () => {
    for (const raw of ['a\u0000b', 'a‮b', 'a⁦b']) {
      expect(status(thrown(() => normalizeAlt(raw)))).toBe(400);
    }
  });

  it('120 caracteres pasan; más de 120 tras normalizar => 400', () => {
    expect(normalizeAlt('a'.repeat(IMAGE_ALT_MAX))).toHaveLength(IMAGE_ALT_MAX);
    expect(status(thrown(() => normalizeAlt('a'.repeat(IMAGE_ALT_MAX + 1))))).toBe(400);
  });
});

describe('bannerCodeOf', () => {
  it('banner-<8 hex del id> y cumple el patrón de la columna', () => {
    const c = bannerCodeOf('0a1b2c3d-1111-4222-8333-444455556666');
    expect(c).toBe('banner-0a1b2c3d');
    expect(c).toMatch(/^[a-z0-9][a-z0-9-]{2,63}$/);
  });
});

describe('diffState', () => {
  const before: BannerState = { imageAssetId: 'a1', imageAlt: 'Texto', active: true };

  it('sin cambios => null', () => {
    expect(diffState(before, { ...before })).toBeNull();
  });

  it('imagen y activo: old/new en la auditoría', () => {
    const d = diffState(before, { ...before, imageAssetId: 'a2', active: false });
    expect(d?.scalars).toEqual({ imageAssetId: 'a2', active: false });
    expect(d?.oldValues).toEqual({ imageAssetId: 'a1', active: true });
    expect(d?.newValues).toEqual({ imageAssetId: 'a2', active: false });
  });

  it('solo el alt: se guarda el valor pero la auditoría NO contiene el texto', () => {
    const d = diffState(before, { ...before, imageAlt: 'Otro texto' });
    expect(d?.scalars).toEqual({ imageAlt: 'Otro texto' });
    expect(d?.oldValues).toEqual({});
    expect(d?.newValues).toEqual({ imageAltChanged: true });
    expect(JSON.stringify(d?.newValues)).not.toContain('Otro texto');
  });
});

describe('auditoría de alta y baja', () => {
  it('sin texto ni PII', () => {
    const state = { imageAssetId: 'a1', imageAlt: 'Texto libre', active: false };
    expect(createdAudit('banner-x', state)).toEqual({
      code: 'banner-x',
      imageAssetId: 'a1',
      active: false,
    });
    expect(deletedAudit('banner-x', state)).toEqual({
      code: 'banner-x',
      imageAssetId: 'a1',
      active: false,
    });
  });
});

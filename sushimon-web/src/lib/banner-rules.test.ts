import { describe, expect, it } from 'vitest';
import {
  bannerLifecycle,
  bannersNextChange,
  cleanText,
  compareByPriority,
  hasDisallowedBannerChars,
  hasValidSpanish,
  isBannerCtaType,
  isBannerExpiredByDate,
  isBannerPage,
  moveId,
  normalizeBannerCode,
  resolveTexts,
  sanitizeReason,
  BANNER_CODE_PATTERN,
} from './banner-rules';

const T = (iso: string) => new Date(iso);
const NOW = T('2026-11-11T20:25:00.000Z');

describe('estado derivado (INACTIVE > EXPIRED > SCHEDULED > PUBLISHED)', () => {
  const base = { active: true, startsAt: null, endsAt: null };
  it('precedencia y vigencia [startsAt, endsAt)', () => {
    expect(bannerLifecycle({ ...base, active: false, endsAt: '2020-01-01T00:00:00Z' }, NOW)).toBe(
      'INACTIVE',
    );
    expect(bannerLifecycle({ ...base, endsAt: '2026-11-11T20:25:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(bannerLifecycle({ ...base, endsAt: '2026-11-11T20:25:00.001Z' }, NOW)).toBe('PUBLISHED');
    expect(bannerLifecycle({ ...base, startsAt: '2026-11-11T20:25:00.000Z' }, NOW)).toBe(
      'PUBLISHED',
    );
    expect(bannerLifecycle({ ...base, startsAt: '2026-11-11T20:25:00.001Z' }, NOW)).toBe(
      'SCHEDULED',
    );
    expect(bannerLifecycle(base, NOW)).toBe('PUBLISHED');
  });
  it('vencido por fecha, esté o no activo', () => {
    expect(isBannerExpiredByDate({ endsAt: null }, NOW)).toBe(false);
    expect(isBannerExpiredByDate({ endsAt: '2026-11-11T20:25:00.000Z' }, NOW)).toBe(true);
  });
});

describe('nextChangeAt', () => {
  it('menor instante futuro dentro de 14 días entre banners y cambios de promociones', () => {
    const next = bannersNextChange(
      [
        { startsAt: '2026-11-12T00:00:00Z', endsAt: null },
        { startsAt: null, endsAt: '2026-11-11T21:00:00Z' },
      ],
      [T('2026-11-11T20:30:00Z'), null],
      NOW,
    );
    expect(next?.toISOString()).toBe('2026-11-11T20:30:00.000Z');
  });
  it('ignora pasado y más allá del horizonte; null si no hay', () => {
    expect(
      bannersNextChange(
        [{ startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-06-01T00:00:00Z' }],
        [],
        NOW,
      ),
    ).toBeNull();
    expect(
      bannersNextChange(
        [{ startsAt: '2026-11-25T20:25:00Z', endsAt: null }],
        [],
        NOW,
      )?.toISOString(),
    ).toBe('2026-11-25T20:25:00.000Z');
    expect(
      bannersNextChange([{ startsAt: '2026-11-25T20:25:01Z', endsAt: null }], [], NOW),
    ).toBeNull();
  });
});

describe('textos con respaldo por campo', () => {
  const es = { title: 'Hola', subtitle: 'Sub', ctaLabel: null, imageAlt: 'Alt' };
  it('es: sin respaldo; en: cada campo cae a es si falta o está en blanco', () => {
    expect(resolveTexts(es, null, 'es')?.fallbackFields).toEqual([]);
    const en = { title: 'Hi', subtitle: '  ', ctaLabel: 'Go', imageAlt: null };
    const out = resolveTexts(es, en, 'en')!;
    expect(out).toMatchObject({ title: 'Hi', subtitle: 'Sub', ctaLabel: 'Go', imageAlt: 'Alt' });
    // `ctaLabel` existe en inglés (no es respaldo); un opcional ausente en ambos queda null y no cuenta.
    expect(out.fallbackFields).toEqual(['subtitle', 'imageAlt']);
    expect(resolveTexts({ ...es, ctaLabel: null }, null, 'en')?.fallbackFields).toEqual([
      'title',
      'subtitle',
      'imageAlt',
    ]);
  });
  it('sin es válido no se publica', () => {
    expect(hasValidSpanish({ ...es, title: ' ' })).toBe(false);
    expect(resolveTexts({ ...es, imageAlt: null }, null, 'es')).toBeNull();
  });
  it('cleanText', () => {
    expect(cleanText('  x ')).toBe('x');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(3)).toBeNull();
  });
});

describe('formas', () => {
  it('código, caracteres, CTA y páginas de lista cerrada', () => {
    expect(normalizeBannerCode('  Navidad-2026 ')).toBe('navidad-2026');
    for (const ok of ['abc', 'a1-b2', '0ab']) expect(BANNER_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ['ab', '-ab', 'A-bc', 'a_b', 'a'.repeat(66)])
      expect(BANNER_CODE_PATTERN.test(bad)).toBe(false);
    expect(hasDisallowedBannerChars('ok')).toBe(false);
    expect(hasDisallowedBannerChars('a‮b')).toBe(true);
    expect(hasDisallowedBannerChars('a\u0000b')).toBe(true);
    expect(isBannerCtaType('PAGE')).toBe(true);
    expect(isBannerCtaType('EXTERNAL')).toBe(false);
    expect(isBannerPage('CAREERS')).toBe(true);
    expect(isBannerPage('/admin')).toBe(false);
  });
});

describe('orden', () => {
  it('prioridad, luego antigüedad y luego id', () => {
    const items = [
      { id: 'c', sortOrder: 1, createdAt: '2026-01-02' },
      { id: 'b', sortOrder: 1, createdAt: '2026-01-01' },
      { id: 'a', sortOrder: 1, createdAt: '2026-01-01' },
      { id: 'z', sortOrder: 0, createdAt: '2026-05-01' },
    ];
    expect([...items].sort(compareByPriority).map((i) => i.id)).toEqual(['z', 'a', 'b', 'c']);
  });
  it('moveId sube/baja una posición y no se sale de los bordes', () => {
    expect(moveId(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b'], 'x', 'down')).toEqual(['a', 'b']);
  });
});

describe('caracteres invisibles', () => {
  it('se rechazan en los textos y un texto solo de invisibles cuenta como vacío', () => {
    for (const c of ['\u200b', '\u200c', '\u200d', '\u2060', '\u00ad', '\ufeff']) {
      expect(hasDisallowedBannerChars(`a${c}b`), `U+${c.charCodeAt(0).toString(16)}`).toBe(true);
      expect(cleanText(`${c}${c}`)).toBeNull();
      expect(cleanText(` ${c} `)).toBeNull();
    }
    expect(cleanText('hola')).toBe('hola');
    expect(
      hasValidSpanish({ title: '\u200b', subtitle: null, ctaLabel: null, imageAlt: 'x' }),
    ).toBe(false);
    expect(hasDisallowedBannerChars('Año nuevo — ñandú')).toBe(false);
  });

  it('el motivo de un cambio de estado se limpia de NUL, bidi e invisibles', () => {
    expect(sanitizeReason('  cierre\u0000 por\u202e inventario\u200b ')).toBe(
      'cierre por inventario',
    );
    expect(sanitizeReason('\u200b\u0000')).toBeUndefined();
    expect(sanitizeReason(undefined)).toBeUndefined();
    expect(sanitizeReason('x'.repeat(300))).toHaveLength(200);
  });
});

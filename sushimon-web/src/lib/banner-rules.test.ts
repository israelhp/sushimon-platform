import { describe, expect, it } from 'vitest';
import {
  BANNER_ALT_MAX,
  BANNER_LIMIT,
  bannerAltProblem,
  cleanAlt,
  hasDisallowedBannerChars,
} from './banner-rules';

describe('banner-rules (F16 simplificado, ADR-0033)', () => {
  it('límites del contrato: 5 banners y 120 caracteres de texto alternativo', () => {
    expect(BANNER_LIMIT).toBe(5);
    expect(BANNER_ALT_MAX).toBe(120);
  });

  it('cleanAlt recorta; en blanco o solo invisibles = null; no-texto = null', () => {
    expect(cleanAlt('  Rolls  ')).toBe('Rolls');
    expect(cleanAlt('   ')).toBeNull();
    expect(cleanAlt('​‍')).toBeNull();
    expect(cleanAlt(undefined)).toBeNull();
    expect(cleanAlt(3)).toBeNull();
  });

  it('hasDisallowedBannerChars detecta controles, bidi e invisibles', () => {
    expect(hasDisallowedBannerChars('normal con ñ y acentos')).toBe(false);
    expect(hasDisallowedBannerChars('a\u0007b')).toBe(true);
    expect(hasDisallowedBannerChars('a‮b')).toBe(true);
    expect(hasDisallowedBannerChars('a​b')).toBe(true);
  });

  it('bannerAltProblem: válido, vacío, demasiado largo (tras recortar) y caracteres', () => {
    expect(bannerAltProblem('Descripción')).toBeNull();
    expect(bannerAltProblem('a'.repeat(120))).toBeNull();
    expect(bannerAltProblem(`  ${'a'.repeat(120)}  `)).toBeNull();
    expect(bannerAltProblem('a'.repeat(121))).toBe('tooLong');
    expect(bannerAltProblem('')).toBe('empty');
    expect(bannerAltProblem('   ')).toBe('empty');
    expect(bannerAltProblem('a\u0007')).toBe('chars');
  });
});

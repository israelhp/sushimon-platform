import { BadRequestException } from '@nestjs/common';
import {
  buildSearchPatterns,
  earliestIso,
  matchingCategoryIds,
  normalizeSearchText,
  summarize,
  SUMMARY_MAX,
} from './store-policy.js';

const rejected = (raw: unknown) => {
  try {
    normalizeSearchText(raw);
  } catch (e) {
    return e instanceof BadRequestException;
  }
  return false;
};

describe('normalizeSearchText (q hostil)', () => {
  it('recorta, colapsa espacios y normaliza a NFC', () => {
    expect(normalizeSearchText('  roll   california ')).toBe('roll california');
    expect(normalizeSearchText('Salmón')).toBe('Salmón');
  });
  it('2 a 80 caracteres tras recortar', () => {
    expect(rejected('a')).toBe(true);
    expect(rejected('   a   ')).toBe(true);
    expect(rejected('')).toBe(true);
    expect(normalizeSearchText('ab')).toBe('ab');
    expect(normalizeSearchText('a'.repeat(80))).toHaveLength(80);
    expect(rejected('a'.repeat(81))).toBe(true);
    // 80 puntos de código (emoji de 2 unidades UTF-16 cada uno) siguen valiendo 80
    expect(normalizeSearchText('é'.repeat(80))).toHaveLength(80);
    expect(rejected('😀'.repeat(81))).toBe(true);
    expect(rejected('😀😀')).toBe(true); // sin letra ni dígito
  });
  it('NUL, control, tabulador, salto de línea, bidi, ancho cero, guion blando y BOM => rechazo (no se ignoran)', () => {
    for (const bad of [
      'ro\u0000ll',
      'ro\u0001ll',
      'ro\tll',
      'ro\nll',
      'ro\rll',
      'ro\u007fll',
      'ro\u0085ll',
      'ro​ll', // ancho cero
      'ro‍ll',
      'ro‮ll', // override bidi
      'ro⁦ll', // isolate bidi
      'ro­ll', // guion blando
      'ro﻿ll', // BOM
      'ro ll',
      'ro ll',
      'ro\ud800ll', // sustituto suelto
      'roll', // uso privado
    ]) {
      expect(rejected(bad), JSON.stringify(bad)).toBe(true);
    }
  });
  it('selectores de variación, rellenos invisibles y braille vacío => 400', () => {
    for (const bad of [
      'ro\uFE0Fll',
      'ro\uFE00ll',
      'ro\u{E0100}ll',
      'ro\u3164ll',
      'ro\u2800ll',
      'ro\u115Fll',
      'ro\u1160ll',
      'ro\uFFA0ll',
      '\u3164\u3164',
      '\u2800\u2800',
    ]) {
      expect(rejected(bad), JSON.stringify(bad)).toBe(true);
    }
  });
  it('exige al menos una letra o dígito Unicode (visualmente vacía => 400)', () => {
    for (const bad of ['--', '..', '% %', '__', '!?', "''"]) expect(rejected(bad), bad).toBe(true);
    expect(normalizeSearchText('7-')).toBe('7-');
    expect(normalizeSearchText('寿司')).toBe('寿司');
    expect(normalizeSearchText('Ñu')).toBe('Ñu');
  });
  it('no es cadena (arreglo, objeto, número, undefined) => 400', () => {
    for (const bad of [undefined, null, 12, ['a', 'b'], { a: 1 }]) expect(rejected(bad)).toBe(true);
  });
  it('acepta comodines y comillas como texto (se escapan en el patrón)', () => {
    expect(normalizeSearchText("100% 'natural'_")).toBe("100% 'natural'_");
  });
});

describe('buildSearchPatterns', () => {
  it('pliega acentos y mayúsculas y escapa % _ \\', () => {
    const p = buildSearchPatterns('Salmón 100%_\\');
    expect(p.folded).toBe('salmon 100%_\\');
    expect(p.contains).toBe('%salmon 100\\%\\_\\\\%');
    expect(p.prefix).toBe('salmon 100\\%\\_\\\\%');
  });
  it('un intento de inyección es un parámetro: queda literal en el patrón', () => {
    const p = buildSearchPatterns("'; SELECT pg_sleep(9); --");
    expect(p.contains).toBe("%'; select pg\\_sleep(9); --%");
  });
});

describe('matchingCategoryIds', () => {
  it('coincide por contenido del nombre plegado', () => {
    const cats = [
      { id: '1', name: 'Bebidas' },
      { id: '2', name: 'Rolls Fríos' },
      { id: '3', name: 'Sopas' },
    ];
    expect(matchingCategoryIds(cats, 'frio')).toEqual(['2']);
    expect(matchingCategoryIds(cats, 'ebid')).toEqual(['1']);
    expect(matchingCategoryIds(cats, 'zzz')).toEqual([]);
  });
});

describe('summarize', () => {
  it('null sin descripción o solo espacios', () => {
    expect(summarize(null)).toBeNull();
    expect(summarize('  \n ')).toBeNull();
  });
  it('texto corto sin cambios (espacios colapsados)', () => {
    expect(summarize('Con   aguacate\ny pepino')).toBe('Con aguacate y pepino');
    const exact = 'x'.repeat(SUMMARY_MAX);
    expect(summarize(exact)).toBe(exact);
  });
  it('largo: ≤ 160, sin partir palabras y con «…»', () => {
    const text = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(' ');
    const out = summarize(text)!;
    expect(Array.from(out).length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(out.endsWith('…')).toBe(true);
    const body = out.slice(0, -1);
    expect(text.startsWith(body)).toBe(true);
    expect(text.charAt(body.length)).toBe(' '); // cortó en frontera de palabra
  });
  it('una palabra larguísima se corta duro y nunca parte un par sustituto', () => {
    const out = summarize('😀'.repeat(300))!;
    expect(Array.from(out).length).toBe(SUMMARY_MAX);
    expect(out).toBe(`${'😀'.repeat(SUMMARY_MAX - 1)}…`);
  });
});

describe('earliestIso', () => {
  it('mínimo no nulo; null si no hay', () => {
    expect(earliestIso([null, undefined])).toBeNull();
    expect(
      earliestIso(['2026-11-16T20:00:00.000Z', null, '2026-11-16T19:00:00.000Z', 'basura']),
    ).toBe('2026-11-16T19:00:00.000Z');
  });
});

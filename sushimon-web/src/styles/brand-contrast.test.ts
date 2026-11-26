import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contraste WCAG 2.x de las parejas texto/fondo de los tokens de marca (rojo #E94A3F, azul #283479), en claro y oscuro,
 * tienda y backoffice. Lee los valores REALES de las hojas de estilo (no copias): si alguien cambia un token y rompe AA,
 * esta prueba falla antes que axe en el CI. AA = 4,5:1 (texto normal) y 3:1 (texto grande / componentes de UI).
 */

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

const STYLES = join(__dirname);
const storeCss = readFileSync(join(STYLES, 'store-tokens.css'), 'utf8');
const boCss = readFileSync(join(STYLES, 'backoffice.css'), 'utf8');

/** Cuerpo `{…}` del primer bloque cuyo selector (tras salto de línea) coincide exactamente con `selector`. */
function block(css: string, selector: string, mustContain: string): string {
  const re = new RegExp(
    `(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  for (const m of css.matchAll(re)) if (m[1]!.includes(mustContain)) return m[1]!;
  throw new Error(`Bloque no encontrado: ${selector}`);
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function parseColor(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = hex[1]!;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (rgba) return [+rgba[1]!, +rgba[2]!, +rgba[3]!, +rgba[4]!];
  const triplet = /^(\d+) (\d+) (\d+)$/.exec(v);
  if (triplet) return [+triplet[1]!, +triplet[2]!, +triplet[3]!, 1];
  throw new Error(`Color no soportado: ${v}`);
}

const over = (fg: Rgba, bg: Rgb): Rgb =>
  [0, 1, 2].map((i) => Math.round(fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!))) as Rgb;

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Resuelve un token (con alfa sobre `under`) a RGB opaco. */
function resolve(tokens: Record<string, string>, name: string, under?: Rgb): Rgb {
  const v = tokens[name];
  if (!v) throw new Error(`Token inexistente: ${name}`);
  const c = parseColor(v);
  if (c[3] === 1) return [c[0], c[1], c[2]];
  if (!under) throw new Error(`Token translúcido sin fondo: ${name}`);
  return over(c, under);
}

const storeLight = declarations(block(storeCss, ":root,\n[data-zone='store']", '--primary'));
const storeDark = {
  ...storeLight,
  ...declarations(block(storeCss, ".dark,\n.dark [data-zone='store']", '--primary')),
};
const boLight = declarations(block(boCss, "[data-zone='bo']", '--bo-primary:'));
const boDark = {
  ...boLight,
  ...declarations(block(boCss, ".dark [data-zone='bo']", '--bo-primary:')),
};

type Pair = { fg: string; bg: string; min: number; note?: string };

const WHITE = 'WHITE';
function run(
  tokens: Record<string, string>,
  pairs: Pair[],
  underFor?: (bg: string) => Rgb | undefined,
) {
  for (const p of pairs) {
    it(`${p.fg} sobre ${p.bg} >= ${p.min}:1${p.note ? ` (${p.note})` : ''}`, () => {
      const bg = resolve(tokens, p.bg, underFor?.(p.bg));
      const fg = p.fg === WHITE ? ([255, 255, 255] as Rgb) : resolve(tokens, p.fg, bg);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(p.min);
    });
  }
}

describe('Tienda · marca exacta', () => {
  it('usa exactamente #E94A3F y #283479', () => {
    expect(storeLight['--brand-red']).toBe('233 74 63');
    expect(storeLight['--brand-blue']).toBe('40 52 121');
    expect(storeLight['--band-red']).toBe('#e94a3f');
    expect(storeLight['--band-blue']).toBe('#283479');
    expect(storeLight['--tile-coral']).toBe('233 74 63');
    expect(storeLight['--tile-blue']).toBe('40 52 121');
    expect(storeLight['--secondary']).toBe('40 52 121');
    expect(boLight['--bo-brand-red']).toBe('#e94a3f');
    expect(boLight['--bo-band-navy']).toBe('#283479');
    expect(boLight['--bo-sidebar']).toBe('#283479');
  });
  it('ya no queda ningún valor de la marca anterior en los tokens', () => {
    const old = /dc2626|ef4444|b91c1c(?!.*danger)|1f2937|0f172a|2a3646|18223a|220 38 38|239 68 68/i;
    expect(
      storeCss.replace(/--danger:[^;]*;/g, '').replace(/--(?:surface|subtle|sh-)[^;]*;/g, ''),
    ).not.toMatch(old);
  });
});

const storePairs = (t: Record<string, string>): Pair[] => [
  { fg: '--fg', bg: '--bg', min: 4.5 },
  { fg: '--primary', bg: '--bg', min: 4.5 },
  { fg: '--primary', bg: '--surface', min: 4.5 },
  { fg: '--primary', bg: '--subtle', min: 4.5 },
  { fg: '--primary', bg: '--primary-soft', min: 4.5 },
  { fg: '--onprimary', bg: '--primary', min: 4.5 },
  { fg: '--secondary', bg: '--bg', min: 4.5 },
  { fg: '--secondary', bg: '--surface', min: 4.5 },
  { fg: '--secondary', bg: '--subtle', min: 4.5 },
  { fg: '--secondary', bg: '--secondary-soft', min: 4.5 },
  { fg: '--onsecondary', bg: '--secondary', min: 4.5 },
  { fg: '--ondeep', bg: '--deep', min: 4.5 },
  { fg: '--danger', bg: '--surface', min: 4.5 },
  { fg: '--danger', bg: '--danger-soft', min: 4.5 },
  { fg: '--brand-red', bg: '--bg', min: 3, note: 'gráfico/ícono/subrayado' },
  { fg: '--brand-red', bg: '--surface', min: 3, note: 'gráfico/ícono' },
  { fg: '--onprimary', bg: '--primary', min: 4.5 },
  { fg: '--onsecondary', bg: '--secondary', min: 4.5 },
  ...(t === storeLight ? [{ fg: '--hanko', bg: '--hanko-paper', min: 4.5 }] : []),
];

describe('Tienda · tema claro', () => {
  run(storeLight, storePairs(storeLight));
  const bands: Pair[] = [
    { fg: WHITE, bg: '--band-blue', min: 4.5 },
    { fg: WHITE, bg: '--band-blue-2', min: 4.5 },
    {
      fg: WHITE,
      bg: '--band-red',
      min: 3,
      note: 'solo texto grande/negrita: 3,81:1 < AA normal (límite documentado)',
    },
    { fg: WHITE, bg: '--band-red-2', min: 3, note: 'idem' },
    { fg: '--accent', bg: '--band-blue', min: 4.5, note: 'eyebrow ámbar sobre la banda azul' },
  ];
  run(storeLight, bands);
});

describe('Tienda · tema oscuro', () => {
  run(
    storeDark,
    storePairs(storeDark).filter((p) => p.fg !== '--hanko'),
  );
  run(storeDark, [
    { fg: WHITE, bg: '--band-blue', min: 4.5 },
    { fg: WHITE, bg: '--band-blue-2', min: 4.5 },
    { fg: '--fg', bg: '--surface', min: 4.5 },
    { fg: '--muted', bg: '--surface', min: 4.5 },
    { fg: '--accent', bg: '--band-blue', min: 4.5 },
  ]);
});

const boPairs: Pair[] = [
  { fg: '--bo-text', bg: '--bo-bg', min: 4.5 },
  { fg: '--bo-on-primary', bg: '--bo-primary', min: 4.5 },
  { fg: '--bo-on-primary', bg: '--bo-primary-strong', min: 4.5, note: 'hover del botón' },
  { fg: '--bo-primary', bg: '--bo-surface', min: 4.5 },
  { fg: '--bo-brand-text', bg: '--bo-surface', min: 4.5 },
  { fg: '--bo-brand-text', bg: '--bo-bg', min: 4.5 },
  { fg: '--bo-brand-text', bg: '--bo-primary-soft', min: 4.5 },
  { fg: '--bo-red-text', bg: '--bo-surface', min: 4.5, note: 'error/peligro' },
  { fg: '--bo-red-text', bg: '--bo-bg', min: 4.5, note: 'error/peligro' },
  { fg: '--bo-secondary', bg: '--bo-surface', min: 4.5 },
  { fg: '--bo-secondary', bg: '--bo-secondary-soft', min: 4.5 },
  { fg: '--bo-on-secondary', bg: '--bo-secondary', min: 4.5 },
  { fg: '--bo-blue-text', bg: '--bo-surface', min: 4.5 },
  { fg: '--bo-blue-text', bg: '--bo-secondary-soft', min: 4.5 },
  { fg: '--bo-sidebar-text', bg: '--bo-sidebar', min: 4.5 },
  { fg: '--bo-sidebar-muted', bg: '--bo-sidebar', min: 4.5 },
  { fg: '--bo-white', bg: '--bo-band-navy', min: 4.5 },
  { fg: '--bo-white', bg: '--bo-band-navy-2b', min: 4.5 },
  { fg: '--bo-white', bg: '--bo-band-navy-dark', min: 4.5 },
  {
    fg: '--bo-white',
    bg: '--bo-sidebar-active',
    min: 4.5,
    note: 'ítem activo (rojo 30 % sobre azul)',
  },
  { fg: '--bo-white', bg: '--bo-red', min: 3, note: 'banda coral: texto grande (3,81:1)' },
  { fg: '--bo-white', bg: '--bo-band-coral-2', min: 3, note: 'idem' },
];

describe.each([
  ['claro', boLight],
  ['oscuro', boDark],
] as const)('Backoffice · tema %s', (_name, tokens) => {
  const under = (bg: string): Rgb | undefined =>
    bg === '--bo-sidebar-active'
      ? resolve(tokens, '--bo-sidebar')
      : bg.endsWith('-soft')
        ? resolve(tokens, '--bo-surface')
        : undefined;
  run(tokens, boPairs, under);
  it('el logo/ícono de marca (#E94A3F) distingue >= 3:1 del fondo de la página', () => {
    if (tokens === boLight) {
      expect(
        contrast(resolve(tokens, '--bo-brand-red'), resolve(tokens, '--bo-surface')),
      ).toBeGreaterThanOrEqual(3);
    } else {
      expect(
        contrast(resolve(tokens, '--bo-brand-red'), resolve(tokens, '--bo-bg')),
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

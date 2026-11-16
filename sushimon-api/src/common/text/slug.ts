/** Utilidades de slug compartidas por catálogo (F10 categorías, F11 productos). Funciones puras, sin I/O. */

export const SLUG_MAX = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Minúsculas, sin acentos, kebab, ≤ 80. Sin caracteres útiles => `fallback`. */
export function slugifyText(name: string, fallback: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return base === '' ? fallback : base;
}

/** `base`, `base-2`, `base-3`… el primero libre (respeta el máximo de 80 recortando la base). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

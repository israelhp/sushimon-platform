/**
 * F16 — Reglas PURAS de banners simplificados (spec 017 «Simplificación (0023)», ADR-0033). Las usan el adaptador mock (para emular
 * al servidor) y el formulario del backoffice (aviso previo). La autoridad es la API; la tienda NUNCA decide qué banner se
 * publica: muestra lo que devuelve `GET /v1/store/banners`. Sin React ni red.
 *
 * Un banner = imagen + texto alternativo (un solo idioma, 1–120 caracteres) + activo. Orden = creación. Máximo 5 en total.
 */

/** Tope global de banners (activos más inactivos): el 6.º => 409 `BANNER_LIMIT_REACHED`. */
export const BANNER_LIMIT = 5;
/** Longitud máxima del texto alternativo (tras recortar). */
export const BANNER_ALT_MAX = 120;

/** Controles y marcas bidireccionales (misma política que `name/description` de F15). */
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
/** Invisibles (ancho cero, unión, guion blando, BOM, unión de palabras): no se admiten y un texto solo de ellos cuenta como vacío. */
const INVISIBLE_TEXT = /[\u200b\u200c\u200d\u2060\u00ad\ufeff]/;
const INVISIBLE_TEXT_ALL = /[\u200b\u200c\u200d\u2060\u00ad\ufeff]/g;

export const hasDisallowedBannerChars = (value: string): boolean =>
  DISALLOWED_TEXT.test(value) || INVISIBLE_TEXT.test(value);

/** Texto alternativo recortado; en blanco —o solo invisibles— = ausente (`null`). */
export const cleanAlt = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.replace(INVISIBLE_TEXT_ALL, '').trim() === '' ? null : trimmed;
};

export type BannerAltProblem = 'empty' | 'tooLong' | 'chars';

/**
 * Valida el texto alternativo como lo haría el servidor: 1–120 caracteres tras recortar (fuera de rango => 400), sin controles ni
 * invisibles ni en blanco (=> 422 `BANNER_ALT_INVALID`). `null` = válido.
 */
export function bannerAltProblem(value: string): BannerAltProblem | null {
  const trimmed = value.trim();
  if (trimmed.length > BANNER_ALT_MAX) return 'tooLong';
  if (cleanAlt(value) === null) return 'empty';
  if (hasDisallowedBannerChars(trimmed)) return 'chars';
  return null;
}

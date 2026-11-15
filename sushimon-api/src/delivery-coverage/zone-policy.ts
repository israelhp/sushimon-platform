import { BadRequestException } from '@nestjs/common';

/** Máximo de caracteres (puntos de código) de `zoneLabel` TRAS normalizar (D6; CHECK `delivery_zones_label_valid`). */
export const ZONE_LABEL_MAX = 60;
/** Tope de la entrada cruda: solo protege el tamaño del payload; el límite real se aplica tras normalizar. */
export const ZONE_LABEL_INPUT_MAX = 200;

const CONTROL = /\p{Cc}/u;
const MARKS = /\p{M}/gu;

/**
 * Etiqueta legible normalizada (D6): NFC → los separadores de espacio (tab, salto de línea, NBSP…) cuentan como
 * espacio y cualquier secuencia se colapsa a UNO → recorte → vacío = `null` (cobertura general). Conserva
 * mayúsculas y acentos. Un carácter de control que NO sea espacio en blanco => 400; más de 60 caracteres => 400.
 * `null`/`undefined`/blanco => `null`.
 */
export function normalizeZoneLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const spaced = raw.normalize('NFC').replace(/\s+/gu, ' ');
  if (CONTROL.test(spaced)) {
    throw new BadRequestException(['La zona no admite caracteres de control']);
  }
  const label = spaced.trim();
  if (label === '') return null;
  if ([...label].length > ZONE_LABEL_MAX) {
    throw new BadRequestException([`La zona admite como máximo ${ZONE_LABEL_MAX} caracteres`]);
  }
  return label;
}

/**
 * Clave de comparación (D6): etiqueta normalizada → NFD → minúsculas → sin marcas diacríticas. `''` para la
 * cobertura general (etiqueta `null`). NO unifica ceros a la izquierda ni sinónimos (`Zona 4` ≠ `4` ≠ `04`).
 */
export function zoneKeyOf(label: string | null): string {
  if (label === null) return '';
  const key = label.normalize('NFD').toLowerCase().replace(MARKS, '').normalize('NFC');
  if (key.trim() === '') {
    // Etiqueta formada solo por marcas combinantes: no tendría clave distinta de la cobertura general.
    throw new BadRequestException(['La zona no es válida']);
  }
  return key;
}

/** Normaliza una zona recibida y devuelve su etiqueta y su clave. */
export function normalizeZone(raw: string | null | undefined): {
  label: string | null;
  key: string;
} {
  const label = normalizeZoneLabel(raw);
  return { label, key: zoneKeyOf(label) };
}

/** Entrada: 0 a 2 decimales, hasta 5 enteros (tope 99999.99), sin signo, sin ceros a la izquierda ni notación científica. */
export const MONEY_INPUT_PATTERN = /^(0|[1-9][0-9]{0,4})(\.[0-9]{1,2})?$/;
export const MONEY_INPUT_MESSAGE =
  'baseFee debe ser un string decimal con 0 a 2 decimales entre 0 y 99999.99 (p. ej. "15" o "15.00")';

/** `"15"` → `"15.00"`, `"0.1"` → `"0.10"`. Aritmética de texto: nunca `number`. 400 si no cumple el patrón. */
export function normalizeMoney(input: unknown): string {
  if (typeof input !== 'string' || !MONEY_INPUT_PATTERN.test(input)) {
    throw new BadRequestException([MONEY_INPUT_MESSAGE]);
  }
  const [whole = '0', frac = ''] = input.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

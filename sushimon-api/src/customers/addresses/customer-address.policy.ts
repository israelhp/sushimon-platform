/**
 * Reglas de direcciones guardadas del cliente (F05). Funciones puras: sin Nest, sin base de datos.
 * Invariantes (specs/009-customer-addresses, ADR-0014):
 *  - Máximo 10 direcciones por cliente (espejo de la UI del prototipo).
 *  - Duplicado = misma línea normalizada + mismo municipio + misma zona. La etiqueta y la referencia no cuentan.
 *  - Guardar una dirección NO valida cobertura ni tarifa: solo se valida formato y existencia del municipio.
 */

export const ADDRESS_LIMIT = 10;
export const LABEL_MAX = 40;
export const ADDRESS_LINE_MAX = 200;
export const REFERENCE_MAX = 200;
export const ZONE_MAX = 60;

export interface AddressViolation {
  path: string;
  code: string;
  message: string;
}

export type AddressNormalizeResult<T> =
  { ok: true; value: T } | { ok: false; violations: AddressViolation[] };

/** Entrada ya tipada por el DTO (campos ausentes = undefined). Los textos aún sin normalizar. */
export interface AddressFieldsInput {
  label?: string;
  zone?: string | null;
  addressLine?: string;
  referenceNote?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Campos persistibles tras normalizar. `null` = vacío en BD. */
export interface NormalizedAddressFields {
  label: string;
  zone: string | null;
  addressLine: string;
  referenceNote: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Quita caracteres de control, colapsa espacios y recorta. Nunca altera mayúsculas ni tildes. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function charLength(value: string): number {
  return [...value].length;
}

function violation(path: string, code: string, message: string): AddressViolation {
  return { path, code, message };
}

/** Normaliza y valida un conjunto de campos. Valida solo los que llegan definidos (útil para PATCH). */
export function normalizeAddressFields(
  input: AddressFieldsInput,
): AddressNormalizeResult<Partial<NormalizedAddressFields>> {
  const violations: AddressViolation[] = [];
  const value: Partial<NormalizedAddressFields> = {};

  if (input.label !== undefined) {
    const label = normalizeText(input.label);
    if (charLength(label) < 1 || charLength(label) > LABEL_MAX) {
      violations.push(
        violation('label', 'LABEL_LENGTH', `label: debe tener entre 1 y ${LABEL_MAX} caracteres`),
      );
    } else value.label = label;
  }

  if (input.addressLine !== undefined) {
    const line = normalizeText(input.addressLine);
    if (charLength(line) < 1 || charLength(line) > ADDRESS_LINE_MAX) {
      violations.push(
        violation(
          'addressLine',
          'ADDRESS_LINE_LENGTH',
          `addressLine: debe tener entre 1 y ${ADDRESS_LINE_MAX} caracteres`,
        ),
      );
    } else value.addressLine = line;
  }

  if (input.zone !== undefined) {
    const zone = input.zone === null ? '' : normalizeText(input.zone);
    if (charLength(zone) > ZONE_MAX) {
      violations.push(violation('zone', 'ZONE_LENGTH', `zone: máximo ${ZONE_MAX} caracteres`));
    } else value.zone = zone === '' ? null : zone;
  }

  if (input.referenceNote !== undefined) {
    const note = input.referenceNote === null ? '' : normalizeText(input.referenceNote);
    if (charLength(note) > REFERENCE_MAX) {
      violations.push(
        violation(
          'referenceNote',
          'REFERENCE_LENGTH',
          `referenceNote: máximo ${REFERENCE_MAX} caracteres`,
        ),
      );
    } else value.referenceNote = note === '' ? null : note;
  }

  // Coordenadas: el servicio fusiona latitud y longitud antes de llamar, así que siempre van juntas.
  // Ambas nulas = sin coordenadas; una sola nula = error (no se inventa una coordenada).
  if (input.latitude !== undefined || input.longitude !== undefined) {
    const lat = input.latitude ?? null;
    const lng = input.longitude ?? null;
    if ((lat === null) !== (lng === null)) {
      violations.push(
        violation(
          'coordinates',
          'COORDINATES_PAIR',
          'latitude y longitude deben enviarse juntas o ambas nulas',
        ),
      );
    } else {
      if (lat !== null && (lat < -90 || lat > 90)) {
        violations.push(
          violation('latitude', 'LATITUDE_RANGE', 'latitude: debe estar entre -90 y 90'),
        );
      }
      if (lng !== null && (lng < -180 || lng > 180)) {
        violations.push(
          violation('longitude', 'LONGITUDE_RANGE', 'longitude: debe estar entre -180 y 180'),
        );
      }
      if (lat !== null && lng !== null && violations.length === 0) {
        value.latitude = roundCoordinate(lat);
        value.longitude = roundCoordinate(lng);
      } else if (lat === null && lng === null) {
        value.latitude = null;
        value.longitude = null;
      }
    }
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value };
}

/** numeric(10,7): siete decimales, igual que la columna. */
export function roundCoordinate(n: number): number {
  return Number(n.toFixed(7));
}

/**
 * Clave de duplicado: línea en minúsculas (NFC), municipio y zona. La zona vacía y la nula cuentan igual.
 * Dos direcciones con la misma línea en municipios distintos NO son duplicadas.
 */
export function duplicateKey(input: {
  addressLine: string;
  municipalityId: string;
  zone: string | null;
}): string {
  const line = normalizeText(input.addressLine).normalize('NFC').toLowerCase();
  const zone = (input.zone ?? '').normalize('NFC').toLowerCase();
  return `${line}|${input.municipalityId}|${zone}`;
}

/** Límite de direcciones: `count` ya guardadas; se permite crear mientras sea menor que el límite. */
export function canAddAddress(count: number): boolean {
  return count < ADDRESS_LIMIT;
}

import type { RiderOperationalState } from '@/lib/data-access/models';

/**
 * F27 (spec 028 §3.2): reglas de formato y normalización de motoristas, IDÉNTICAS a las del servidor
 * (`sushimon-api/src/riders/rider-policy.ts`). La web las usa para orientar al validar el formulario y el adaptador mock para
 * reproducir la API; el servidor sigue siendo la autoridad (devuelve 400 si algo no cumple).
 */
export const RIDER_PHONE_RE = /^\+502[0-9]{8}$/;
export const RIDER_PLATE_RE = /^[A-Z0-9]{4,10}$/;
export const RIDER_NAME_MIN = 2;
export const RIDER_NAME_MAX = 80;
export const RIDER_REASON_MAX = 200;
export const RIDER_SEARCH_MAX = 80;

export const RIDER_VEHICLE_TYPES = ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT'] as const;

/** NFC, recortado y espacios colapsados. */
export const collapseRiderName = (raw: string): string =>
  raw.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Clave de búsqueda/orden: NFKD sin diacríticos, minúsculas, espacios colapsados. */
export const riderNameKey = (raw: string): string =>
  raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Placa: mayúsculas, sin espacios ni guiones. */
export const normalizeRiderPlate = (raw: string): string =>
  raw.replace(/[\s-]+/gu, '').toUpperCase();

export type RiderNameProblem = 'length' | 'control' | null;

export function riderNameProblem(raw: string): RiderNameProblem {
  const name = collapseRiderName(raw);
  const length = [...name].length;
  if (length < RIDER_NAME_MIN || length > RIDER_NAME_MAX) return 'length';
  if (/\p{Cc}/u.test(name) || riderNameKey(name) === '') return 'control';
  return null;
}

/** `+50255501122` → `+502****1122` (el listado nunca lleva el teléfono completo). */
export const maskRiderPhone = (phone: string): string =>
  `${phone.slice(0, 4)}****${phone.slice(-4)}`;

/** Estado operativo derivado, en el orden del contrato (`INACTIVE` > `UNAVAILABLE` > `BUSY` > `AVAILABLE`). */
export function riderOperationalState(
  active: boolean,
  availability: string,
  busy: boolean,
): RiderOperationalState {
  if (!active) return 'INACTIVE';
  if (availability !== 'AVAILABLE') return 'UNAVAILABLE';
  return busy ? 'BUSY' : 'AVAILABLE';
}

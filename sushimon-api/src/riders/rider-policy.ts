import { BadRequestException } from '@nestjs/common';
import type {
  NewRiderData,
  RiderOperationalStateValue,
  RiderPatchData,
  RiderRecord,
} from './riders.types.js';

/** Reglas de formato y normalización de motoristas (spec 028 §3.2). La FORMA llega validada por los DTO; aquí vive el dominio. */
export const PHONE_RE = /^\+502[0-9]{8}$/;
export const PLATE_RE = /^[A-Z0-9]{4,10}$/;
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const REASON_MAX = 200;

const bad = (message: string) => new BadRequestException([message]);

/** NFC, recortado y espacios colapsados. */
export function collapseName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** `name_key`: NFKD sin diacríticos, minúsculas, espacios colapsados (búsqueda y orden). */
export function nameKeyOf(raw: string): string {
  return raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Nombre validado (2–80, sin caracteres de control) + su clave. Lanza 400 si no cumple. */
export function normalizeFullName(raw: string): { fullName: string; nameKey: string } {
  const fullName = collapseName(raw);
  const length = [...fullName].length;
  if (length < NAME_MIN || length > NAME_MAX) {
    throw bad(`fullName debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres`);
  }
  if (/\p{Cc}/u.test(fullName)) throw bad('fullName no admite caracteres de control');
  const nameKey = nameKeyOf(fullName);
  if (nameKey === '') throw bad('fullName inválido');
  return { fullName, nameKey };
}

/** Teléfono estricto: sin reformatear (lo que no cumple es 400). */
export function assertPhone(phone: string): string {
  if (!PHONE_RE.test(phone)) throw bad('phone debe ser +502 seguido de 8 dígitos');
  return phone;
}

/** Placa: mayúsculas, sin espacios ni guiones; `^[A-Z0-9]{4,10}$`. */
export function normalizePlate(raw: string): string {
  const plate = raw.replace(/[\s-]+/gu, '').toUpperCase();
  if (!PLATE_RE.test(plate)) throw bad('licensePlate inválida (4 a 10 letras o dígitos)');
  return plate;
}

export interface CreateInput {
  branchId: string;
  fullName: string;
  phone: string;
  vehicleType?: string | null;
  licensePlate?: string | null;
}

export function normalizeCreate(input: CreateInput): NewRiderData {
  const name = normalizeFullName(input.fullName);
  return {
    branchId: input.branchId,
    fullName: name.fullName,
    nameKey: name.nameKey,
    phone: assertPhone(input.phone),
    vehicleType: input.vehicleType ?? null,
    licensePlate:
      input.licensePlate === undefined || input.licensePlate === null
        ? null
        : normalizePlate(input.licensePlate),
  };
}

export interface UpdateInput {
  expectedVersion: number;
  fullName?: string;
  phone?: string;
  vehicleType?: string | null;
  licensePlate?: string | null;
  branchId?: string;
}

export interface NormalizedUpdate {
  expectedVersion: number;
  patch: RiderPatchData;
}

/** Al menos un campo editable (si no, 400). `null` borra vehículo/placa. */
export function normalizeUpdate(input: UpdateInput): NormalizedUpdate {
  const patch: RiderPatchData = {};
  if (input.fullName !== undefined) {
    const name = normalizeFullName(input.fullName);
    patch.fullName = name.fullName;
    patch.nameKey = name.nameKey;
  }
  if (input.phone !== undefined) patch.phone = assertPhone(input.phone);
  if (input.vehicleType !== undefined) patch.vehicleType = input.vehicleType;
  if (input.licensePlate !== undefined) {
    patch.licensePlate = input.licensePlate === null ? null : normalizePlate(input.licensePlate);
  }
  if (input.branchId !== undefined) patch.branchId = input.branchId;
  if (Object.keys(patch).length === 0) throw bad('Indica al menos un campo a modificar');
  return { expectedVersion: input.expectedVersion, patch };
}

/** Texto libre de operador para auditoría: recortado; vacío => `null`. */
export function normalizeReason(raw: string | undefined): string | null {
  const reason = raw?.trim() ?? '';
  return reason === '' ? null : reason;
}

/** Clave de búsqueda del listado (`q`): misma normalización que `name_key`; vacía => sin filtro. */
export function normalizeSearch(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = nameKeyOf(raw);
  return key === '' ? undefined : key;
}

/** `+50255501122` => `+502****1122` (el listado nunca entrega el teléfono completo). */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

export function operationalStateOf(
  active: boolean,
  availability: string,
  busy: boolean,
): RiderOperationalStateValue {
  if (!active) return 'INACTIVE';
  if (availability !== 'AVAILABLE') return 'UNAVAILABLE';
  return busy ? 'BUSY' : 'AVAILABLE';
}

/** Nombres de los campos de datos que cambian realmente (para `rider.updated`; nunca sus valores). */
export function changedFieldsOf(current: RiderRecord, patch: RiderPatchData): string[] {
  const changed: string[] = [];
  if (patch.fullName !== undefined && patch.fullName !== current.fullName) changed.push('fullName');
  if (patch.phone !== undefined && patch.phone !== current.phone) changed.push('phone');
  if (patch.vehicleType !== undefined && patch.vehicleType !== current.vehicleType) {
    changed.push('vehicleType');
  }
  if (patch.licensePlate !== undefined && patch.licensePlate !== current.licensePlate) {
    changed.push('licensePlate');
  }
  return changed;
}

import { BadRequestException } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import type { AdminBranchView, BranchPatch, NewBranchData } from './branches.types.js';

/** Normalización y reglas de dominio de sucursales: funciones puras, sin I/O (spec F07 D4/D5). */

export const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CODE_MIN = 2;
export const CODE_MAX = 40;
export const NAME_MAX = 100;
export const ADDRESS_MAX = 300;
export const PHONE_MAX = 25;
export const REASON_MAX = 200;
const PHONE_PATTERN = /^\+?[0-9\s\-()]+$/;
const COORDINATE_DECIMALS = 1e7; // numeric(10,7)

function fail(message: string): never {
  throw new BadRequestException([message]);
}

const collapse = (value: string): string => value.trim().replace(/\s+/g, ' ');

export function normalizeCode(raw: string): string {
  const code = raw.trim().toLowerCase();
  if (code.length < CODE_MIN || code.length > CODE_MAX)
    fail(`code debe tener entre ${CODE_MIN} y ${CODE_MAX} caracteres`);
  if (!CODE_PATTERN.test(code))
    fail('code solo admite minúsculas, números y guiones simples entre grupos (p. ej. zona-10)');
  return code;
}

function normalizeText(raw: string, field: string, max: number): string {
  const value = collapse(raw);
  if (value === '') fail(`${field} no puede estar vacío`);
  if (value.length > max) fail(`${field} no puede superar ${max} caracteres`);
  return value;
}

export const normalizeName = (raw: string): string => normalizeText(raw, 'name', NAME_MAX);
export const normalizeAddress = (raw: string): string => normalizeText(raw, 'address', ADDRESS_MAX);

/** Teléfono opcional: vacío/null = sin teléfono. 7 a 15 dígitos; solo + inicial, espacios, guiones y paréntesis. */
export function normalizePhone(raw: string | null): string | null {
  if (raw === null) return null;
  const phone = collapse(raw);
  if (phone === '') return null;
  const digits = phone.replace(/\D/g, '').length;
  if (phone.length > PHONE_MAX || !PHONE_PATTERN.test(phone) || digits < 7 || digits > 15)
    fail('phone inválido: use 7 a 15 dígitos (admite +, espacios, guiones y paréntesis)');
  return phone;
}

export function normalizeCoordinate(
  raw: number | null,
  field: 'latitude' | 'longitude',
): number | null {
  if (raw === null) return null;
  const limit = field === 'latitude' ? 90 : 180;
  if (!Number.isFinite(raw) || Math.abs(raw) > limit)
    fail(`${field} debe estar entre -${limit} y ${limit}`);
  // Mismo redondeo que numeric(10,7): evita falsos "cambios" al comparar con lo almacenado.
  return Math.round(raw * COORDINATE_DECIMALS) / COORDINATE_DECIMALS;
}

/** Ambas o ninguna (CHECK branches_coordinates_pair). */
export function assertCoordinatePair(latitude: number | null, longitude: number | null): void {
  if ((latitude === null) !== (longitude === null))
    fail('latitude y longitude deben enviarse juntas (ambas o ninguna)');
}

export interface CreateBranchInput {
  code: string;
  name: string;
  address: string;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  active?: boolean;
}

export function normalizeCreate(input: CreateBranchInput): NewBranchData {
  const latitude = normalizeCoordinate(input.latitude ?? null, 'latitude');
  const longitude = normalizeCoordinate(input.longitude ?? null, 'longitude');
  assertCoordinatePair(latitude, longitude);
  return {
    code: normalizeCode(input.code),
    name: normalizeName(input.name),
    address: normalizeAddress(input.address),
    phone: normalizePhone(input.phone ?? null),
    latitude,
    longitude,
    active: input.active ?? true,
  };
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Normaliza solo los campos presentes (`undefined` = omitido = no se toca). Un PATCH vacío es inválido. */
export function normalizeUpdate(input: UpdateBranchInput): BranchPatch {
  const patch: BranchPatch = {};
  if (input.name !== undefined) patch.name = normalizeName(input.name);
  if (input.address !== undefined) patch.address = normalizeAddress(input.address);
  if (input.phone !== undefined) patch.phone = normalizePhone(input.phone);
  if (input.latitude !== undefined)
    patch.latitude = normalizeCoordinate(input.latitude, 'latitude');
  if (input.longitude !== undefined)
    patch.longitude = normalizeCoordinate(input.longitude, 'longitude');
  if (Object.keys(patch).length === 0) fail('Debe enviar al menos un campo a modificar');
  return patch;
}

/** Par de coordenadas resultante de aplicar el parche sobre lo almacenado. */
export function resultingCoordinates(
  current: Pick<AdminBranchView, 'latitude' | 'longitude'>,
  patch: BranchPatch,
): { latitude: number | null; longitude: number | null } {
  return {
    latitude: patch.latitude !== undefined ? patch.latitude : current.latitude,
    longitude: patch.longitude !== undefined ? patch.longitude : current.longitude,
  };
}

export interface BranchDiff {
  /** Solo los campos que realmente cambian. */
  changes: BranchPatch;
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Diff real entre lo almacenado y el parche; `null` si no hay cambios (no se escribe ni se audita). */
export function diffBranch(current: AdminBranchView, patch: BranchPatch): BranchDiff | null {
  const changes: BranchPatch = {};
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  for (const key of Object.keys(patch) as (keyof BranchPatch)[]) {
    const next = patch[key];
    if (next === undefined || next === current[key]) continue;
    (changes as Record<string, string | number | null>)[key] = next;
    oldValues[key] = current[key];
    newValues[key] = next;
  }
  return Object.keys(changes).length === 0 ? null : { changes, oldValues, newValues };
}

export interface StatusInput {
  active: boolean;
  reason?: string;
}

/** Desactivar exige motivo (D6); al activar es opcional. */
export function normalizeStatus(input: StatusInput): { active: boolean; reason: string | null } {
  const reason = input.reason === undefined ? '' : collapse(input.reason);
  if (reason.length > REASON_MAX) fail(`reason no puede superar ${REASON_MAX} caracteres`);
  if (!input.active && reason === '') fail('reason es obligatorio al desactivar una sucursal');
  return { active: input.active, reason: reason === '' ? null : reason };
}

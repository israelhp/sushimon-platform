import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { INSTANT_PATTERN, parseClock, parseInstant } from '../branch-schedule/business-time.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import {
  normalizeDescription as normalizeProductDescription,
  normalizeName as normalizeProductName,
} from '../products/product-policy.js';
import { centsToDecimal, decimalToCents } from './promotion-money.js';
import type {
  PromotionKind,
  PromotionRecord,
  PromotionScope,
  ScheduleSlot,
} from './promotions.types.js';

/** Reglas puras de promociones (spec F15 D2, D3, D5, D10-D12): sin I/O. */

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const MAX_BRANCH_IDS = 20;
export const MAX_PRODUCT_IDS = 200;
export const MAX_SLOTS = 42;
export const MAX_SLOTS_PER_DAY = 6;
export const MAX_VIOLATIONS = 50;
export const REASON_MAX = 200;

export const PERMISSION_READ = 'promotions.read';
export const PERMISSION_CREATE = 'promotions.create';
export const PERMISSION_UPDATE = 'promotions.update';

// ---------- errores ----------

export const promotionNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'PROMOTION_NOT_FOUND', 'Promoción no encontrada');
export const branchNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
export const scopeForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'PROMOTION_SCOPE_FORBIDDEN',
    'No tienes alcance sobre todas las sucursales de esta promoción',
  );
export const codeTaken = () =>
  codedException(HttpStatus.CONFLICT, 'PROMOTION_CODE_TAKEN', 'El código ya está en uso', [
    { path: 'code', code: 'PROMOTION_CODE_TAKEN', message: 'El código ya está en uso' },
  ]);
export const versionConflict = () =>
  codedException(
    HttpStatus.CONFLICT,
    'PROMOTION_VERSION_CONFLICT',
    'La promoción cambió desde que se leyó; recarga e inténtalo de nuevo',
  );
export const busy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'PROMOTIONS_BUSY',
    'Las promociones se están modificando; reintenta en unos segundos',
  );

const unprocessable = (code: string, message: string, violations: ErrorViolation[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    code,
    message,
    violations.slice(0, MAX_VIOLATIONS),
  );

export const valueInvalid = (message: string) =>
  unprocessable('PROMOTION_VALUE_INVALID', message, [
    { path: 'value', code: 'PROMOTION_VALUE_INVALID', message },
  ]);
export const periodInvalid = () =>
  unprocessable('PROMOTION_PERIOD_INVALID', 'endsAt debe ser posterior a startsAt', [
    {
      path: 'endsAt',
      code: 'PROMOTION_PERIOD_INVALID',
      message: 'endsAt debe ser posterior a startsAt',
    },
  ]);

const fail400 = (message: string): never => {
  throw new BadRequestException([message]);
};

// ---------- normalización de campos ----------

/** Recorta y pasa a mayúsculas; `null`/vacío = automática. Un formato inválido => 400 (el DTO ya lo filtra). */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const code = raw.trim().toUpperCase();
  if (code === '') return null;
  if (!CODE_PATTERN.test(code)) return fail400('code con formato inválido');
  return code;
}

/** NUL (PostgreSQL lo rechaza con 22021 => 500) y controles de dirección bidi (spoofing visual): se RECHAZAN con 400. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT = /[\u0000\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

export function assertCleanText(field: string, raw: string): void {
  if (FORBIDDEN_TEXT.test(raw)) fail400(`${field} contiene caracteres no permitidos`);
}

/** Reutiliza el saneado de productos (NFC, controles, espacios) y aplica el tope propio de promociones. */
export function normalizeName(raw: string): string {
  assertCleanText('name', raw);
  const name = normalizeProductName(raw);
  if (name.length > NAME_MAX) return fail400('name debe tener 1 a 120 caracteres');
  return name;
}

export function normalizeDescription(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  assertCleanText('description', raw);
  const text = normalizeProductDescription(raw);
  if (text !== null && text.length > DESCRIPTION_MAX) {
    return fail400('description supera 500 caracteres');
  }
  return text;
}

/** ISO 8601 con zona => instante; sin zona, formato inválido o fecha inexistente => 400. */
export function parseInstantField(field: string, raw: string): Date {
  if (typeof raw !== 'string' || !INSTANT_PATTERN.test(raw)) {
    return fail400(`${field} debe ser un instante ISO 8601 con zona`);
  }
  const ms = parseInstant(raw);
  if (ms === null) return fail400(`${field} no es un instante válido`);
  return new Date(ms);
}

// ---------- reglas de negocio (422) ----------

/** `"000001.00"` -> `"1.00"`: forma canónica para comparar y guardar. */
export const canonicalValue = (value: string): string => centsToDecimal(decimalToCents(value));

export function assertValue(kind: PromotionKind, value: string): void {
  let cents: number;
  try {
    cents = decimalToCents(value);
  } catch {
    return fail400('value debe ser una cadena decimal con 2 decimales');
  }
  if (cents <= 0) throw valueInvalid('El valor debe ser mayor que cero');
  if (kind === 'PERCENT' && cents > 10_000) {
    throw valueInvalid('El porcentaje no puede superar 100');
  }
}

export function assertPeriod(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) throw periodInvalid();
}

const slotLabel = (s: ScheduleSlot): string => `${s.weekday} ${s.startsAt}-${s.endsAt}`;

/**
 * Valida y ordena los tramos (`weekday`, `startsAt`). Reglas: `endsAt > startsAt` (no cruza la medianoche), sin
 * solapes en el mismo día (contiguos válidos), <= 6 por día y <= 42 en total. Violaciones por `schedule[i]`.
 */
export function normalizeSchedule(slots: readonly ScheduleSlot[]): ScheduleSlot[] {
  const violations: ErrorViolation[] = [];
  const parsed = slots.map((s, index) => {
    const start = parseClock(s.startsAt);
    const end = parseClock(s.endsAt);
    if (
      start === null ||
      end === null ||
      start === 1440 ||
      !Number.isInteger(s.weekday) ||
      s.weekday < 1 ||
      s.weekday > 7
    ) {
      return fail400(`schedule[${index}] con forma inválida`);
    }
    return { slot: s, index, start, end };
  });
  if (parsed.length > MAX_SLOTS) {
    violations.push({
      path: 'schedule',
      code: 'SLOT_LIMIT',
      message: `Máximo ${MAX_SLOTS} tramos`,
    });
  }
  for (const p of parsed) {
    if (p.end <= p.start) {
      violations.push({
        path: `schedule[${p.index}]`,
        code: 'SLOT_ENDS_BEFORE_START',
        message:
          'El tramo debe terminar después de empezar; parte los tramos que cruzan la medianoche',
      });
    }
  }
  for (let day = 1; day <= 7; day += 1) {
    const ofDay = parsed
      .filter((p) => p.slot.weekday === day && p.end > p.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const all = parsed.filter((p) => p.slot.weekday === day);
    if (all.length > MAX_SLOTS_PER_DAY) {
      violations.push({
        path: 'schedule',
        code: 'SLOT_LIMIT',
        message: `Máximo ${MAX_SLOTS_PER_DAY} tramos por día`,
      });
    }
    for (let i = 1; i < ofDay.length; i += 1) {
      const prev = ofDay[i - 1] as (typeof ofDay)[number];
      const cur = ofDay[i] as (typeof ofDay)[number];
      if (cur.start < prev.end) {
        violations.push({
          path: `schedule[${cur.index}]`,
          code: 'SLOT_OVERLAP',
          message: 'El tramo se solapa con otro del mismo día',
        });
      }
    }
  }
  if (violations.length > 0) {
    throw unprocessable('PROMOTION_SCHEDULE_INVALID', 'Horario semanal inválido', violations);
  }
  return parsed
    .map((p) => ({ ...p.slot }))
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        (parseClock(a.startsAt) as number) - (parseClock(b.startsAt) as number),
    );
}

export const scopeInvalid = (violations: ErrorViolation[]) =>
  unprocessable('PROMOTION_SCOPE_INVALID', 'Alcance de productos inválido', violations);

// ---------- borrador (estado final de una creación o edición) ----------

/** Estado final de una promoción tras una creación o edición; entrada de las validaciones y de la escritura. */
export interface PromotionDraft {
  code: string | null;
  name: string;
  description: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: Date;
  endsAt: Date;
  dineInOnly: boolean;
  active: boolean;
  branchScope: PromotionScope;
  branchIds: string[];
  productScope: PromotionScope;
  productIds: string[];
  schedule: ScheduleSlot[];
}

/** Reglas de negocio (422) del borrador que no necesitan la BD. */
export function validateDraft(draft: PromotionDraft): PromotionDraft {
  assertValue(draft.kind, draft.value);
  assertPeriod(draft.startsAt, draft.endsAt);
  const schedule = normalizeSchedule(draft.schedule);
  const value = canonicalValue(draft.value);
  if (draft.productScope === 'SELECTED' && draft.productIds.length === 0) {
    throw scopeInvalid([
      {
        path: 'productIds',
        code: 'SELECTED_EMPTY',
        message: 'Con productScope=SELECTED hay que indicar al menos un producto',
      },
    ]);
  }
  return { ...draft, value, schedule };
}

/** Forma de un alcance (400): `ALL` sin ids; `SELECTED` con ids (sucursales) — los productos vacíos son 422. */
export function assertBranchShape(scope: PromotionScope, ids: readonly string[]): void {
  if (scope === 'ALL' && ids.length > 0)
    fail400('branchIds debe omitirse o ir vacío con branchScope=ALL');
  if (scope === 'SELECTED' && ids.length === 0) {
    fail400('branchIds es obligatorio y no vacío con branchScope=SELECTED');
  }
}

export function assertProductShape(scope: PromotionScope, ids: readonly string[]): void {
  if (scope === 'ALL' && ids.length > 0)
    fail400('productIds debe omitirse o ir vacío con productScope=ALL');
}

export const productViolations = (
  requested: readonly string[],
  existing: ReadonlySet<string>,
): ErrorViolation[] =>
  requested.flatMap((id, i) =>
    existing.has(id)
      ? []
      : [
          {
            path: `productIds[${i}]`,
            code: 'PRODUCT_UNKNOWN',
            message: 'Producto inexistente',
          },
        ],
  );

// ---------- diff y auditoría (sin PII) ----------

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function draftOf(record: PromotionRecord): PromotionDraft {
  return {
    code: record.code,
    name: record.name,
    description: record.description,
    kind: record.kind,
    value: record.value,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    dineInOnly: record.dineInOnly,
    active: record.active,
    branchScope: record.branches.length === 0 ? 'ALL' : 'SELECTED',
    branchIds: record.branches.map((b) => b.id),
    productScope: record.productCount === 0 ? 'ALL' : 'SELECTED',
    productIds: record.products.map((p) => p.id),
    schedule: record.schedule.map((s) => ({ ...s })),
  };
}

export interface DraftDiff {
  scalars: {
    code?: string | null;
    name?: string;
    description?: string | null;
    kind?: PromotionKind;
    value?: string;
    startsAt?: Date;
    endsAt?: Date;
    dineInOnly?: boolean;
  };
  branchIds?: string[];
  productIds?: string[];
  schedule?: ScheduleSlot[];
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Cambios entre el estado actual y el borrador; `null` si no hay ninguno (idempotente). */
export function diffDraft(before: PromotionDraft, after: PromotionDraft): DraftDiff | null {
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  const scalars: DraftDiff['scalars'] = {};
  const scalar = <K extends keyof DraftDiff['scalars']>(
    key: K,
    a: DraftDiff['scalars'][K],
    b: DraftDiff['scalars'][K],
    audit: (v: NonNullable<DraftDiff['scalars'][K]> | null) => string | number | boolean | null,
  ): void => {
    if (a === b) return;
    scalars[key] = b;
    oldValues[key] = audit(a ?? null);
    newValues[key] = audit(b ?? null);
  };
  const plain = (v: unknown): string | number | boolean | null =>
    v as string | number | boolean | null;
  scalar('code', before.code, after.code, plain);
  scalar('name', before.name, after.name, plain);
  scalar('description', before.description, after.description, plain);
  scalar('kind', before.kind, after.kind, plain);
  scalar('value', canonicalValue(before.value), canonicalValue(after.value), plain);
  if (before.startsAt.getTime() !== after.startsAt.getTime()) {
    scalars.startsAt = after.startsAt;
    oldValues['startsAt'] = before.startsAt.toISOString();
    newValues['startsAt'] = after.startsAt.toISOString();
  }
  if (before.endsAt.getTime() !== after.endsAt.getTime()) {
    scalars.endsAt = after.endsAt;
    oldValues['endsAt'] = before.endsAt.toISOString();
    newValues['endsAt'] = after.endsAt.toISOString();
  }
  scalar('dineInOnly', before.dineInOnly, after.dineInOnly, plain);

  const diff: DraftDiff = { scalars, oldValues, newValues };
  const branchesChanged =
    before.branchScope !== after.branchScope || !sameList(before.branchIds, after.branchIds);
  if (branchesChanged) {
    diff.branchIds = after.branchIds;
    oldValues['branchScope'] = before.branchScope;
    newValues['branchScope'] = after.branchScope;
    oldValues['branchIds'] = [...before.branchIds].sort();
    newValues['branchIds'] = [...after.branchIds].sort();
  }
  const productsChanged =
    before.productScope !== after.productScope || !sameList(before.productIds, after.productIds);
  if (productsChanged) {
    diff.productIds = after.productIds;
    oldValues['productScope'] = before.productScope;
    newValues['productScope'] = after.productScope;
    oldValues['productCount'] = before.productIds.length;
    newValues['productCount'] = after.productIds.length;
    const beforeSet = new Set(before.productIds);
    const afterSet = new Set(after.productIds);
    oldValues['productIdsRemoved'] = before.productIds.filter((id) => !afterSet.has(id)).sort();
    newValues['productIdsAdded'] = after.productIds.filter((id) => !beforeSet.has(id)).sort();
  }
  const a = before.schedule.map(slotLabel);
  const b = after.schedule.map(slotLabel);
  if (!sameList(a, b)) {
    diff.schedule = after.schedule;
    oldValues['schedule'] = a;
    newValues['schedule'] = b;
    oldValues['scheduleCount'] = a.length;
    newValues['scheduleCount'] = b.length;
  }
  const changed =
    Object.keys(scalars).length > 0 ||
    diff.branchIds !== undefined ||
    diff.productIds !== undefined ||
    diff.schedule !== undefined;
  return changed ? diff : null;
}

export const createdAudit = (draft: PromotionDraft): AuditValues => ({
  name: draft.name,
  code: draft.code,
  kind: draft.kind,
  value: draft.value,
  active: draft.active,
  dineInOnly: draft.dineInOnly,
  startsAt: draft.startsAt.toISOString(),
  endsAt: draft.endsAt.toISOString(),
  branchScope: draft.branchScope,
  branchCount: draft.branchIds.length,
  branchIds: [...draft.branchIds].sort(),
  productScope: draft.productScope,
  productCount: draft.productIds.length,
  scheduleCount: draft.schedule.length,
});

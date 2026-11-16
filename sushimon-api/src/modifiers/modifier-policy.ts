import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import type {
  AdminModifierGroupSummaryView,
  AdminModifierGroupView,
  AdminModifierView,
  GroupRow,
  GroupSummaryRow,
  ModifierSelection,
  ModifierSelectionResult,
  OfferGroup,
  OfferRow,
  OptionRow,
  PublicModifierGroupView,
  SelectedModifierItem,
} from './modifiers.types.js';

/** Reglas de dominio de modificadores: funciones puras, sin I/O (spec F12 D1-D12). */

export const NAME_MAX = 80;
export const MAX_SELECT_LIMIT = 20;
export const MAX_OPTIONS_PER_GROUP = 30;
export const MAX_GROUPS_PER_PRODUCT = 10;
export const EXTRA_PRICE_PATTERN = /^[0-9]{1,4}\.[0-9]{2}$/;
export const DEFAULT_EXTRA_PRICE = '0.00';

const fail = (message: string): never => {
  throw new BadRequestException([message]);
};

const unprocessable = (code: string, message: string, violations?: ErrorViolation[]) =>
  codedException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, violations);

// ---------- errores de negocio ----------

export const groupNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'MODIFIER_GROUP_NOT_FOUND', 'Grupo no encontrado');
export const modifierNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'MODIFIER_NOT_FOUND', 'Opción no encontrada');
export const productNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
export const groupNameTaken = () =>
  codedException(
    HttpStatus.CONFLICT,
    'MODIFIER_GROUP_NAME_TAKEN',
    'Ya existe un grupo con ese nombre',
  );
export const modifierNameTaken = () =>
  codedException(
    HttpStatus.CONFLICT,
    'MODIFIER_NAME_TAKEN',
    'Ya existe una opción con ese nombre en el grupo',
  );
export const limitsInvalid = (message: string) => unprocessable('MODIFIER_LIMITS_INVALID', message);
export const groupUnsatisfiable = () =>
  unprocessable(
    'MODIFIER_GROUP_UNSATISFIABLE',
    'El grupo activo se quedaría con menos opciones activas que su mínimo',
  );
export const limitReached = (message: string) => unprocessable('MODIFIER_LIMIT_REACHED', message);
export const reorderMismatch = () =>
  unprocessable(
    'MODIFIER_REORDER_MISMATCH',
    'orderedIds debe contener exactamente las opciones del grupo, sin repetir',
  );
export const groupInvalid = (message: string, violations?: ErrorViolation[]) =>
  unprocessable('MODIFIER_GROUP_INVALID', message, violations);
export const busy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'MODIFIERS_BUSY',
    'El catálogo se está modificando; reintenta en unos segundos',
  );

// ---------- normalización ----------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/** Caracteres Unicode de formato (categoría Cf): invisibles y bidi (U+200B, U+202E, U+2066…) que falsean nombres. */
const FORMAT_CHARS = /\p{Cf}/gu;

export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return fail('name debe ser texto');
  const name = raw
    .normalize('NFC')
    .replace(FORMAT_CHARS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return fail('name no puede estar vacío');
  if (name.length > NAME_MAX) return fail(`name no puede superar ${NAME_MAX} caracteres`);
  return name;
}

/** Clave de unicidad equivalente al índice `lower(btrim(name))` (el nombre ya está recortado). */
export const nameKey = (name: string): string => name.toLowerCase();

// ---------- precio (céntimos enteros; nunca Number decimal) ----------

export function parseExtraCents(raw: unknown): number {
  if (typeof raw !== 'string' || !EXTRA_PRICE_PATTERN.test(raw))
    return fail('extraPrice debe ser un importe decimal con 2 decimales, p. ej. "5.00"');
  const [whole = '0', frac = '00'] = raw.split('.');
  return Number(whole) * 100 + Number(frac);
}

export const formatCents = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** El patrón admite ceros a la izquierda (`"05.00"`); la forma canónica los quita (`"5.00"`). */
export const normalizeExtraPrice = (raw: unknown): string => formatCents(parseExtraCents(raw));

/** Suma exacta en céntimos de importes ya validados (vienen de la BD). */
export function sumPrices(prices: readonly string[]): string {
  let cents = 0;
  for (const p of prices) {
    const [w = '0', f = '00'] = p.split('.');
    cents += Number(w) * 100 + Number(f.padEnd(2, '0').slice(0, 2));
  }
  return formatCents(cents);
}

// ---------- límites ----------

/** `0 <= min <= max`, `1 <= max <= 20`, enteros; si no, 422 `MODIFIER_LIMITS_INVALID`. */
export function assertLimits(min: number, max: number): void {
  if (!Number.isInteger(min) || !Number.isInteger(max))
    throw limitsInvalid('minSelect y maxSelect deben ser enteros');
  if (max < 1 || max > MAX_SELECT_LIMIT)
    throw limitsInvalid(`maxSelect debe estar entre 1 y ${MAX_SELECT_LIMIT}`);
  if (min < 0) throw limitsInvalid('minSelect no puede ser negativo');
  if (min > max) throw limitsInvalid('minSelect no puede superar maxSelect');
}

/** Un grupo ACTIVO no puede exigir más opciones de las activas que tiene (D3). */
export function assertReachable(
  active: boolean,
  minSelect: number,
  activeOptionCount: number,
): void {
  if (active && minSelect > activeOptionCount)
    throw limitsInvalid('minSelect supera el número de opciones activas del grupo');
}

// ---------- entradas ----------

export interface OptionInput {
  name: unknown;
  extraPrice?: unknown;
}

export interface CreateGroupInput {
  name: unknown;
  minSelect?: number;
  maxSelect?: number;
  active?: boolean;
  options?: readonly OptionInput[];
}

export interface NormalizedOption {
  name: string;
  extraPrice: string;
}

export interface NormalizedCreateGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  options: NormalizedOption[];
}

export function normalizeOption(input: OptionInput): NormalizedOption {
  return {
    name: normalizeName(input.name),
    extraPrice:
      input.extraPrice === undefined ? DEFAULT_EXTRA_PRICE : normalizeExtraPrice(input.extraPrice),
  };
}

/** Todo lo que no depende de la BD: forma, rangos (422) y duplicados dentro del propio cuerpo. */
export function normalizeCreateGroup(input: CreateGroupInput): NormalizedCreateGroup {
  const name = normalizeName(input.name);
  const minSelect = input.minSelect ?? 0;
  const maxSelect = input.maxSelect ?? 1;
  assertLimits(minSelect, maxSelect);
  const raw = input.options ?? [];
  if (raw.length > MAX_OPTIONS_PER_GROUP)
    throw limitReached(`Un grupo admite como máximo ${MAX_OPTIONS_PER_GROUP} opciones`);
  const options = raw.map(normalizeOption);
  const seen = new Set<string>();
  for (const o of options) {
    const key = nameKey(o.name);
    if (seen.has(key)) throw modifierNameTaken();
    seen.add(key);
  }
  return { name, minSelect, maxSelect, active: input.active ?? true, options };
}

export interface UpdateGroupInput {
  name?: unknown;
  minSelect?: number;
  maxSelect?: number;
  active?: boolean;
}

export interface GroupChanges {
  name?: string;
  minSelect?: number;
  maxSelect?: number;
  active?: boolean;
}

/** Cuerpo vacío => 400. Rango individual de lo recibido => 422 (la relación completa se valida con el estado actual). */
export function normalizeUpdateGroup(input: UpdateGroupInput): GroupChanges {
  const out: GroupChanges = {};
  if (input.name !== undefined) out.name = normalizeName(input.name);
  if (input.minSelect !== undefined) {
    if (
      !Number.isInteger(input.minSelect) ||
      input.minSelect < 0 ||
      input.minSelect > MAX_SELECT_LIMIT
    )
      throw limitsInvalid(`minSelect debe estar entre 0 y ${MAX_SELECT_LIMIT}`);
    out.minSelect = input.minSelect;
  }
  if (input.maxSelect !== undefined) {
    if (
      !Number.isInteger(input.maxSelect) ||
      input.maxSelect < 1 ||
      input.maxSelect > MAX_SELECT_LIMIT
    )
      throw limitsInvalid(`maxSelect debe estar entre 1 y ${MAX_SELECT_LIMIT}`);
    out.maxSelect = input.maxSelect;
  }
  if (input.active !== undefined) out.active = input.active;
  if (Object.keys(out).length === 0) return fail('El cuerpo no contiene cambios');
  return out;
}

export interface GroupDiff {
  changes: GroupChanges;
  oldValues: AuditValues;
  newValues: AuditValues;
  /** Hay cambios distintos de `active`. */
  hasFieldChanges: boolean;
}

/** Solo lo que realmente cambia; `null` si nada cambia (ni escritura ni auditoría). */
export function diffGroup(current: GroupRow, changes: GroupChanges): GroupDiff | null {
  const out: GroupChanges = {};
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  let hasFieldChanges = false;
  for (const key of ['name', 'minSelect', 'maxSelect', 'active'] as const) {
    const next = changes[key];
    if (next === undefined || next === current[key]) continue;
    (out as Record<string, unknown>)[key] = next;
    if (key === 'active') continue;
    hasFieldChanges = true;
    oldValues[key] = current[key];
    newValues[key] = next;
  }
  if (Object.keys(out).length === 0) return null;
  return { changes: out, oldValues, newValues, hasFieldChanges };
}

export interface UpdateOptionInput {
  name?: unknown;
  extraPrice?: unknown;
  active?: boolean;
}

export interface OptionChanges {
  name?: string;
  extraPrice?: string;
  active?: boolean;
}

export function normalizeUpdateOption(input: UpdateOptionInput): OptionChanges {
  const out: OptionChanges = {};
  if (input.name !== undefined) out.name = normalizeName(input.name);
  if (input.extraPrice !== undefined) out.extraPrice = normalizeExtraPrice(input.extraPrice);
  if (input.active !== undefined) out.active = input.active;
  if (Object.keys(out).length === 0) return fail('El cuerpo no contiene cambios');
  return out;
}

export interface OptionDiff {
  changes: OptionChanges;
  oldValues: AuditValues;
  newValues: AuditValues;
  hasFieldChanges: boolean;
}

export function diffOption(current: OptionRow, changes: OptionChanges): OptionDiff | null {
  const out: OptionChanges = {};
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  let hasFieldChanges = false;
  for (const key of ['name', 'extraPrice', 'active'] as const) {
    const next = changes[key];
    if (next === undefined || next === current[key]) continue;
    (out as Record<string, unknown>)[key] = next;
    if (key === 'active') continue;
    hasFieldChanges = true;
    oldValues[key] = current[key];
    newValues[key] = next;
  }
  if (Object.keys(out).length === 0) return null;
  return { changes: out, oldValues, newValues, hasFieldChanges };
}

/** Grupo tras aplicar los cambios (para validar el estado resultante). */
export const applyGroup = (current: GroupRow, changes: GroupChanges): GroupRow => ({
  ...current,
  ...changes,
});

/** Lista de grupos de un producto: ≤ 10 (11-50 => 422), sin duplicados (422 `MODIFIER_GROUP_INVALID`). */
export function normalizeGroupIds(ids: readonly string[]): string[] {
  if (ids.length > MAX_GROUPS_PER_PRODUCT)
    throw limitReached(`Un producto admite como máximo ${MAX_GROUPS_PER_PRODUCT} grupos`);
  const seen = new Set<string>();
  const violations: ErrorViolation[] = [];
  ids.forEach((id, i) => {
    const key = id.toLowerCase();
    if (seen.has(key)) {
      violations.push({
        path: `groupIds[${i}]`,
        code: 'MODIFIER_GROUP_INVALID',
        message: 'Grupo repetido',
      });
    }
    seen.add(key);
  });
  if (violations.length > 0) throw groupInvalid('groupIds contiene grupos repetidos', violations);
  return ids.map((id) => id.toLowerCase());
}

export const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- vistas ----------

export const toOptionView = (o: OptionRow): AdminModifierView => ({
  id: o.id,
  groupId: o.groupId,
  name: o.name,
  extraPrice: o.extraPrice,
  active: o.active,
  sortOrder: o.sortOrder,
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

export const toSummaryView = (g: GroupSummaryRow): AdminModifierGroupSummaryView => ({
  id: g.id,
  name: g.name,
  minSelect: g.minSelect,
  maxSelect: g.maxSelect,
  required: g.minSelect >= 1,
  active: g.active,
  optionCount: g.optionCount,
  activeOptionCount: g.activeOptionCount,
  productCount: g.productCount,
  createdAt: g.createdAt.toISOString(),
  updatedAt: g.updatedAt.toISOString(),
});

export const toGroupView = (
  g: GroupSummaryRow,
  options: readonly OptionRow[],
): AdminModifierGroupView => ({
  ...toSummaryView(g),
  options: [...options].sort((a, b) => a.sortOrder - b.sortOrder).map(toOptionView),
});

/** Opciones agrupadas por grupo (una pasada). */
export function groupOptions(options: readonly OptionRow[]): Map<string, OptionRow[]> {
  const out = new Map<string, OptionRow[]>();
  for (const o of options) {
    const list = out.get(o.groupId);
    if (list) list.push(o);
    else out.set(o.groupId, [o]);
  }
  return out;
}

// ---------- ofrecible (ficha pública y validador comparten la definición) ----------

/** Filas planas del JOIN → grupos con todas sus opciones, en el orden recibido. Filas sin grupo se ignoran. */
export function buildOfferGroups(rows: readonly OfferRow[]): OfferGroup[] {
  const groups = new Map<string, OfferGroup>();
  for (const r of rows) {
    if (r.groupId === null) continue;
    let group = groups.get(r.groupId);
    if (!group) {
      group = {
        id: r.groupId,
        name: r.groupName ?? '',
        minSelect: r.minSelect ?? 0,
        maxSelect: r.maxSelect ?? 1,
        active: r.groupActive ?? false,
        options: [],
      };
      groups.set(r.groupId, group);
    }
    if (r.modifierId !== null) {
      group.options.push({
        id: r.modifierId,
        name: r.modifierName ?? '',
        extraPrice: r.extraPrice ?? DEFAULT_EXTRA_PRICE,
        active: r.modifierActive ?? false,
      });
    }
  }
  return [...groups.values()];
}

export const activeOptionsOf = (g: OfferGroup) => g.options.filter((o) => o.active);

/** Grupo activo con al menos `max(min, 1)` opciones activas. */
export const isOfferable = (g: OfferGroup): boolean =>
  g.active && activeOptionsOf(g).length >= Math.max(g.minSelect, 1);

/** Grupo activo cuyo mínimo no se puede cumplir (dato inconsistente: se registra en logs). */
export const isUnsatisfiable = (g: OfferGroup): boolean =>
  g.active && activeOptionsOf(g).length < g.minSelect;

export function toPublicGroups(groups: readonly OfferGroup[]): PublicModifierGroupView[] {
  return groups.filter(isOfferable).map((g) => ({
    id: g.id,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    required: g.minSelect >= 1,
    options: activeOptionsOf(g).map((o) => ({ id: o.id, name: o.name, extraPrice: o.extraPrice })),
  }));
}

// ---------- validación de selecciones (D10) ----------

export const selectionInvalid = (violations: ErrorViolation[]) =>
  unprocessable('MODIFIER_SELECTION_INVALID', 'La selección de extras no es válida', violations);

const violation = (path: string, code: string, message: string): ErrorViolation => ({
  path,
  code,
  message,
});

export const MAX_SELECTIONS = 10;
export const MAX_IDS_PER_SELECTION = 20;
export const MAX_VIOLATIONS = 50;

/**
 * Guarda defensiva de FORMA (el llamador es interno, pero el dato viene del cliente): `selections` y `modifierIds`
 * deben ser arreglos de la forma esperada y acotados. Cualquier fallo => 422 `MODIFIER_SELECTION_INVALID` (nunca TypeError).
 */
export function assertSelectionShape(selections: unknown): void {
  const bad = (path: string, message: string): ErrorViolation =>
    violation(path, 'MODIFIER_SELECTION_INVALID', message);
  if (!Array.isArray(selections))
    throw selectionInvalid([bad('selections', 'Debe ser un arreglo')]);
  if (selections.length > MAX_SELECTIONS)
    throw selectionInvalid([bad('selections', `Máximo ${MAX_SELECTIONS} selecciones`)]);
  const found: ErrorViolation[] = [];
  (selections as unknown[]).forEach((sel, i) => {
    const base = `selections[${i}]`;
    if (typeof sel !== 'object' || sel === null || Array.isArray(sel)) {
      found.push(bad(base, 'Debe ser un objeto'));
      return;
    }
    const { groupId, modifierIds } = sel as { groupId?: unknown; modifierIds?: unknown };
    if (typeof groupId !== 'string') found.push(bad(`${base}.groupId`, 'Debe ser texto'));
    if (!Array.isArray(modifierIds)) {
      found.push(bad(`${base}.modifierIds`, 'Debe ser un arreglo'));
    } else if (modifierIds.length > MAX_IDS_PER_SELECTION) {
      found.push(bad(`${base}.modifierIds`, `Máximo ${MAX_IDS_PER_SELECTION} opciones`));
    } else {
      (modifierIds as unknown[]).forEach((id, j) => {
        if (typeof id !== 'string') found.push(bad(`${base}.modifierIds[${j}]`, 'Debe ser texto'));
      });
    }
  });
  if (found.length > 0) throw selectionInvalid(found.slice(0, MAX_VIOLATIONS));
}

/** Valida en memoria contra los grupos del producto; lanza 422 con TODAS las violaciones. */
export function validateSelections(
  groups: readonly OfferGroup[],
  selections: readonly ModifierSelection[],
): ModifierSelectionResult {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const violations: ErrorViolation[] = [];
  const items: SelectedModifierItem[] = [];
  const seenGroups = new Set<string>();

  selections.forEach((sel, i) => {
    const base = `selections[${i}]`;
    if (seenGroups.has(sel.groupId)) {
      violations.push(violation(`${base}.groupId`, 'MODIFIER_DUPLICATED', 'Grupo repetido'));
      return;
    }
    seenGroups.add(sel.groupId);
    const group = byId.get(sel.groupId);
    if (!group) {
      violations.push(
        violation(
          `${base}.groupId`,
          'MODIFIER_GROUP_NOT_ON_PRODUCT',
          'El grupo no es del producto',
        ),
      );
      return;
    }
    if (!group.active) {
      violations.push(violation(`${base}.groupId`, 'MODIFIER_INACTIVE', 'El grupo está inactivo'));
      return;
    }
    if (!isOfferable(group)) {
      violations.push(
        violation(`${base}.groupId`, 'MODIFIER_GROUP_NOT_ON_PRODUCT', 'El grupo no se ofrece'),
      );
      return;
    }
    const options = new Map(group.options.map((o) => [o.id, o]));
    const chosen = new Set<string>();
    sel.modifierIds.forEach((modifierId, j) => {
      const path = `${base}.modifierIds[${j}]`;
      if (chosen.has(modifierId)) {
        violations.push(violation(path, 'MODIFIER_DUPLICATED', 'Opción repetida'));
        return;
      }
      const option = options.get(modifierId);
      if (!option) {
        violations.push(
          violation(path, 'MODIFIER_NOT_IN_GROUP', 'La opción no pertenece al grupo'),
        );
        return;
      }
      chosen.add(modifierId);
      if (!option.active) {
        violations.push(violation(path, 'MODIFIER_INACTIVE', 'La opción está inactiva'));
        return;
      }
      items.push({
        groupId: group.id,
        modifierId: option.id,
        name: option.name,
        extraPrice: option.extraPrice,
      });
    });
    if (chosen.size > group.maxSelect) {
      violations.push(
        violation(
          `${base}.modifierIds`,
          'MODIFIER_TOO_MANY',
          `Se admiten como máximo ${group.maxSelect} opciones`,
        ),
      );
    }
    if (chosen.size < group.minSelect) {
      violations.push(
        violation(base, 'MODIFIER_REQUIRED', `Se requieren al menos ${group.minSelect} opciones`),
      );
    }
  });

  for (const group of groups) {
    if (group.minSelect >= 1 && isOfferable(group) && !seenGroups.has(group.id)) {
      violations.push(
        violation(`groups/${group.id}`, 'MODIFIER_REQUIRED', 'El grupo es obligatorio'),
      );
    }
  }
  if (violations.length > 0) throw selectionInvalid(violations.slice(0, MAX_VIOLATIONS));
  return { ok: true, extraTotal: sumPrices(items.map((it) => it.extraPrice)), items };
}

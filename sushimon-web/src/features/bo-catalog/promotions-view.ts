import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminPromotion,
  AdminPromotionSummary,
  PromotionKind,
  PromotionScheduleSlot,
  PromotionScope,
  UpdatePromotionRequest,
} from '@/lib/data-access/models';
import {
  PROMOTION_BRANCHES_MAX,
  PROMOTION_CODE_PATTERN,
  PROMOTION_DESCRIPTION_MAX,
  PROMOTION_NAME_MAX,
  PROMOTION_PRODUCTS_MAX,
  decimalToCents,
  isValueInRange,
  normalizePromotionCode,
  parseDecimalInput,
  scheduleViolations,
  sortSchedule,
  splitOvernightSlot,
} from '@/lib/promotion-rules';
import { addDaysISO, fromLocal, isoToLocalInput, localInputToIso } from '@/lib/time';
import { errorMessage } from '@/features/bo-orders/error-message';
import type {
  AdminPromotionFilters,
  AdminPromotionStatusFilter,
  CreatePromotionInput,
} from '@/services/promotions';

/**
 * F15 — Lógica PURA del backoffice de promociones: filtros del listado, formulario (valores → petición), validación previa y
 * errores del servidor por `code`. Sin React ni red. El servidor decide siempre; esta validación solo avisa antes de enviar y usa
 * las MISMAS reglas (`lib/promotion-rules`) que el adaptador mock. Importes como cadenas decimales; instantes ISO con zona; el
 * formulario captura fecha y hora LOCALES de Guatemala (`datetime-local`).
 */

export const PROMOTION_KINDS: readonly PromotionKind[] = ['PERCENT', 'FIXED_AMOUNT'];

// ── Filtros del listado ────────────────────────────────────────────────────────────────────

export interface PromotionFilterValues {
  q: string;
  branchId: string;
  status: AdminPromotionStatusFilter | 'all';
  kind: PromotionKind | 'all';
  /** Fechas locales `YYYY-MM-DD` (inclusivas); vacío = sin límite. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: PromotionFilterValues = {
  q: '',
  branchId: 'all',
  status: 'all',
  kind: 'all',
  from: '',
  to: '',
};

export const hasActiveFilters = (f: PromotionFilterValues): boolean =>
  f.q.trim() !== '' ||
  f.branchId !== 'all' ||
  f.status !== 'all' ||
  f.kind !== 'all' ||
  f.from !== '' ||
  f.to !== '';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `to` anterior a `from` (el servidor respondería 400): se avisa y no se consulta. */
export const filterDatesInvalid = (f: Pick<PromotionFilterValues, 'from' | 'to'>): boolean =>
  DATE.test(f.from) && DATE.test(f.to) && f.to < f.from;

/**
 * Filtros de la pantalla → consulta del contrato. Las fechas son DÍAS locales inclusivos: `from` = 00:00 local de ese día y `to` =
 * 00:00 local del día SIGUIENTE (el servidor usa `[from, to)`). Un rango invertido no genera fechas.
 */
export function filtersToQuery(
  f: PromotionFilterValues,
  page: number,
  pageSize: number,
): AdminPromotionFilters {
  const invalid = filterDatesInvalid(f);
  return {
    q: f.q.trim() || undefined,
    branchId: f.branchId === 'all' ? undefined : f.branchId,
    status: f.status === 'all' ? undefined : f.status,
    kind: f.kind === 'all' ? undefined : f.kind,
    from: !invalid && DATE.test(f.from) ? fromLocal(f.from).toISOString() : undefined,
    to: !invalid && DATE.test(f.to) ? fromLocal(addDaysISO(f.to, 1)).toISOString() : undefined,
    page,
    pageSize,
  };
}

// ── Presentación ───────────────────────────────────────────────────────────────────────────

/** `-25%` / `Q20.00` (por unidad) a partir de `kind`/`value` (cadena decimal del contrato; sin aritmética). */
export function discountLabel(p: Pick<AdminPromotionSummary, 'kind' | 'value'>): string {
  const clean = p.value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return p.kind === 'PERCENT' ? `-${clean}%` : `Q${p.value}`;
}

/** Descripción corta de cada día ISO presente en los tramos (ascendente, sin repetidos). */
export const scheduleDays = (schedule: readonly PromotionScheduleSlot[]): number[] =>
  [...new Set(schedule.map((s) => s.weekday))].sort((a, b) => a - b);

// ── Formulario ─────────────────────────────────────────────────────────────────────────────

/** Fila editable de un tramo: `overnight` = termina al día siguiente (se parte en dos tramos al enviar). */
export interface SlotRow {
  key: string;
  weekday: number;
  start: string;
  end: string;
  overnight: boolean;
}

export interface SelectedProduct {
  id: string;
  name: string;
}

export interface PromotionFormValues {
  name: string;
  description: string;
  /** Vacío = automática; con valor = cupón. */
  code: string;
  kind: PromotionKind;
  /** Texto del campo (`15`, `15.5`, `20,00`). */
  value: string;
  /** `datetime-local` en hora de Guatemala (`YYYY-MM-DDTHH:mm`). */
  startsAt: string;
  endsAt: string;
  dineInOnly: boolean;
  branchScope: PromotionScope;
  branchIds: string[];
  productScope: PromotionScope;
  products: SelectedProduct[];
  slots: SlotRow[];
}

let rowSeq = 0;
export const newSlotKey = (): string => `slot-${++rowSeq}`;

export const newSlotRow = (weekday = 1): SlotRow => ({
  key: newSlotKey(),
  weekday,
  start: '15:00',
  end: '18:00',
  overnight: false,
});

/** «Nueva promoción»: automática, 15 %, hoy 00:00 → 30 días después, sin horario; `ALL` solo con alcance global. */
export function emptyPromotionForm(todayLocal: string, global: boolean): PromotionFormValues {
  const start = todayLocal ? `${todayLocal}T00:00` : '';
  const end = todayLocal ? `${addDaysISO(todayLocal, 30)}T00:00` : '';
  return {
    name: '',
    description: '',
    code: '',
    kind: 'PERCENT',
    value: '15',
    startsAt: start,
    endsAt: end,
    dineInOnly: false,
    branchScope: global ? 'ALL' : 'SELECTED',
    branchIds: [],
    productScope: 'ALL',
    products: [],
    slots: [],
  };
}

/** Un tramo del contrato → fila (los tramos ya vienen partidos: nunca `overnight`). */
export function promotionToForm(p: AdminPromotion): PromotionFormValues {
  return {
    name: p.name,
    description: p.description ?? '',
    code: p.code ?? '',
    kind: p.kind,
    value: p.value,
    startsAt: isoToLocalInput(p.startsAt),
    endsAt: isoToLocalInput(p.endsAt),
    dineInOnly: p.dineInOnly,
    branchScope: p.branchScope,
    branchIds: p.branches.map((b) => b.id),
    productScope: p.productScope,
    products: p.products.map((x) => ({ id: x.id, name: x.name })),
    slots: sortSchedule(p.schedule).map((s) => ({
      key: newSlotKey(),
      weekday: s.weekday,
      start: s.startsAt,
      end: s.endsAt === '24:00' ? '00:00' : s.endsAt,
      overnight: false,
    })),
  };
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Filas → tramos del contrato (sin cruzar la medianoche). Fin `00:00` sin cruzar = hasta la medianoche (`24:00`); `overnight`
 * parte el tramo en dos días (vie 22:00 → 02:00 = vie 22:00–24:00 + sáb 00:00–02:00). Filas con hora inválida se omiten (las
 * reporta `validatePromotionForm`).
 */
export function buildSchedule(rows: readonly SlotRow[]): PromotionScheduleSlot[] {
  const slots = rows.flatMap((r): PromotionScheduleSlot[] => {
    if (!HM.test(r.start) || !HM.test(r.end)) return [];
    if (r.overnight) return splitOvernightSlot(r.weekday, r.start, r.end);
    return [{ weekday: r.weekday, startsAt: r.start, endsAt: r.end === '00:00' ? '24:00' : r.end }];
  });
  return sortSchedule(slots);
}

export type PromotionField =
  | 'name'
  | 'description'
  | 'code'
  | 'value'
  | 'startsAt'
  | 'endsAt'
  | 'branches'
  | 'products'
  | 'schedule';

export interface PromotionFormError {
  field: PromotionField;
  message: string;
}

export const MESSAGES = {
  name: `Escribe un nombre de 1 a ${PROMOTION_NAME_MAX} caracteres.`,
  description: `La descripción admite hasta ${PROMOTION_DESCRIPTION_MAX} caracteres.`,
  code: 'El código admite de 3 a 32 caracteres: letras, números, guion o guion bajo, empezando por letra o número.',
  valueRequired: 'Indica un valor mayor a 0 (hasta 2 decimales).',
  percentMax: 'El descuento no puede superar 100 %.',
  fixedMax: 'El monto no puede superar Q999,999.99.',
  startsAt: 'Indica la fecha y hora de inicio.',
  endsAt: 'Indica la fecha y hora de fin.',
  period: 'El fin debe ser posterior al inicio.',
  branches: 'Elige al menos una sucursal.',
  branchesMax: `Elige hasta ${PROMOTION_BRANCHES_MAX} sucursales o usa «Todas».`,
  products: 'Elige al menos un producto o usa «Todos los productos».',
  productsMax: `Elige hasta ${PROMOTION_PRODUCTS_MAX} productos o usa «Todos los productos».`,
  slotTime: 'Cada franja necesita hora de inicio y de fin.',
  slotOrder:
    'En una franja el fin debe ser posterior al inicio. Si termina al día siguiente, marca «Cruza la medianoche».',
  slotOverlap: 'Hay franjas que se solapan el mismo día. Únelas o ajusta las horas.',
  slotLimit: 'Máximo 6 franjas por día y 42 en total.',
  slotOvernight:
    'Si la franja cruza la medianoche, el fin (del día siguiente) debe ser anterior al inicio.',
} as const;

/** Mismas reglas que el servidor (forma y rangos) para avisar antes de enviar. */
export function validatePromotionForm(v: PromotionFormValues): PromotionFormError[] {
  const errors: PromotionFormError[] = [];
  const add = (field: PromotionField, message: string) => errors.push({ field, message });
  const name = v.name.trim();
  if (name.length < 1 || name.length > PROMOTION_NAME_MAX) add('name', MESSAGES.name);
  if (v.description.trim().length > PROMOTION_DESCRIPTION_MAX) {
    add('description', MESSAGES.description);
  }
  if (v.code.trim() !== '' && !PROMOTION_CODE_PATTERN.test(v.code.trim()))
    add('code', MESSAGES.code);
  const value = parseDecimalInput(v.value);
  const cents = value === null ? null : decimalToCents(value);
  if (cents === null || cents <= 0) add('value', MESSAGES.valueRequired);
  else if (!isValueInRange(v.kind, cents)) {
    add('value', v.kind === 'PERCENT' ? MESSAGES.percentMax : MESSAGES.fixedMax);
  }
  const start = localInputToIso(v.startsAt);
  const end = localInputToIso(v.endsAt);
  if (!start) add('startsAt', MESSAGES.startsAt);
  if (!end) add('endsAt', MESSAGES.endsAt);
  if (start && end && Date.parse(end) <= Date.parse(start)) add('endsAt', MESSAGES.period);
  if (v.branchScope === 'SELECTED') {
    if (v.branchIds.length === 0) add('branches', MESSAGES.branches);
    else if (v.branchIds.length > PROMOTION_BRANCHES_MAX) add('branches', MESSAGES.branchesMax);
  }
  if (v.productScope === 'SELECTED') {
    if (v.products.length === 0) add('products', MESSAGES.products);
    else if (v.products.length > PROMOTION_PRODUCTS_MAX) add('products', MESSAGES.productsMax);
  }
  const rows = v.slots;
  if (rows.some((r) => !HM.test(r.start) || !HM.test(r.end))) add('schedule', MESSAGES.slotTime);
  else if (rows.some((r) => !r.overnight && r.end !== '00:00' && r.end <= r.start)) {
    add('schedule', MESSAGES.slotOrder);
  } else if (rows.some((r) => r.overnight && r.end !== '00:00' && r.end > r.start)) {
    add('schedule', MESSAGES.slotOvernight);
  } else {
    const found = scheduleViolations(buildSchedule(rows));
    if (found.some((f) => f.code === 'SLOT_OVERLAP')) add('schedule', MESSAGES.slotOverlap);
    else if (found.some((f) => f.code === 'SLOT_LIMIT')) add('schedule', MESSAGES.slotLimit);
    else if (found.some((f) => f.code === 'SLOT_ENDS_BEFORE_START'))
      add('schedule', MESSAGES.slotOrder);
  }
  return errors;
}

const canonical = (v: PromotionFormValues) => ({
  name: v.name.trim(),
  description: v.description.trim() || null,
  code: v.code.trim() === '' ? null : normalizePromotionCode(v.code),
  kind: v.kind,
  value: parseDecimalInput(v.value) as string,
  startsAt: localInputToIso(v.startsAt) as string,
  endsAt: localInputToIso(v.endsAt) as string,
  dineInOnly: v.dineInOnly,
  branchScope: v.branchScope,
  branchIds: v.branchScope === 'ALL' ? [] : [...v.branchIds],
  productScope: v.productScope,
  productIds: v.productScope === 'ALL' ? [] : v.products.map((p) => p.id),
  schedule: buildSchedule(v.slots),
});

/** Alta: lo ya validado → petición del contrato (`code` ausente = automática). */
export function toCreateRequest(v: PromotionFormValues): CreatePromotionInput {
  const c = canonical(v);
  return {
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    ...(c.code ? { code: c.code } : {}),
    kind: c.kind,
    value: c.value,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    dineInOnly: c.dineInOnly,
    branchScope: c.branchScope,
    ...(c.branchScope === 'SELECTED' ? { branchIds: c.branchIds } : {}),
    productScope: c.productScope,
    ...(c.productScope === 'SELECTED' ? { productIds: c.productIds } : {}),
    ...(c.schedule.length > 0 ? { schedule: c.schedule } : {}),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Edición: SOLO lo que cambió + `expectedVersion`; `null` si nada cambió (no se envía: el PATCH exige al menos un campo). */
export function toUpdateRequest(
  v: PromotionFormValues,
  current: AdminPromotion,
): UpdatePromotionRequest | null {
  const c = canonical(v);
  const patch: UpdatePromotionRequest = { expectedVersion: current.version };
  let changed = false;
  const set = <K extends keyof UpdatePromotionRequest>(
    key: K,
    value: UpdatePromotionRequest[K],
  ) => {
    patch[key] = value;
    changed = true;
  };
  if (c.name !== current.name) set('name', c.name);
  if (c.description !== current.description) set('description', c.description);
  if (c.code !== current.code) set('code', c.code);
  if (c.kind !== current.kind) set('kind', c.kind);
  if (c.value !== current.value) set('value', c.value);
  if (Date.parse(c.startsAt) !== Date.parse(current.startsAt)) set('startsAt', c.startsAt);
  if (Date.parse(c.endsAt) !== Date.parse(current.endsAt)) set('endsAt', c.endsAt);
  if (c.dineInOnly !== current.dineInOnly) set('dineInOnly', c.dineInOnly);
  const currentBranches = current.branches.map((b) => b.id);
  if (c.branchScope !== current.branchScope || !sameSet(c.branchIds, currentBranches)) {
    set('branchScope', c.branchScope);
    if (c.branchScope === 'SELECTED') set('branchIds', c.branchIds);
  }
  const currentProducts = current.products.map((p) => p.id);
  if (c.productScope !== current.productScope || !sameSet(c.productIds, currentProducts)) {
    set('productScope', c.productScope);
    if (c.productScope === 'SELECTED') set('productIds', c.productIds);
  }
  if (JSON.stringify(c.schedule) !== JSON.stringify(sortSchedule(current.schedule))) {
    set('schedule', c.schedule);
  }
  return changed ? patch : null;
}

// ── Errores del servidor ───────────────────────────────────────────────────────────────────

export type PromotionErrorKind =
  | 'codeTaken'
  | 'versionConflict'
  | 'valueInvalid'
  | 'periodInvalid'
  | 'scheduleInvalid'
  | 'scopeInvalid'
  | 'scopeForbidden'
  | 'branchNotFound'
  | 'notFound'
  | 'busy'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'other';

export interface PromotionServerError {
  kind: PromotionErrorKind;
  message: string;
  field?: PromotionField;
  /** Hay que volver a pedir datos (la promoción cambió, ya no existe o cambió el alcance). */
  reload: boolean;
}

const out = (
  kind: PromotionErrorKind,
  message: string,
  field?: PromotionField,
  reload = false,
): PromotionServerError => ({ kind, message, field, reload });

export const BUSY_MESSAGE = 'Hay otra edición en curso. Espera un momento y reintenta.';

/**
 * 403 `PROMOTION_SCOPE_FORBIDDEN`; 404 `PROMOTION_NOT_FOUND` | `BRANCH_NOT_FOUND`; 409 `PROMOTION_CODE_TAKEN` |
 * `PROMOTION_VERSION_CONFLICT`; 422 `PROMOTION_{VALUE,PERIOD,SCHEDULE,SCOPE}_INVALID`; 503 `PROMOTIONS_BUSY`; 400, 401, 403.
 * Se ramifica por `businessCode`, nunca por el texto.
 */
export function promotionServerError(error: unknown): PromotionServerError {
  if (!isApiError(error)) return out('other', errorMessage(error));
  switch (error.businessCode) {
    case 'PROMOTION_CODE_TAKEN':
      return out('codeTaken', 'Ya existe una promoción con ese código. Elige otro.', 'code');
    case 'PROMOTION_VERSION_CONFLICT':
      return out(
        'versionConflict',
        'Otra persona modificó esta promoción mientras la editabas. Carga la versión actual para no pisar sus cambios.',
        undefined,
        true,
      );
    case 'PROMOTION_VALUE_INVALID':
      return out(
        'valueInvalid',
        'El valor está fuera de rango para este tipo de descuento.',
        'value',
      );
    case 'PROMOTION_PERIOD_INVALID':
      return out('periodInvalid', 'El fin de la vigencia debe ser posterior al inicio.', 'endsAt');
    case 'PROMOTION_SCHEDULE_INVALID':
      return out(
        'scheduleInvalid',
        'Revisa las franjas: el fin debe ser posterior al inicio, sin solapes (máx. 6 por día y 42 en total).',
        'schedule',
      );
    case 'PROMOTION_SCOPE_INVALID':
      return out(
        'scopeInvalid',
        'Revisa los productos: elige al menos uno y que existan.',
        'products',
        true,
      );
    case 'PROMOTION_SCOPE_FORBIDDEN':
      return out(
        'scopeForbidden',
        'No cubres todas las sucursales de esta promoción: pide a un administrador con alcance sobre todas que la edite.',
      );
    case 'BRANCH_NOT_FOUND':
      return out(
        'branchNotFound',
        'Alguna sucursal ya no existe o está fuera de tu alcance. Se recargaron los datos.',
        'branches',
        true,
      );
    case 'PROMOTION_NOT_FOUND':
      return out('notFound', 'La promoción ya no existe. Se recargó la lista.', undefined, true);
    case 'PROMOTIONS_BUSY':
      return out('busy', BUSY_MESSAGE);
  }
  if (error.status === 400) {
    return out('invalid', 'Revisa los datos del formulario.');
  }
  if (error.status === 401)
    return out('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  if (error.status === 403) return out('forbidden', 'No tienes permiso para esta acción.');
  return out('other', errorMessage(error));
}

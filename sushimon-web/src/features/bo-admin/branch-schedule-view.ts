import {
  MAX_INTERVALS_PER_DAY,
  isValidHm,
  normalizeWeek,
  sortIntervals,
  splitOvernight,
  validateWeek,
  weeksEqual,
  type WeekIssue,
} from '@/lib/branch-hours';
import { isApiError } from '@/lib/data-access/errors';
import type {
  BranchClosure,
  BranchHoursDay,
  CreateBranchClosureRequest,
  UpdateBranchClosureRequest,
} from '@/lib/data-access/models';
import { localInputToIso, type IsoWeekday } from '@/lib/time';
import type { ClosureStatusFilter } from '@/services/branch-schedule';
import { errorMessage } from '../bo-orders/error-message';

/**
 * Horario semanal y cierres (UI del backoffice) — F08. Lógica pura: borradores, detección de conflictos con los mismos
 * criterios del servidor (`lib/branch-hours`), cambio de turno nocturno (D4), validación de cierres y traducción de
 * errores del contrato (`code` + `violations`) a mensajes por día/intervalo o por campo. El backoffice es solo en español.
 */

export const WEEKDAY_NAMES: Record<IsoWeekday, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const DEFAULT_INTERVAL = { opensAt: '12:00', closesAt: '22:00' } as const;

// ── Horario semanal ───────────────────────────────────────────────────────────────────────

/** Copia editable de la semana (7 días ISO, intervalos ordenados). */
export const weekToDraft = (days: readonly BranchHoursDay[]): BranchHoursDay[] =>
  normalizeWeek(days);

export const isDraftDirty = (
  original: readonly BranchHoursDay[],
  draft: readonly BranchHoursDay[],
): boolean => !weeksEqual(original, draft);

/** Días cuyo horario cambió, para la confirmación («Lunes, Viernes»). */
export function changedDays(
  original: readonly BranchHoursDay[],
  draft: readonly BranchHoursDay[],
): string[] {
  const before = normalizeWeek(original);
  return normalizeWeek(draft)
    .filter((d, i) => JSON.stringify(d.intervals) !== JSON.stringify(before[i]?.intervals))
    .map((d) => WEEKDAY_NAMES[d.weekday]);
}

export const errorKey = (dayIndex: number, intervalIndex?: number) =>
  intervalIndex === undefined
    ? `days[${dayIndex}]`
    : `days[${dayIndex}].intervals[${intervalIndex}]`;

/** Problemas por ruta (`days[i].intervals[j]`): un mensaje por intervalo (el primero). */
export function issuesToErrors(issues: readonly WeekIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    // `days[i].intervals[j].weekday` y `.intervals` se muestran en el día.
    const path = /^days\[\d+\]\.intervals\[\d+\]$/.test(issue.path)
      ? issue.path
      : (/^days\[\d+\]/.exec(issue.path)?.[0] ?? issue.path);
    out[path] ??= issue.message;
  }
  return out;
}

/** Valida la semana en el cliente como lo hará el servidor (forma, rango y solape `[a,b)`; máx. 6). */
export const validateDraft = (draft: readonly BranchHoursDay[]) =>
  issuesToErrors(validateWeek(draft));

/** Primer campo con error en orden de pantalla (día → intervalo), para enfocarlo. */
export function firstErrorPath(errors: Record<string, string>): string | undefined {
  const rank = (path: string) => {
    const m = /days\[(\d+)\](?:\.intervals\[(\d+)\])?/.exec(path);
    return m ? Number(m[1]) * 100 + Number(m[2] ?? -1) : Number.MAX_SAFE_INTEGER;
  };
  return Object.keys(errors).sort((a, b) => rank(a) - rank(b))[0];
}

export const canAddInterval = (day: BranchHoursDay) => day.intervals.length < MAX_INTERVALS_PER_DAY;

export interface NightShiftResult {
  days?: BranchHoursDay[];
  error?: string;
  /** Texto de confirmación para el aviso en pantalla. */
  summary?: string;
}

/**
 * Atajo «pasa de medianoche» (D4): parte `weekday opensAt → closesAt (del día siguiente)` en dos intervalos y los agrega
 * al borrador. No valida solapes (eso lo hace `validateDraft` al guardar, con los mismos criterios del servidor).
 */
export function applyNightShift(
  draft: readonly BranchHoursDay[],
  weekday: IsoWeekday,
  opensAt: string,
  closesAt: string,
): NightShiftResult {
  if (!isValidHm(opensAt) || !isValidHm(closesAt) || closesAt === '24:00') {
    return { error: 'Usa el formato HH:mm (00:00 a 23:59).' };
  }
  const split = splitOvernight(weekday, opensAt, closesAt);
  if (!split) {
    return {
      error:
        'El cierre debe ser posterior a medianoche y anterior a la apertura (p. ej. 18:00 → 02:00). Si no cruza la medianoche, agrégalo como intervalo normal.',
    };
  }
  const days = normalizeWeek(draft).map((d) => {
    const add =
      d.weekday === split.first.weekday
        ? split.first
        : d.weekday === split.second.weekday
          ? split.second
          : null;
    return add ? { ...d, intervals: sortIntervals([...d.intervals, add.interval]) } : d;
  });
  return {
    days,
    summary: `${WEEKDAY_NAMES[split.first.weekday]} ${opensAt}–24:00 y ${WEEKDAY_NAMES[split.second.weekday]} 00:00–${closesAt}`,
  };
}

export type ScheduleErrorKind =
  'conflict' | 'busy' | 'invalid' | 'forbidden' | 'notFound' | 'other';

/** Máximo de cierres vigentes o futuros por sucursal (`CLOSURE_LIMIT_REACHED`). */
export const CLOSURE_LIMIT = 100;
/** Retroactividad máxima de `startsAt` (`STARTS_TOO_EARLY`): ahora − 1 hora. */
export const MAX_RETROACTIVE_MS = 3_600_000;

export const BUSY_MESSAGE =
  'Otra persona está guardando cambios en esta sucursal. Espera unos segundos y vuelve a intentar; no perdiste lo que escribiste.';

export interface ScheduleServerError {
  kind: ScheduleErrorKind;
  message: string;
  /** Errores por ruta (`days[i].intervals[j]`) para 422 `SCHEDULE_INVALID` y 400 con rutas. */
  byPath: Record<string, string>;
}

/** Traduce el error de `PUT …/hours` (409 `HOURS_VERSION_CONFLICT`, 422 `SCHEDULE_INVALID`, 400, 403, 404). */
export function scheduleServerError(error: unknown): ScheduleServerError {
  if (!isApiError(error)) return { kind: 'other', message: errorMessage(error), byPath: {} };
  if (error.status === 409 && error.businessCode === 'BRANCH_SCHEDULE_BUSY') {
    return { kind: 'busy', message: BUSY_MESSAGE, byPath: {} };
  }
  if (error.status === 409 && error.businessCode === 'HOURS_VERSION_CONFLICT') {
    return {
      kind: 'conflict',
      message:
        'Otra persona modificó el horario mientras lo editabas. Recarga para ver la versión vigente; tus cambios no guardados se descartarán.',
      byPath: {},
    };
  }
  if (error.status === 422 && error.businessCode === 'SCHEDULE_INVALID') {
    const byPath: Record<string, string> = {};
    for (const v of error.violations ?? []) byPath[v.path] ??= v.message;
    return {
      kind: 'invalid',
      message: 'Revisa los intervalos marcados: el horario no es válido.',
      byPath,
    };
  }
  if (error.status === 400) {
    const byPath: Record<string, string> = {};
    const rest: string[] = [];
    for (const detail of error.details ?? []) {
      const m = /^(days\[\d+\](?:\.intervals\[\d+\])?)[^:]*:\s*(.+)$/.exec(detail);
      if (m) byPath[m[1] as string] ??= m[2] as string;
      else rest.push(detail);
    }
    return {
      kind: 'invalid',
      message: `Revisa los datos${rest.length ? `: ${rest.join(' · ')}` : '.'}`,
      byPath,
    };
  }
  if (error.status === 403) {
    return { kind: 'forbidden', message: 'No tienes permiso para modificar horarios.', byPath: {} };
  }
  if (error.status === 404) {
    return {
      kind: 'notFound',
      message: 'La sucursal ya no existe o no está en tu alcance.',
      byPath: {},
    };
  }
  return { kind: 'other', message: errorMessage(error), byPath: {} };
}

// ── Cierres extraordinarios ───────────────────────────────────────────────────────────────

export const CLOSURE_FILTERS: { value: ClosureStatusFilter; label: string }[] = [
  { value: 'current', label: 'En curso y próximos' },
  { value: 'active', label: 'En curso' },
  { value: 'upcoming', label: 'Próximos' },
  { value: 'past', label: 'Terminados' },
  { value: 'all', label: 'Todos' },
];

export const CLOSURE_STATUS_LABEL: Record<BranchClosure['status'], string> = {
  active: 'En curso',
  upcoming: 'Próximo',
  past: 'Terminado',
};

export const CLOSURE_STATUS_TONE: Record<BranchClosure['status'], 'warning' | 'info' | 'muted'> = {
  active: 'warning',
  upcoming: 'info',
  past: 'muted',
};

export const CLOSURE_PAGE_SIZE = 10;
export const CLOSURE_REASON_MAX = 200;
const DAY_MS = 86_400_000;
const MAX_DURATION_DAYS = 366;
const MAX_FUTURE_DAYS = 730;

export interface ClosureFormValues {
  /** `YYYY-MM-DDTHH:mm` (hora de Guatemala), el valor de `<input type="datetime-local">`. */
  startsAt: string;
  endsAt: string;
  reason: string;
}
export type ClosureField = keyof ClosureFormValues;
export type ClosureFormErrors = Partial<Record<ClosureField, string>>;
export const CLOSURE_FIELDS: readonly ClosureField[] = ['startsAt', 'endsAt', 'reason'];

export const emptyClosureForm = (): ClosureFormValues => ({ startsAt: '', endsAt: '', reason: '' });

export type ClosureEditMode = 'create' | 'upcoming' | 'active';

/**
 * Valida como el servidor (D7/D8). `now` es la hora del SERVIDOR (no el reloj del dispositivo). En un cierre en curso solo
 * se puede ACORTAR el fin (`startsAt` fijo, `endsAt` ≤ el actual) y editar el motivo.
 */
export function validateClosureForm(
  values: ClosureFormValues,
  mode: ClosureEditMode,
  now: Date | null,
  current?: Pick<BranchClosure, 'startsAt' | 'endsAt'>,
): ClosureFormErrors {
  const errors: ClosureFormErrors = {};
  const start = values.startsAt ? localInputToIso(values.startsAt) : null;
  const end = values.endsAt ? localInputToIso(values.endsAt) : null;
  if (mode !== 'active') {
    if (!values.startsAt) errors.startsAt = 'Indica cuándo empieza el cierre.';
    else if (!start) errors.startsAt = 'Fecha y hora de inicio inválidas.';
  }
  if (!values.endsAt) errors.endsAt = 'Indica cuándo termina el cierre.';
  else if (!end) errors.endsAt = 'Fecha y hora de fin inválidas.';

  const startMs =
    mode === 'active' && current
      ? new Date(current.startsAt).getTime()
      : start
        ? Date.parse(start)
        : null;
  const endMs = end ? Date.parse(end) : null;
  if (!errors.endsAt && startMs !== null && endMs !== null) {
    if (endMs <= startMs) errors.endsAt = 'El fin debe ser posterior al inicio.';
    else if (endMs - startMs > MAX_DURATION_DAYS * DAY_MS) {
      errors.endsAt = `Un cierre dura como máximo ${MAX_DURATION_DAYS} días.`;
    } else if (mode === 'active' && current && endMs > Date.parse(current.endsAt)) {
      errors.endsAt =
        'En un cierre en curso solo puedes acortar el fin (para ampliarlo, crea otro cierre).';
    }
  }
  if (!errors.endsAt && endMs !== null && now && mode !== 'active' && endMs <= now.getTime()) {
    errors.endsAt = 'El cierre ya terminó: elige un fin posterior a este momento.';
  }
  if (
    !errors.startsAt &&
    startMs !== null &&
    now &&
    mode !== 'active' &&
    startMs < now.getTime() - MAX_RETROACTIVE_MS
  ) {
    errors.startsAt = 'El inicio no puede ser anterior a una hora atrás.';
  }
  if (
    !errors.startsAt &&
    startMs !== null &&
    now &&
    mode !== 'active' &&
    startMs > now.getTime() + MAX_FUTURE_DAYS * DAY_MS
  ) {
    errors.startsAt = 'El inicio no puede superar los 2 años a futuro.';
  }
  if (values.reason.trim().length > CLOSURE_REASON_MAX) {
    errors.reason = `El motivo admite hasta ${CLOSURE_REASON_MAX} caracteres.`;
  }
  return errors;
}

export const firstClosureError = (errors: ClosureFormErrors): ClosureField | undefined =>
  CLOSURE_FIELDS.find((f) => errors[f]);

/** ¿Un cierre nuevo/editado afecta a la sucursal de inmediato (empieza ya)? Pide confirmación extra. */
export function startsNow(values: ClosureFormValues, now: Date | null): boolean {
  const start = values.startsAt ? localInputToIso(values.startsAt) : null;
  return !!start && !!now && Date.parse(start) <= now.getTime();
}

export function toCreateClosure(values: ClosureFormValues): CreateBranchClosureRequest {
  return {
    startsAt: localInputToIso(values.startsAt) as string,
    endsAt: localInputToIso(values.endsAt) as string,
    reason: values.reason.trim() || null,
  };
}

/** Solo los campos que cambiaron (el contrato exige al menos uno); `null` = sin cambios. */
export function toUpdateClosure(
  values: ClosureFormValues,
  original: BranchClosure,
  fixedStart: boolean,
): UpdateBranchClosureRequest | null {
  const next = toCreateClosure(values);
  const patch: UpdateBranchClosureRequest = {};
  if (!fixedStart && next.startsAt !== original.startsAt) patch.startsAt = next.startsAt;
  if (next.endsAt !== original.endsAt) patch.endsAt = next.endsAt;
  if ((next.reason ?? null) !== (original.reason ?? null)) patch.reason = next.reason ?? null;
  return Object.keys(patch).length ? patch : null;
}

export interface ClosureServerError {
  /** `BRANCH_SCHEDULE_BUSY`: reintentable sin perder lo escrito. */
  busy?: boolean;
  message: string;
  fields: ClosureFormErrors;
}

/** Traduce 422 `CLOSURE_RANGE_INVALID`, 409 (`CLOSURE_OVERLAP`, `CLOSURE_NOT_EDITABLE`, `CLOSURE_NOT_DELETABLE`), 400… */
export function closureServerError(error: unknown): ClosureServerError {
  if (!isApiError(error)) return { message: errorMessage(error), fields: {} };
  const fields: ClosureFormErrors = {};
  if (error.status === 422 && error.businessCode === 'CLOSURE_RANGE_INVALID') {
    const text: Record<string, string> = {
      RANGE_EMPTY: 'El fin debe ser posterior al inicio.',
      DURATION_EXCEEDED: `Un cierre dura como máximo ${MAX_DURATION_DAYS} días.`,
      STARTS_TOO_FAR: 'El inicio no puede superar los 2 años a futuro.',
      STARTS_TOO_EARLY: 'El inicio no puede ser anterior a una hora atrás.',
      ALREADY_ENDED: 'El cierre ya terminó: elige un fin posterior a este momento.',
    };
    for (const v of error.violations ?? []) {
      const field = v.path === 'startsAt' ? 'startsAt' : 'endsAt';
      fields[field] ??= text[v.code] ?? v.message;
    }
    return { message: 'Revisa el rango del cierre.', fields };
  }
  switch (error.businessCode) {
    case 'BRANCH_SCHEDULE_BUSY':
      return { busy: true, message: BUSY_MESSAGE, fields };
    case 'CLOSURE_LIMIT_REACHED':
      return {
        message: `Esta sucursal ya tiene el máximo de ${CLOSURE_LIMIT} cierres vigentes o futuros. Cancela o termina alguno antes de crear otro.`,
        fields,
      };
    case 'CLOSURE_OVERLAP':
      return {
        message:
          'Se solapa con otro cierre de esta sucursal. Ajusta las fechas o edita el existente.',
        fields: { startsAt: 'Se solapa con otro cierre.' },
      };
    case 'CLOSURE_NOT_EDITABLE':
      return {
        message:
          'Este cierre ya no se puede editar así (terminó, o está en curso: solo se puede acortar el fin y cambiar el motivo).',
        fields,
      };
    case 'CLOSURE_NOT_DELETABLE':
      return {
        message:
          'Solo se pueden cancelar los cierres futuros. Un cierre en curso se termina con «Terminar ahora».',
        fields,
      };
  }
  if (error.status === 400) {
    for (const detail of error.details ?? []) {
      const field = CLOSURE_FIELDS.find((f) => detail.startsWith(`${f}:`));
      if (field) fields[field] ??= detail.slice(field.length + 1).trim();
    }
    return {
      message: `Revisa los datos: ${(error.details ?? []).join(' · ') || error.message}`,
      fields,
    };
  }
  if (error.status === 403) return { message: 'No tienes permiso para modificar cierres.', fields };
  if (error.status === 404) return { message: 'El cierre o la sucursal ya no existe.', fields };
  return { message: errorMessage(error), fields };
}

const closureDateFormat = new Intl.DateTimeFormat('es-GT', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Guatemala',
});

export const formatClosureInstant = (iso: string): string =>
  closureDateFormat.format(new Date(iso));

export const formatClosureRange = (c: Pick<BranchClosure, 'startsAt' | 'endsAt'>): string =>
  `${formatClosureInstant(c.startsAt)} → ${formatClosureInstant(c.endsAt)}`;

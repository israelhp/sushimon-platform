import { BadRequestException, HttpStatus } from '@nestjs/common';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import { MS_PER_DAY, parseInstant, truncateToSecond } from './business-time.js';

/** Reglas puras de cierres excepcionales (spec F08 D7/D8): sin I/O ni reloj (reciben `now`). */

export const REASON_MAX = 200;
export const MAX_DURATION_MS = 366 * MS_PER_DAY;
/** «startsAt máx. 2 años a futuro»: 2 × 365 días de reloj. */
export const MAX_START_AHEAD_MS = 730 * MS_PER_DAY;
/** Retroactividad máxima de `startsAt` (S3): no antes de «ahora − 1 hora». */
export const MAX_START_BEHIND_MS = 60 * 60 * 1000;

export type ClosureStatus = 'upcoming' | 'active' | 'past';

export interface ClosureRecord {
  id: string;
  branchId: string;
  startsAt: number;
  endsAt: number;
  reason: string | null;
}

export interface ClosureValues {
  startsAt: number;
  endsAt: number;
  reason: string | null;
}

/** `upcoming`: startsAt > now · `active`: startsAt <= now < endsAt · `past`: endsAt <= now. */
export function closureStatus(c: { startsAt: number; endsAt: number }, now: number): ClosureStatus {
  if (c.endsAt <= now) return 'past';
  if (c.startsAt > now) return 'upcoming';
  return 'active';
}

/** Instante ISO 8601 con zona -> ms UTC truncados al segundo; 400 si falta zona o es inválido. */
export function parseClosureInstant(raw: string, field: string): number {
  const ms = parseInstant(raw);
  if (ms === null)
    throw new BadRequestException([
      `${field} debe ser un instante ISO 8601 con zona (Z o ±hh:mm), p. ej. 2026-11-16T17:00:00Z`,
    ]);
  return truncateToSecond(ms);
}

/** trim; vacío => null; > 200 => 400. `undefined` (no enviado) se conserva. */
export function normalizeReason(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const reason = raw.trim();
  if (reason.length > REASON_MAX)
    throw new BadRequestException([`reason no puede superar ${REASON_MAX} caracteres`]);
  return reason === '' ? null : reason;
}

function rangeInvalid(violations: ErrorViolation[]): never {
  throw codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CLOSURE_RANGE_INVALID',
    'Rango de cierre inválido',
    violations,
  );
}

/** 422 `CLOSURE_RANGE_INVALID` con todas las violaciones del rango (D7). */
export function assertClosureRange(range: { startsAt: number; endsAt: number }, now: number): void {
  const violations: ErrorViolation[] = [];
  if (range.endsAt <= range.startsAt) {
    violations.push({
      path: 'endsAt',
      code: 'RANGE_EMPTY',
      message: 'endsAt debe ser posterior a startsAt',
    });
  } else if (range.endsAt - range.startsAt > MAX_DURATION_MS) {
    violations.push({
      path: 'endsAt',
      code: 'DURATION_EXCEEDED',
      message: 'Un cierre no puede durar más de 366 días',
    });
  }
  if (range.startsAt - now > MAX_START_AHEAD_MS) {
    violations.push({
      path: 'startsAt',
      code: 'STARTS_TOO_FAR',
      message: 'startsAt no puede superar 2 años a futuro',
    });
  }
  if (now - range.startsAt > MAX_START_BEHIND_MS) {
    violations.push({
      path: 'startsAt',
      code: 'STARTS_TOO_EARLY',
      message: 'startsAt no puede ser anterior a 1 hora atrás',
    });
  }
  if (range.endsAt <= now) {
    violations.push({
      path: 'endsAt',
      code: 'ALREADY_ENDED',
      message: 'El cierre ya habría terminado',
    });
  }
  if (violations.length > 0) rangeInvalid(violations);
}

const notEditable = (message: string): never => {
  throw codedException(HttpStatus.CONFLICT, 'CLOSURE_NOT_EDITABLE', message);
};

export interface PatchInput {
  startsAt?: number;
  endsAt?: number;
  /** undefined = no enviado; null = borrar el motivo. */
  reason?: string | null;
}

/**
 * Resultado de aplicar un PATCH según el estado del cierre (D8):
 * - terminado: inmutable (409 `CLOSURE_NOT_EDITABLE`);
 * - futuro: `startsAt/endsAt/reason` libres (se valida el rango completo);
 * - en curso: solo `reason` y ACORTAR `endsAt` (`startsAt < nuevo <= actual`); `endsAt <= now` => se fija a «ahora»
 *   (termina ya); cambiar `startsAt` o alargar => 409.
 * `changed = false` si no hay cambios reales (sin escritura ni auditoría).
 */
export function planClosurePatch(
  current: ClosureValues & { id: string },
  patch: PatchInput,
  now: number,
): { next: ClosureValues; changed: boolean } {
  const status = closureStatus(current, now);
  if (status === 'past') return notEditable('El cierre ya terminó y no se puede modificar');
  const reason = patch.reason !== undefined ? patch.reason : current.reason;
  let next: ClosureValues;

  if (status === 'active') {
    if (patch.startsAt !== undefined && patch.startsAt !== current.startsAt)
      return notEditable('No se puede cambiar el inicio de un cierre en curso');
    let endsAt = current.endsAt;
    if (patch.endsAt !== undefined) {
      endsAt = patch.endsAt <= now ? truncateToSecond(now) : patch.endsAt;
      if (endsAt > current.endsAt)
        return notEditable('Un cierre en curso solo se puede acortar, no alargar');
      if (endsAt <= current.startsAt) {
        return rangeInvalid([
          {
            path: 'endsAt',
            code: 'RANGE_EMPTY',
            message: 'endsAt debe ser posterior a startsAt; reintenta en un instante',
          },
        ]);
      }
    }
    next = { startsAt: current.startsAt, endsAt, reason };
  } else {
    next = {
      startsAt: patch.startsAt ?? current.startsAt,
      endsAt: patch.endsAt ?? current.endsAt,
      reason,
    };
    assertClosureRange(next, now);
  }

  const changed =
    next.startsAt !== current.startsAt ||
    next.endsAt !== current.endsAt ||
    next.reason !== current.reason;
  return { next, changed };
}

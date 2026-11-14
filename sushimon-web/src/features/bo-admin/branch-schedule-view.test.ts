import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { BranchClosure } from '@/lib/data-access/models';
import { emptyWeek } from '@/lib/branch-hours';
import {
  applyNightShift,
  changedDays,
  closureServerError,
  firstErrorPath,
  isDraftDirty,
  issuesToErrors,
  scheduleServerError,
  startsNow,
  toCreateClosure,
  toUpdateClosure,
  validateClosureForm,
  validateDraft,
  weekToDraft,
} from './branch-schedule-view';
import { validateWeek } from '@/lib/branch-hours';

const iv = (opensAt: string, closesAt: string) => ({ opensAt, closesAt });
const now = new Date('2026-11-11T20:25:00.000Z'); // miércoles 14:25 GT

describe('borrador del horario', () => {
  const base = weekToDraft(
    emptyWeek().map((d) => (d.weekday === 1 ? { ...d, intervals: [iv('12:00', '22:00')] } : d)),
  );
  it('detecta cambios y nombra los días modificados', () => {
    expect(isDraftDirty(base, base)).toBe(false);
    const next = base.map((d) =>
      d.weekday === 5 ? { ...d, intervals: [iv('11:00', '24:00')] } : d,
    );
    expect(isDraftDirty(base, next)).toBe(true);
    expect(changedDays(base, next)).toEqual(['Viernes']);
  });
  it('validateDraft: un mensaje por intervalo con la ruta del servidor', () => {
    const draft = base.map((d) =>
      d.weekday === 1 ? { ...d, intervals: [iv('12:00', '22:00'), iv('20:00', '23:00')] } : d,
    );
    expect(validateDraft(draft)).toEqual({
      'days[0].intervals[1]': 'Se solapa con days[0].intervals[0] (12:00-22:00)',
    });
  });
  it('los errores de día (más de 6 intervalos) se asignan al día; firstErrorPath sigue el orden de pantalla', () => {
    const errors = issuesToErrors(
      validateWeek(
        base.map((d) =>
          d.weekday === 3
            ? { ...d, intervals: Array.from({ length: 7 }, (_, k) => iv(`0${k}:00`, `0${k}:30`)) }
            : d.weekday === 1
              ? { ...d, intervals: [iv('x', 'y')] }
              : d,
        ),
      ),
    );
    expect(Object.keys(errors).sort()).toEqual(['days[0].intervals[0]', 'days[2]']);
    expect(firstErrorPath(errors)).toBe('days[0].intervals[0]');
  });
});

describe('atajo «pasa de medianoche»', () => {
  it('agrega dos intervalos en días consecutivos', () => {
    const r = applyNightShift(emptyWeek(), 5, '18:00', '02:00');
    expect(r.days?.[4]?.intervals).toEqual([iv('18:00', '24:00')]);
    expect(r.days?.[5]?.intervals).toEqual([iv('00:00', '02:00')]);
    expect(r.summary).toBe('Viernes 18:00–24:00 y Sábado 00:00–02:00');
  });
  it('domingo pasa al lunes', () => {
    expect(applyNightShift(emptyWeek(), 7, '20:00', '01:00').days?.[0]?.intervals).toEqual([
      iv('00:00', '01:00'),
    ]);
  });
  it('rechaza lo que no cruza medianoche o tiene formato inválido', () => {
    expect(applyNightShift(emptyWeek(), 5, '10:00', '18:00').error).toMatch(
      /posterior a medianoche/,
    );
    expect(applyNightShift(emptyWeek(), 5, '1800', '02:00').error).toMatch(/formato HH:mm/);
    expect(applyNightShift(emptyWeek(), 5, '18:00', '24:00').error).toMatch(/formato HH:mm/);
  });
});

describe('errores del PUT de horario', () => {
  it('409 HOURS_VERSION_CONFLICT => conflicto (recarga)', () => {
    const e = new ApiError(409, 'conflict', 'x', undefined, undefined, 'HOURS_VERSION_CONFLICT');
    expect(scheduleServerError(e).kind).toBe('conflict');
  });
  it('409 BRANCH_SCHEDULE_BUSY => reintentable (busy)', () => {
    const e = new ApiError(409, 'conflict', 'x', undefined, undefined, 'BRANCH_SCHEDULE_BUSY');
    expect(scheduleServerError(e)).toMatchObject({
      kind: 'busy',
      message: expect.stringMatching(/vuelve a intentar/),
    });
  });
  it('409 sin ese código no es un conflicto de versión', () => {
    expect(scheduleServerError(new ApiError(409, 'conflict', 'otro')).kind).toBe('other');
  });
  it('422 SCHEDULE_INVALID => errores por ruta', () => {
    const e = new ApiError(422, 'unprocessable', 'x', undefined, undefined, 'SCHEDULE_INVALID', [
      { path: 'days[4].intervals[1]', code: 'INTERVAL_OVERLAP', message: 'Se solapa' },
    ]);
    expect(scheduleServerError(e)).toMatchObject({
      kind: 'invalid',
      byPath: { 'days[4].intervals[1]': 'Se solapa' },
    });
  });
  it('400 con details que nombran el día o el intervalo', () => {
    const e = new ApiError(400, 'bad_request', 'x', undefined, [
      'days[2].intervals[0]: Usa el formato HH:mm',
      'expectedVersion: inválida',
    ]);
    const r = scheduleServerError(e);
    expect(r.byPath).toEqual({ 'days[2].intervals[0]': 'Usa el formato HH:mm' });
    expect(r.message).toContain('expectedVersion: inválida');
  });
  it('403 y 404', () => {
    expect(scheduleServerError(new ApiError(403, 'forbidden', 'x')).kind).toBe('forbidden');
    expect(scheduleServerError(new ApiError(404, 'not_found', 'x')).kind).toBe('notFound');
  });
});

describe('formulario de cierres', () => {
  const ok = { startsAt: '2026-12-01T10:00', endsAt: '2026-12-01T12:00', reason: '' };
  it('válido', () => expect(validateClosureForm(ok, 'create', now)).toEqual({}));
  it('campos obligatorios y fin posterior', () => {
    expect(validateClosureForm({ ...ok, startsAt: '' }, 'create', now).startsAt).toMatch(/empieza/);
    expect(
      validateClosureForm({ ...ok, endsAt: '2026-12-01T10:00' }, 'create', now).endsAt,
    ).toMatch(/posterior al inicio/);
  });
  it('duración máx. 366 días, inicio máx. 2 años, ya terminado y motivo ≤ 200', () => {
    expect(
      validateClosureForm({ ...ok, endsAt: '2027-12-03T10:00' }, 'create', now).endsAt,
    ).toMatch(/366/);
    expect(
      validateClosureForm(
        { ...ok, startsAt: '2029-01-01T10:00', endsAt: '2029-01-02T10:00' },
        'create',
        now,
      ).startsAt,
    ).toMatch(/2 años/);
    expect(
      validateClosureForm(
        { ...ok, startsAt: '2026-11-01T10:00', endsAt: '2026-11-02T10:00' },
        'create',
        now,
      ).endsAt,
    ).toMatch(/ya terminó/);
    expect(validateClosureForm({ ...ok, reason: 'x'.repeat(201) }, 'create', now).reason).toMatch(
      /200/,
    );
  });
  it('inicio anterior a ahora − 1 h (límite exacto permitido), en alta y en edición de futuros', () => {
    // ahora = 14:25 GT: 13:25 es el límite
    const at = (startsAt: string) => ({ startsAt, endsAt: '2026-11-11T20:00', reason: '' });
    expect(validateClosureForm(at('2026-11-11T13:25'), 'create', now)).toEqual({});
    expect(validateClosureForm(at('2026-11-11T13:24'), 'create', now).startsAt).toMatch(
      /una hora atrás/,
    );
    expect(validateClosureForm(at('2026-11-11T13:24'), 'upcoming', now).startsAt).toMatch(
      /una hora atrás/,
    );
  });
  it('en curso: el fin solo se acorta', () => {
    const current = { startsAt: '2026-11-11T19:00:00.000Z', endsAt: '2026-11-11T23:00:00.000Z' };
    const values = { startsAt: '2026-11-11T13:00', endsAt: '2026-11-11T17:00', reason: '' }; // 23:00Z
    expect(validateClosureForm(values, 'active', now, current)).toEqual({});
    expect(
      validateClosureForm({ ...values, endsAt: '2026-11-11T18:00' }, 'active', now, current).endsAt,
    ).toMatch(/acortar/);
  });
  it('convierte la hora de Guatemala a ISO UTC y detecta si empieza ya', () => {
    expect(toCreateClosure({ ...ok, reason: '  Feriado ' })).toEqual({
      startsAt: '2026-12-01T16:00:00.000Z',
      endsAt: '2026-12-01T18:00:00.000Z',
      reason: 'Feriado',
    });
    expect(toCreateClosure(ok).reason).toBeNull();
    expect(startsNow({ ...ok, startsAt: '2026-11-11T14:00' }, now)).toBe(true);
    expect(startsNow(ok, now)).toBe(false);
  });
  it('toUpdateClosure envía solo lo que cambió', () => {
    const original: BranchClosure = {
      id: 'c',
      branchId: 'b',
      startsAt: '2026-12-01T16:00:00.000Z',
      endsAt: '2026-12-01T18:00:00.000Z',
      reason: null,
      status: 'upcoming',
    };
    expect(toUpdateClosure(ok, original, false)).toBeNull();
    expect(
      toUpdateClosure({ ...ok, endsAt: '2026-12-01T13:00', reason: 'x' }, original, false),
    ).toEqual({ endsAt: '2026-12-01T19:00:00.000Z', reason: 'x' });
    expect(toUpdateClosure({ ...ok, startsAt: '2026-12-01T09:00' }, original, true)).toBeNull();
  });
});

describe('errores de cierres', () => {
  const err = (
    status: number,
    code: string | undefined,
    violations?: { path: string; code: string; message: string }[],
  ) => new ApiError(status, 'x', 'm', undefined, undefined, code, violations);
  it('422 CLOSURE_RANGE_INVALID asigna a startsAt/endsAt', () => {
    const r = closureServerError(
      err(422, 'CLOSURE_RANGE_INVALID', [
        { path: 'endsAt', code: 'ALREADY_ENDED', message: 'm' },
        { path: 'startsAt', code: 'STARTS_TOO_FAR', message: 'm' },
      ]),
    );
    expect(r.fields.endsAt).toMatch(/ya terminó/);
    expect(r.fields.startsAt).toMatch(/2 años/);
  });
  it('BRANCH_SCHEDULE_BUSY es reintentable y CLOSURE_LIMIT_REACHED explica el tope', () => {
    expect(closureServerError(err(409, 'BRANCH_SCHEDULE_BUSY'))).toMatchObject({ busy: true });
    const limit = closureServerError(err(422, 'CLOSURE_LIMIT_REACHED'));
    expect(limit.busy).toBeUndefined();
    expect(limit.message).toMatch(/máximo de 100 cierres/);
  });
  it('STARTS_TOO_EARLY se asigna a startsAt', () => {
    const r = closureServerError(
      err(422, 'CLOSURE_RANGE_INVALID', [
        { path: 'startsAt', code: 'STARTS_TOO_EARLY', message: 'm' },
      ]),
    );
    expect(r.fields).toEqual({ startsAt: 'El inicio no puede ser anterior a una hora atrás.' });
  });
  it('409 por código de negocio', () => {
    expect(closureServerError(err(409, 'CLOSURE_OVERLAP')).message).toMatch(/solapa/);
    expect(closureServerError(err(409, 'CLOSURE_NOT_EDITABLE')).message).toMatch(/acortar/);
    expect(closureServerError(err(409, 'CLOSURE_NOT_DELETABLE')).message).toMatch(/Terminar ahora/);
  });
});

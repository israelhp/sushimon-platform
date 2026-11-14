import { BadRequestException, HttpException } from '@nestjs/common';
import { MS_PER_DAY } from './business-time.js';
import {
  assertClosureRange,
  closureStatus,
  normalizeReason,
  parseClosureInstant,
  planClosurePatch,
  type ClosureValues,
} from './closure-policy.js';

const NOW = Date.parse('2026-11-16T18:00:00.000Z');
const H = 3_600_000;

function failure(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const body = (e: HttpException) =>
  e.getResponse() as { code?: string; violations?: { code: string; path: string }[] };

const cur = (startsAt: number, endsAt: number, reason: string | null = null) => ({
  id: 'c1',
  startsAt,
  endsAt,
  reason,
});

describe('closure-policy', () => {
  it('closureStatus: límites [startsAt, endsAt) con el reloj dado', () => {
    const c = { startsAt: NOW, endsAt: NOW + H };
    expect(closureStatus(c, NOW - 1)).toBe('upcoming');
    expect(closureStatus(c, NOW)).toBe('active'); // startsAt <= ahora
    expect(closureStatus(c, NOW + H - 1)).toBe('active');
    expect(closureStatus(c, NOW + H)).toBe('past'); // endsAt <= ahora
  });

  it('parseClosureInstant: trunca al segundo; sin zona => 400', () => {
    expect(parseClosureInstant('2026-11-16T11:00:00.900-06:00', 'startsAt')).toBe(NOW - H);
    expect(() => parseClosureInstant('2026-11-16T11:00:00', 'startsAt')).toThrow(
      BadRequestException,
    );
  });

  it('normalizeReason: trim, vacío => null, undefined se conserva, > 200 => 400', () => {
    expect(normalizeReason('  Mantenimiento  ')).toBe('Mantenimiento');
    expect(normalizeReason('   ')).toBeNull();
    expect(normalizeReason(null)).toBeNull();
    expect(normalizeReason(undefined)).toBeUndefined();
    expect(normalizeReason(`${'a'.repeat(200)}   `)).toHaveLength(200);
    expect(() => normalizeReason('a'.repeat(201))).toThrow(BadRequestException);
  });

  describe('assertClosureRange (422 CLOSURE_RANGE_INVALID)', () => {
    const codes = (startsAt: number, endsAt: number) =>
      body(failure(() => assertClosureRange({ startsAt, endsAt }, NOW))).violations?.map(
        (v) => v.code,
      );

    it('válidos: futuro, en curso ya iniciado, duración 366 d exacta, inicio a 730 d exactos', () => {
      expect(() =>
        assertClosureRange({ startsAt: NOW + H, endsAt: NOW + 2 * H }, NOW),
      ).not.toThrow();
      expect(
        () => assertClosureRange({ startsAt: NOW - H, endsAt: NOW + 1000 }, NOW), // retroactividad máx. 1 h exacta
      ).not.toThrow();
      expect(() =>
        assertClosureRange({ startsAt: NOW + H, endsAt: NOW + H + 366 * MS_PER_DAY }, NOW),
      ).not.toThrow();
      expect(() =>
        assertClosureRange(
          { startsAt: NOW + 730 * MS_PER_DAY, endsAt: NOW + 730 * MS_PER_DAY + H },
          NOW,
        ),
      ).not.toThrow();
    });

    it('RANGE_EMPTY, DURATION_EXCEEDED, STARTS_TOO_FAR y ALREADY_ENDED', () => {
      expect(codes(NOW + H, NOW + H)).toEqual(['RANGE_EMPTY']);
      expect(codes(NOW + H, NOW)).toEqual(['RANGE_EMPTY', 'ALREADY_ENDED']); // se informan todas
      expect(codes(NOW + H, NOW + H + 366 * MS_PER_DAY + 1000)).toEqual(['DURATION_EXCEEDED']);
      expect(codes(NOW + 730 * MS_PER_DAY + 1000, NOW + 730 * MS_PER_DAY + H)).toEqual([
        'STARTS_TOO_FAR',
      ]);
      expect(codes(NOW - 2 * H, NOW - H)).toEqual(['STARTS_TOO_EARLY', 'ALREADY_ENDED']);
      expect(codes(NOW - H - 1000, NOW + H)).toEqual(['STARTS_TOO_EARLY']);
      expect(codes(NOW - 5 * H, NOW + H)).toEqual(['STARTS_TOO_EARLY']);
      expect(codes(NOW - H, NOW)).toEqual(['ALREADY_ENDED']); // endsAt <= ahora
    });

    it('lleva code y path por violación', () => {
      const e = failure(() => assertClosureRange({ startsAt: NOW + H, endsAt: NOW + H }, NOW));
      expect(e.getStatus()).toBe(422);
      expect(body(e)).toMatchObject({
        code: 'CLOSURE_RANGE_INVALID',
        violations: [{ path: 'endsAt', code: 'RANGE_EMPTY' }],
      });
    });
  });

  describe('planClosurePatch', () => {
    const future = cur(NOW + 2 * H, NOW + 4 * H, 'a');
    const active = cur(NOW - H, NOW + 3 * H, 'a');
    const past = cur(NOW - 4 * H, NOW - 2 * H, 'a');
    const conflict = (e: HttpException) => [e.getStatus(), body(e).code];

    it('terminado: inmutable, incluso con cambios vacíos o solo reason', () => {
      for (const patch of [{ reason: 'x' }, { endsAt: NOW - H }, {}]) {
        expect(conflict(failure(() => planClosurePatch(past, patch, NOW)))).toEqual([
          409,
          'CLOSURE_NOT_EDITABLE',
        ]);
      }
    });

    it('futuro: cambia startsAt/endsAt/reason y valida el rango completo', () => {
      const r = planClosurePatch(
        future,
        { startsAt: NOW + H, endsAt: NOW + 5 * H, reason: null },
        NOW,
      );
      expect(r).toEqual({
        next: { startsAt: NOW + H, endsAt: NOW + 5 * H, reason: null } satisfies ClosureValues,
        changed: true,
      });
      expect(
        body(failure(() => planClosurePatch(future, { endsAt: NOW + H }, NOW))).violations?.[0]
          ?.code,
      ).toBe('RANGE_EMPTY');
      expect(planClosurePatch(future, { reason: 'a' }, NOW).changed).toBe(false);
    });

    it('en curso: acorta endsAt y cambia reason', () => {
      const r = planClosurePatch(active, { endsAt: NOW + H, reason: 'b' }, NOW);
      expect(r.next).toEqual({ startsAt: active.startsAt, endsAt: NOW + H, reason: 'b' });
      expect(r.changed).toBe(true);
      expect(planClosurePatch(active, { endsAt: active.endsAt }, NOW).changed).toBe(false);
    });

    it('en curso: endsAt <= ahora termina YA (se fija a ahora, truncado al segundo)', () => {
      const at = NOW + 500; // 18:00:00.500
      const r = planClosurePatch(active, { endsAt: NOW - 10 * H }, at);
      expect(r.next.endsAt).toBe(NOW);
      expect(closureStatus(r.next, at)).toBe('past');
    });

    it('en curso: cambiar startsAt o alargar endsAt => 409; ahora == startsAt => 422 reintentable', () => {
      expect(
        conflict(
          failure(() => planClosurePatch(active, { startsAt: active.startsAt - 1000 }, NOW)),
        ),
      ).toEqual([409, 'CLOSURE_NOT_EDITABLE']);
      expect(
        conflict(failure(() => planClosurePatch(active, { endsAt: active.endsAt + 1000 }, NOW))),
      ).toEqual([409, 'CLOSURE_NOT_EDITABLE']);
      // El mismo startsAt no es un cambio.
      expect(
        planClosurePatch(active, { startsAt: active.startsAt, reason: 'z' }, NOW).changed,
      ).toBe(true);
      const justStarted = cur(NOW, NOW + 3 * H);
      const e = failure(() => planClosurePatch(justStarted, { endsAt: NOW - 1 }, NOW));
      expect(conflict(e)).toEqual([422, 'CLOSURE_RANGE_INVALID']);
    });
  });
});

import { BadRequestException, HttpException } from '@nestjs/common';
import { translateScheduleDbError } from './schedule-db-errors.js';

const coded = (e: unknown) => e as HttpException;

describe('translateScheduleDbError', () => {
  it('23P01 de branch_closures_no_overlap => 409 CLOSURE_OVERLAP', () => {
    const e = coded(
      translateScheduleDbError(
        { code: 'P2010', meta: { code: '23P01' }, message: 'branch_closures_no_overlap' },
        'closure',
      ),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toMatchObject({ code: 'CLOSURE_OVERLAP' });
  });

  it('23P01 de branch_hours_no_overlap => 422 SCHEDULE_INVALID con INTERVAL_OVERLAP', () => {
    const e = coded(
      translateScheduleDbError(
        {
          meta: {
            driverAdapterError: {
              cause: { originalCode: '23P01', constraint: 'branch_hours_no_overlap' },
            },
          },
        },
        'closure',
      ),
    );
    expect(e.getStatus()).toBe(422);
    expect(e.getResponse()).toMatchObject({
      code: 'SCHEDULE_INVALID',
      violations: [{ code: 'INTERVAL_OVERLAP' }],
    });
  });

  it('sin nombre de restricción se usa el contexto', () => {
    expect(coded(translateScheduleDbError({ code: '23P01' }, 'closure')).getStatus()).toBe(409);
    expect(coded(translateScheduleDbError({ code: '23P01' }, 'hours')).getStatus()).toBe(422);
  });

  it('CHECK (23514 / P2004) => 400 genérico sin filtrar la restricción', () => {
    for (const code of ['23514', 'P2004']) {
      const e = translateScheduleDbError(
        { code, message: 'violates branch_hours_opens_before_closes' },
        'hours',
      );
      expect(e).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((e as BadRequestException).getResponse())).not.toContain(
        'branch_hours',
      );
    }
  });

  it('otros errores se devuelven tal cual (500 genérico en el filtro)', () => {
    const error = new Error('boom');
    expect(translateScheduleDbError(error, 'hours')).toBe(error);
  });

  it('lock timeout (55P03) y transacción agotada (P2028) => 409 BRANCH_SCHEDULE_BUSY reintentable, sin detalle interno', () => {
    for (const error of [
      {
        code: 'P2010',
        meta: { code: '55P03' },
        message: 'canceling statement due to lock timeout on app.branches',
      },
      { code: '55P03' },
      {
        code: 'P2028',
        message: 'Transaction API error: Unable to start a transaction in the given time.',
      },
    ]) {
      const e = coded(translateScheduleDbError(error, 'closure'));
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ code: 'BRANCH_SCHEDULE_BUSY' });
      expect(JSON.stringify(e.getResponse())).not.toMatch(
        /app\.branches|Transaction API|lock timeout/,
      );
    }
  });

  it('23P01 nunca filtra nombres de restricción, tablas ni valores del error original', () => {
    const raw = {
      code: 'P2010',
      meta: { code: '23P01' },
      message:
        'conflicting key value violates exclusion constraint "branch_closures_no_overlap" DETAIL: Key (branch_id, tstzrange(starts_at, ends_at))=(11111111-1111-4111-8111-111111111111, ["2026-11-20 10:00:00+00","2026-11-20 12:00:00+00")) conflicts',
    };
    for (const context of ['closure', 'hours'] as const) {
      const body = JSON.stringify(coded(translateScheduleDbError(raw, context)).getResponse());
      expect(body).not.toMatch(/branch_closures|branch_hours|11111111|2026-11-20|tstzrange|Key \(/);
    }
  });
});

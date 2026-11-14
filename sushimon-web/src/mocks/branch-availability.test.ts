import { afterEach, describe, expect, it } from 'vitest';
import type { BranchHoursDay } from '@/lib/data-access/models';
import { emptyWeek } from '@/lib/branch-hours';
import { evaluateAvailability, type ClosureInstants } from './branch-availability';

/** Horario de referencia S de la spec 007 (hora local; UTC = local + 6 h). */
const S: BranchHoursDay[] = [
  {
    weekday: 1,
    intervals: [
      { opensAt: '11:00', closesAt: '15:00' },
      { opensAt: '15:00', closesAt: '22:00' },
    ],
  },
  {
    weekday: 2,
    intervals: [
      { opensAt: '11:00', closesAt: '15:00' },
      { opensAt: '15:00', closesAt: '22:00' },
    ],
  },
  {
    weekday: 3,
    intervals: [
      { opensAt: '11:00', closesAt: '15:00' },
      { opensAt: '15:00', closesAt: '22:00' },
    ],
  },
  {
    weekday: 4,
    intervals: [
      { opensAt: '11:00', closesAt: '15:00' },
      { opensAt: '15:00', closesAt: '22:00' },
    ],
  },
  { weekday: 5, intervals: [{ opensAt: '11:00', closesAt: '24:00' }] },
  {
    weekday: 6,
    intervals: [
      { opensAt: '00:00', closesAt: '02:00' },
      { opensAt: '11:00', closesAt: '24:00' },
    ],
  },
  {
    weekday: 7,
    intervals: [
      { opensAt: '00:00', closesAt: '02:00' },
      { opensAt: '12:00', closesAt: '21:00' },
    ],
  },
];

const run = (at: string, closures: ClosureInstants[] = [], days = S, active = true) =>
  evaluateAvailability({ active, days, closures, at: new Date(at) });

describe('motor de disponibilidad (ejemplos numéricos de la spec 007)', () => {
  const rows: [string, string, string, string | null, string | null][] = [
    [
      'lun 10:59:59',
      '2026-11-16T16:59:59.000Z',
      'OUTSIDE_BUSINESS_HOURS',
      '2026-11-16T17:00:00.000Z',
      null,
    ],
    ['lun 11:00:00', '2026-11-16T17:00:00.000Z', 'OPEN', null, '2026-11-17T04:00:00.000Z'],
    [
      'lun 15:00:00 (contiguo fusionado)',
      '2026-11-16T21:00:00.000Z',
      'OPEN',
      null,
      '2026-11-17T04:00:00.000Z',
    ],
    [
      'lun 22:00:00',
      '2026-11-17T04:00:00.000Z',
      'OUTSIDE_BUSINESS_HOURS',
      '2026-11-17T17:00:00.000Z',
      null,
    ],
    ['vie 23:59:59', '2026-11-21T05:59:59.000Z', 'OPEN', null, '2026-11-21T08:00:00.000Z'],
    ['sáb 00:00:00', '2026-11-21T06:00:00.000Z', 'OPEN', null, '2026-11-21T08:00:00.000Z'],
    [
      'sáb 02:00:00',
      '2026-11-21T08:00:00.000Z',
      'OUTSIDE_BUSINESS_HOURS',
      '2026-11-21T17:00:00.000Z',
      null,
    ],
    [
      'dom 21:00:00',
      '2026-11-23T03:00:00.000Z',
      'OUTSIDE_BUSINESS_HOURS',
      '2026-11-23T17:00:00.000Z',
      null,
    ],
  ];
  it.each(rows)('%s', (_n, at, reason, opens, closes) => {
    const r = run(at);
    expect(r.reason).toBe(reason);
    expect(r.isOpenNow).toBe(reason === 'OPEN');
    expect(r.isAcceptingOrders).toBe(reason === 'OPEN');
    expect(r.nextOpensAt).toBe(opens);
    expect(r.nextClosesAt).toBe(closes);
    expect(r.nextTransitionAt).toBe(opens ?? closes);
  });

  it('variante V: domingo → lunes es cíclico', () => {
    const V: BranchHoursDay[] = [
      {
        weekday: 1,
        intervals: [
          { opensAt: '00:00', closesAt: '01:00' },
          { opensAt: '11:00', closesAt: '22:00' },
        ],
      },
      ...emptyWeek().slice(1, 6),
      { weekday: 7, intervals: [{ opensAt: '18:00', closesAt: '24:00' }] },
    ];
    expect(run('2026-11-23T02:00:00.000Z', [], V).nextClosesAt).toBe('2026-11-23T07:00:00.000Z');
  });

  describe('cierre C = [lun 13:00, lun 17:00) local', () => {
    const C: ClosureInstants[] = [
      { startsAt: '2026-11-16T19:00:00.000Z', endsAt: '2026-11-16T23:00:00.000Z' },
    ];
    it('12:59:59 abierta, el cierre empieza a las 13:00', () => {
      const r = run('2026-11-16T18:59:59.000Z', C);
      expect(r).toMatchObject({
        reason: 'OPEN',
        nextOpensAt: null,
        nextClosesAt: '2026-11-16T19:00:00.000Z',
      });
    });
    it('13:00 cerrada por cierre; abre al terminar el cierre', () => {
      const r = run('2026-11-16T19:00:00.000Z', C);
      expect(r).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        nextOpensAt: '2026-11-16T23:00:00.000Z',
        nextClosesAt: null,
      });
    });
    it('16:59:59 sigue cerrada; 17:00 abierta (fin excluido)', () => {
      expect(run('2026-11-16T22:59:59.000Z', C).reason).toBe('EXCEPTIONAL_CLOSURE');
      expect(run('2026-11-16T23:00:00.000Z', C)).toMatchObject({
        reason: 'OPEN',
        nextClosesAt: '2026-11-17T04:00:00.000Z',
      });
    });
    it('cierres contiguos se fusionan: sin falsa apertura a las 15:00', () => {
      const r = run('2026-11-16T21:00:00.000Z', [
        { startsAt: '2026-11-16T19:00:00.000Z', endsAt: '2026-11-16T21:00:00.000Z' },
        { startsAt: '2026-11-16T21:00:00.000Z', endsAt: '2026-11-16T23:00:00.000Z' },
      ]);
      expect(r).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        nextOpensAt: '2026-11-16T23:00:00.000Z',
      });
    });
    it('cierre que termina fuera de horario: la apertura es la semanal siguiente', () => {
      const r = run('2026-11-17T03:30:00.000Z', [
        { startsAt: '2026-11-17T03:00:00.000Z', endsAt: '2026-11-17T06:00:00.000Z' },
      ]);
      expect(r).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        nextOpensAt: '2026-11-17T17:00:00.000Z',
      });
    });
    it('el cierre gana aunque sea fuera de horario', () => {
      const r = run('2026-11-17T05:00:00.000Z', [
        { startsAt: '2026-11-17T03:00:00.000Z', endsAt: '2026-11-17T06:00:00.000Z' },
      ]);
      expect(r.reason).toBe('EXCEPTIONAL_CLOSURE');
    });
  });

  describe('horizonte de 14 días', () => {
    const at = '2026-11-16T18:00:00.000Z'; // lun 12:00 local
    it('límite exacto incluido', () => {
      const r = run(at, [
        { startsAt: '2026-11-16T06:00:00.000Z', endsAt: '2026-11-30T18:00:00.000Z' },
      ]);
      expect(r.nextOpensAt).toBe('2026-11-30T18:00:00.000Z');
    });
    it('un segundo más allá: null', () => {
      const r = run(at, [
        { startsAt: '2026-11-16T06:00:00.000Z', endsAt: '2026-11-30T18:00:01.000Z' },
      ]);
      expect(r).toMatchObject({ nextOpensAt: null, nextTransitionAt: null });
    });
    it('cierre de varias semanas: null', () => {
      const r = run(at, [
        { startsAt: '2026-11-16T06:00:00.000Z', endsAt: '2026-12-10T06:00:00.000Z' },
      ]);
      expect(r.nextOpensAt).toBeNull();
    });
  });

  it('sin intervalos en la semana: SCHEDULE_NOT_CONFIGURED (no se asume abierto)', () => {
    expect(run('2026-11-16T17:00:00.000Z', [], emptyWeek())).toMatchObject({
      reason: 'SCHEDULE_NOT_CONFIGURED',
      isOpenNow: false,
      nextOpensAt: null,
    });
  });
  it('inactiva: INACTIVE antes que cualquier otra regla', () => {
    expect(run('2026-11-16T17:00:00.000Z', [], emptyWeek(), false).reason).toBe('INACTIVE');
    expect(run('2026-11-16T17:00:00.000Z', [], S, false).isAcceptingOrders).toBe(false);
  });
});

describe('independencia de la zona del proceso (TZ)', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  it.each(['UTC', 'Asia/Tokyo', 'America/New_York'])('TZ=%s da el mismo resultado', (tz) => {
    process.env.TZ = tz;
    const r = run('2026-11-21T05:59:59.000Z');
    expect(r).toMatchObject({ reason: 'OPEN', nextClosesAt: '2026-11-21T08:00:00.000Z' });
  });
});

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES, runCase, type CaseOutcome } from '../../test/support/availability-cases.js';
import { evaluateAvailability, HORIZON_MS } from './availability.js';

describe('evaluateAvailability (dominio puro)', () => {
  describe.each(CASES)('$name', (c) => {
    it('coincide con la spec', () => {
      const out = runCase(c);
      expect(out.reason).toBe(c.reason);
      expect(out.nextOpensAt).toBe(c.nextOpensAt);
      expect(out.nextClosesAt).toBe(c.nextClosesAt);
      expect(out.isOpenNow).toBe(c.reason === 'OPEN');
      expect(out.isAcceptingOrders).toBe(c.isAcceptingOrders ?? c.reason === 'OPEN');
      const candidates = [out.nextOpensAt, out.nextClosesAt].filter((v) => v !== null).sort();
      expect(out.nextTransitionAt).toBe(candidates[0] ?? null);
    });
  });

  it('isAcceptingOrders implica isOpenNow en todos los casos', () => {
    for (const c of CASES) {
      const out = runCase(c);
      if (out.isAcceptingOrders) expect(out.isOpenNow).toBe(true);
    }
  });

  it('es determinista y no lee el reloj: misma entrada, misma salida', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const first = CASES.map((c) => runCase(c));
      vi.setSystemTime(new Date('1999-06-01T00:00:00Z'));
      expect(CASES.map((c) => runCase(c))).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('horizonte: HORIZON_MS son 14 × 24 h de reloj', () => {
    expect(HORIZON_MS).toBe(14 * 24 * 3_600_000);
  });

  it('sin apertura en el horizonte: transiciones nulas (iteración acotada, sin bucle)', () => {
    const r = evaluateAvailability({
      active: true,
      intervals: [{ weekday: 1, opensMin: 0, closesMin: 60 }],
      closures: [
        {
          startsAt: Date.parse('2026-11-01T00:00:00Z'),
          endsAt: Date.parse('2027-12-01T00:00:00Z'),
        },
      ],
      at: Date.parse('2026-11-16T18:00:00Z'),
      timeZone: 'America/Guatemala',
    });
    expect(r).toMatchObject({
      reason: 'EXCEPTIONAL_CLOSURE',
      nextOpensAt: null,
      nextClosesAt: null,
      nextTransitionAt: null,
    });
  });

  it('abierto 24/7: no hay cierre dentro del horizonte (nextClosesAt null)', () => {
    const intervals = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      opensMin: 0,
      closesMin: 1440,
    }));
    const r = evaluateAvailability({
      active: true,
      intervals,
      closures: [],
      at: Date.parse('2026-11-16T18:00:00Z'),
      timeZone: 'America/Guatemala',
    });
    expect(r).toMatchObject({ reason: 'OPEN', nextClosesAt: null, nextTransitionAt: null });
  });

  it('el orden de evaluación pone INACTIVE antes que SCHEDULE_NOT_CONFIGURED y el cierre antes que fuera de horario', () => {
    const base = { at: Date.parse('2026-11-16T18:00:00Z'), timeZone: 'America/Guatemala' };
    expect(
      evaluateAvailability({ active: false, intervals: [], closures: [], ...base }).reason,
    ).toBe('INACTIVE');
    // Domingo 3:00 local (fuera de horario) dentro de un cierre => EXCEPTIONAL_CLOSURE.
    expect(
      evaluateAvailability({
        active: true,
        intervals: [{ weekday: 1, opensMin: 660, closesMin: 1320 }],
        closures: [{ startsAt: base.at - 1000, endsAt: base.at + 1000 }],
        at: Date.parse('2026-11-22T09:00:00Z'),
        timeZone: base.timeZone,
      }).reason,
    ).toBe('OUTSIDE_BUSINESS_HOURS');
    expect(
      evaluateAvailability({
        active: true,
        intervals: [{ weekday: 1, opensMin: 660, closesMin: 1320 }],
        closures: [{ startsAt: base.at - 1000, endsAt: base.at + 1000 }],
        ...base,
      }).reason,
    ).toBe('EXCEPTIONAL_CLOSURE');
  });
});

describe('rendimiento del motor (M5)', () => {
  const week = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) =>
    Array.from({ length: 6 }, (_, i) => ({ weekday, opensMin: i * 240, closesMin: i * 240 + 180 })),
  );
  const closuresOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      startsAt: Date.parse('2026-11-17T10:00:00Z') + i * 3 * 3_600_000,
      endsAt: Date.parse('2026-11-17T12:00:00Z') + i * 3 * 3_600_000,
    }));
  const run = (closures: ReturnType<typeof closuresOf>) =>
    evaluateAvailability({
      active: true,
      intervals: week,
      closures,
      at: Date.parse('2026-11-16T18:00:00Z'),
      timeZone: 'America/Guatemala',
    });

  it('7 × 6 intervalos y 14 cierres: <= 60 llamadas a formatToParts por evaluación (antes: 409)', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      run(closuresOf(14));
      expect(spy.mock.calls.length).toBeLessThanOrEqual(60);
    } finally {
      spy.mockRestore();
    }
  });

  it('42 intervalos + 100 cierres: resultado correcto y tiempo acotado (holgado, sin flakiness)', () => {
    const t0 = performance.now();
    const r = run(closuresOf(100));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(r.reason).toBe('OPEN');
    expect(r.nextClosesAt).not.toBeNull();
  });
});

describe('independencia de la zona del proceso (TZ)', () => {
  const probe = fileURLToPath(new URL('../../test/support/tz-probe.ts', import.meta.url));
  const cwd = fileURLToPath(new URL('../../', import.meta.url));

  interface Probe {
    processZone: string;
    januaryOffsetMinutes: number;
    naiveLocalHour: number;
    naiveDay: number;
    results: CaseOutcome[];
    local: unknown[];
    instants: number[];
    weekday: number;
  }

  const run = (tz: string): Probe =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', probe], {
        cwd,
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
        timeout: 60_000,
      }),
    ) as Probe;

  it('UTC, Asia/Tokyo y America/New_York dan la MISMA salida (y la TZ del proceso sí cambió)', () => {
    const runs = { UTC: run('UTC'), Tokyo: run('Asia/Tokyo'), NewYork: run('America/New_York') };

    // Control: la TZ del proceso hijo realmente fue distinta (si no, la prueba pasaría por casualidad).
    expect(runs.UTC.processZone).toBe('UTC');
    expect(runs.Tokyo.processZone).toBe('Asia/Tokyo');
    expect(runs.NewYork.processZone).toBe('America/New_York');
    expect([
      runs.UTC.januaryOffsetMinutes,
      runs.Tokyo.januaryOffsetMinutes,
      runs.NewYork.januaryOffsetMinutes,
    ]).toEqual([0, -540, 300]);
    // Control negativo: un cálculo ingenuo (getHours/getDay) SÍ varía con la TZ.
    expect(new Set([runs.UTC, runs.Tokyo, runs.NewYork].map((r) => r.naiveLocalHour)).size).toBe(3);
    expect(runs.UTC.naiveDay).not.toBe(runs.Tokyo.naiveDay);

    // El dominio no varía: idéntico entre TZ y igual a la salida del proceso actual.
    expect(runs.Tokyo.results).toEqual(runs.UTC.results);
    expect(runs.NewYork.results).toEqual(runs.UTC.results);
    expect(runs.Tokyo.local).toEqual(runs.UTC.local);
    expect(runs.NewYork.instants).toEqual(runs.UTC.instants);
    expect(runs.UTC.results).toEqual(CASES.map((c) => runCase(c)));
    expect(runs.UTC.instants).toEqual([
      Date.parse('2026-11-16T17:00:00Z'),
      Date.parse('2026-11-21T06:00:00Z'),
    ]);
    expect(runs.NewYork.weekday).toBe(7);
  }, 120_000);
});

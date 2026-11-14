import {
  evaluateAvailability,
  type ClosureWindow,
  type WeeklyInterval,
} from '../../src/branch-schedule/availability.js';

/**
 * Casos de la spec F08 (tablas «Ejemplos numéricos»), compartidos por la prueba unitaria del dominio y por la
 * sonda que se ejecuta en procesos hijos con distinta `TZ`. Todos los instantes son UTC (America/Guatemala = UTC-6).
 */
export const TZ_GT = 'America/Guatemala';

const iv = (weekday: number, from: string, to: string): WeeklyInterval => {
  const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return { weekday, opensMin: min(from), closesMin: min(to) };
};

/** Horario de referencia S de la spec. */
export const SCHEDULE_S: WeeklyInterval[] = [
  ...[1, 2, 3, 4].flatMap((d) => [iv(d, '11:00', '15:00'), iv(d, '15:00', '22:00')]),
  iv(5, '11:00', '24:00'),
  iv(6, '00:00', '02:00'),
  iv(6, '11:00', '24:00'),
  iv(7, '00:00', '02:00'),
  iv(7, '12:00', '21:00'),
];

/** Variante V (domingo → lunes). */
export const SCHEDULE_V: WeeklyInterval[] = [
  iv(7, '18:00', '24:00'),
  iv(1, '00:00', '01:00'),
  iv(1, '11:00', '22:00'),
];

export const closure = (startsAt: string, endsAt: string): ClosureWindow => ({
  startsAt: Date.parse(startsAt),
  endsAt: Date.parse(endsAt),
});

export interface Case {
  name: string;
  intervals: WeeklyInterval[];
  closures?: ClosureWindow[];
  active?: boolean;
  at: string;
  reason: string;
  nextOpensAt: string | null;
  nextClosesAt: string | null;
  orderCutoffMinutes?: number;
  isAcceptingOrders?: boolean;
}

const C_LUN = [closure('2026-11-16T19:00:00.000Z', '2026-11-16T23:00:00.000Z')];

export const CASES: Case[] = [
  // Horario S, sin cierres.
  {
    name: 'S lun 10:59:59',
    intervals: SCHEDULE_S,
    at: '2026-11-16T16:59:59.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-16T17:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'S lun 11:00:00 (inicio incluido)',
    intervals: SCHEDULE_S,
    at: '2026-11-16T17:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
  },
  {
    name: 'S lun 15:00:00 (2.º intervalo contiguo, sin falsa transición)',
    intervals: SCHEDULE_S,
    at: '2026-11-16T21:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
  },
  {
    name: 'S lun 21:59:59.999 (cierre - 1 ms)',
    intervals: SCHEDULE_S,
    at: '2026-11-17T03:59:59.999Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
  },
  {
    name: 'S lun 22:00:00 (fin excluido)',
    intervals: SCHEDULE_S,
    at: '2026-11-17T04:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-17T17:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'S vie 23:59:59 (medianoche fusionada)',
    intervals: SCHEDULE_S,
    at: '2026-11-21T05:59:59.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-21T08:00:00.000Z',
  },
  {
    name: 'S sáb 00:00:00',
    intervals: SCHEDULE_S,
    at: '2026-11-21T06:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-21T08:00:00.000Z',
  },
  {
    name: 'S sáb 02:00:00',
    intervals: SCHEDULE_S,
    at: '2026-11-21T08:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-21T17:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'S dom 21:00:00 (próxima apertura el lunes)',
    intervals: SCHEDULE_S,
    at: '2026-11-23T03:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-23T17:00:00.000Z',
    nextClosesAt: null,
  },
  // Variante V: semana cíclica domingo → lunes.
  {
    name: 'V dom 20:00 (cierra lun 01:00, no dom 24:00)',
    intervals: SCHEDULE_V,
    at: '2026-11-23T02:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-23T07:00:00.000Z',
  },
  // Cierre C = lun 13:00-17:00 local.
  {
    name: 'C lun 12:59:59',
    intervals: SCHEDULE_S,
    closures: C_LUN,
    at: '2026-11-16T18:59:59.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-16T19:00:00.000Z',
  },
  {
    name: 'C lun 13:00:00 (inicio del cierre incluido)',
    intervals: SCHEDULE_S,
    closures: C_LUN,
    at: '2026-11-16T19:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-16T23:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'C lun 16:59:59',
    intervals: SCHEDULE_S,
    closures: C_LUN,
    at: '2026-11-16T22:59:59.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-16T23:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'C lun 17:00:00 (fin del cierre excluido)',
    intervals: SCHEDULE_S,
    closures: C_LUN,
    at: '2026-11-16T23:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
  },
  {
    name: 'cierres contiguos 13-15 + 15-17: a las 15:00 sigue cerrada, abre a las 17:00',
    intervals: SCHEDULE_S,
    closures: [
      closure('2026-11-16T19:00:00.000Z', '2026-11-16T21:00:00.000Z'),
      closure('2026-11-16T21:00:00.000Z', '2026-11-16T23:00:00.000Z'),
    ],
    at: '2026-11-16T21:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-16T23:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'cierre que termina fuera de horario [lun 21:00, mar 00:00): abre mar 11:00',
    intervals: SCHEDULE_S,
    closures: [closure('2026-11-17T03:00:00.000Z', '2026-11-17T06:00:00.000Z')],
    at: '2026-11-17T03:30:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-17T17:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'cierre multi-día [lun 16 00:00, mié 18 00:00): abre mié 11:00',
    intervals: SCHEDULE_S,
    closures: [closure('2026-11-16T06:00:00.000Z', '2026-11-18T06:00:00.000Z')],
    at: '2026-11-16T18:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-18T17:00:00.000Z',
    nextClosesAt: null,
  },
  // Horizonte de 14 días.
  {
    name: 'horizonte: la apertura exacta a las 14 × 24 h se incluye',
    intervals: SCHEDULE_S,
    closures: [closure('2026-11-16T06:00:00.000Z', '2026-11-30T18:00:00.000Z')],
    at: '2026-11-16T18:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: '2026-11-30T18:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'horizonte: 1 s más allá => null',
    intervals: SCHEDULE_S,
    closures: [closure('2026-11-16T06:00:00.000Z', '2026-11-30T18:00:01.000Z')],
    at: '2026-11-16T18:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: null,
    nextClosesAt: null,
  },
  {
    name: 'horizonte: cierre hasta el 10 de diciembre => null',
    intervals: SCHEDULE_S,
    closures: [closure('2026-11-16T06:00:00.000Z', '2026-12-10T06:00:00.000Z')],
    at: '2026-11-16T18:00:00.000Z',
    reason: 'EXCEPTIONAL_CLOSURE',
    nextOpensAt: null,
    nextClosesAt: null,
  },
  // Otras formas de horario.
  {
    name: 'día sin horario (martes) -> próximo lunes tras el fin de semana',
    intervals: [iv(1, '11:00', '22:00')],
    at: '2026-11-17T17:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-23T17:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'dos intervalos con hueco: dentro del hueco',
    intervals: [iv(1, '11:00', '14:00'), iv(1, '18:00', '22:00')],
    at: '2026-11-16T21:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-17T00:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'dos intervalos con hueco: fin exacto del primero',
    intervals: [iv(1, '11:00', '14:00'), iv(1, '18:00', '22:00')],
    at: '2026-11-16T20:00:00.000Z',
    reason: 'OUTSIDE_BUSINESS_HOURS',
    nextOpensAt: '2026-11-17T00:00:00.000Z',
    nextClosesAt: null,
  },
  {
    name: 'dos intervalos con hueco: dentro del segundo',
    intervals: [iv(1, '11:00', '14:00'), iv(1, '18:00', '22:00')],
    at: '2026-11-17T00:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
  },
  {
    name: 'intervalos solapados en el dominio se fusionan',
    intervals: [iv(1, '11:00', '16:00'), iv(1, '14:00', '20:00')],
    at: '2026-11-16T21:00:00.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T02:00:00.000Z',
  },
  {
    name: 'día local, no día UTC: lun 23:59:59 local con horario 23:00-24:00',
    intervals: [iv(1, '23:00', '24:00')],
    at: '2026-11-17T05:59:59.000Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T06:00:00.000Z',
  },
  {
    name: 'sin intervalos => SCHEDULE_NOT_CONFIGURED',
    intervals: [],
    at: '2026-11-16T17:00:00.000Z',
    reason: 'SCHEDULE_NOT_CONFIGURED',
    nextOpensAt: null,
    nextClosesAt: null,
  },
  {
    name: 'sucursal inactiva => INACTIVE (aunque el horario diga abierto)',
    intervals: SCHEDULE_S,
    active: false,
    at: '2026-11-16T17:00:00.000Z',
    reason: 'INACTIVE',
    nextOpensAt: null,
    nextClosesAt: null,
  },
  // Punto de extensión orderCutoffMinutes (sin valor por defecto).
  {
    name: 'cutoff: 30 min antes del cierre deja de aceptar',
    intervals: SCHEDULE_S,
    at: '2026-11-17T03:30:00.000Z',
    orderCutoffMinutes: 30,
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
    isAcceptingOrders: false,
  },
  {
    name: 'cutoff: 1 ms antes del umbral aún acepta',
    intervals: SCHEDULE_S,
    at: '2026-11-17T03:29:59.999Z',
    orderCutoffMinutes: 30,
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
    isAcceptingOrders: true,
  },
  {
    name: 'sin cutoff: acepta hasta el último instante',
    intervals: SCHEDULE_S,
    at: '2026-11-17T03:59:59.999Z',
    reason: 'OPEN',
    nextOpensAt: null,
    nextClosesAt: '2026-11-17T04:00:00.000Z',
    isAcceptingOrders: true,
  },
];

export interface CaseOutcome {
  name: string;
  reason: string;
  isOpenNow: boolean;
  isAcceptingOrders: boolean;
  nextOpensAt: string | null;
  nextClosesAt: string | null;
  nextTransitionAt: string | null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function runCase(c: Case, timeZone: string = TZ_GT): CaseOutcome {
  const r = evaluateAvailability({
    active: c.active ?? true,
    intervals: c.intervals,
    closures: c.closures ?? [],
    at: Date.parse(c.at),
    timeZone,
    ...(c.orderCutoffMinutes !== undefined ? { orderCutoffMinutes: c.orderCutoffMinutes } : {}),
  });
  return {
    name: c.name,
    reason: r.reason,
    isOpenNow: r.isOpenNow,
    isAcceptingOrders: r.isAcceptingOrders,
    nextOpensAt: iso(r.nextOpensAt),
    nextClosesAt: iso(r.nextClosesAt),
    nextTransitionAt: iso(r.nextTransitionAt),
  };
}

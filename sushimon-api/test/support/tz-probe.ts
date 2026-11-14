/**
 * Sonda para la prueba de independencia de la zona del proceso: se ejecuta en un proceso hijo con `TZ` distinta y
 * escribe en stdout un JSON con (a) lo que ve el proceso de su propia zona, (b) un cálculo INGENUO que sí
 * depende de ella (control: debe variar) y (c) los resultados del dominio (deben ser idénticos en todas).
 */
import { instantOf, isoWeekdayOf, toLocal } from '../../src/branch-schedule/business-time.js';
import { CASES, runCase, TZ_GT } from './availability-cases.js';

const probes = ['2026-11-16T17:00:00.000Z', '2026-11-21T05:59:59.000Z', '2026-11-23T03:00:00.000Z'];

process.stdout.write(
  JSON.stringify({
    processZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    januaryOffsetMinutes: new Date(2026, 0, 1).getTimezoneOffset(),
    naiveLocalHour: new Date(Date.parse('2026-11-16T17:00:00.000Z')).getHours(),
    naiveDay: new Date(Date.parse('2026-11-16T17:00:00.000Z')).getDay(),
    results: CASES.map((c) => runCase(c)),
    local: probes.map((p) => toLocal(Date.parse(p), TZ_GT)),
    instants: [
      instantOf({ year: 2026, month: 11, day: 16 }, 11 * 60, TZ_GT),
      instantOf({ year: 2026, month: 11, day: 20 }, 1440, TZ_GT),
    ],
    weekday: isoWeekdayOf({ year: 2026, month: 11, day: 22 }),
  }),
);

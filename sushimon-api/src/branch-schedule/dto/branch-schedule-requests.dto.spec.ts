import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { normalizeHours } from '../schedule-policy.js';
import { ReplaceBranchHoursRequest } from './branch-schedule-requests.dto.js';

const VERSION = 'a'.repeat(64);
const days = (first: unknown) => [
  first,
  ...[2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, intervals: [] })),
];
const body = (opensAt: string, closesAt: string) => ({
  expectedVersion: VERSION,
  days: days({ weekday: 1, intervals: [{ opensAt, closesAt }] }),
});
const errors = async (plain: unknown) =>
  validate(plainToInstance(ReplaceBranchHoursRequest, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('ReplaceBranchHoursRequest (fuzz de HH:mm y forma)', () => {
  it('acepta HH:mm válidos y 24:00 solo como cierre', async () => {
    expect(await errors(body('00:00', '24:00'))).toHaveLength(0);
    expect(await errors(body('23:59', '24:00'))).toHaveLength(0);
  });

  it.each([
    ['24:00 en opensAt', '24:00', '24:00'],
    ['24:30 en closesAt', '10:00', '24:30'],
    ['25:00', '10:00', '25:00'],
    ['salto de línea final en opensAt', '11:00\n', '12:00'],
    ['salto de línea final en closesAt', '11:00', '12:00\n'],
    ['espacio final', '11:00 ', '12:00'],
    ['sin cero inicial', '9:00', '10:00'],
    ['con segundos', '11:00:00', '12:00'],
    ['minutos 60', '11:60', '12:00'],
    ['vacío', '', '12:00'],
    ['dígitos unicode', '１１:00', '12:00'],
  ])('rechaza %s', async (_name, opensAt, closesAt) => {
    expect((await errors(body(opensAt, closesAt))).length).toBeGreaterThan(0);
  });

  it('rechaza más de 7 días, menos de 7 y más de 6 intervalos por día', async () => {
    const ok = body('10:00', '11:00');
    expect(
      (await errors({ ...ok, days: [...ok.days, { weekday: 1, intervals: [] }] })).length,
    ).toBeGreaterThan(0);
    expect((await errors({ ...ok, days: ok.days.slice(0, 6) })).length).toBeGreaterThan(0);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      opensAt: `0${i}:00`,
      closesAt: `0${i}:30`,
    }));
    expect(
      (await errors({ ...ok, days: days({ weekday: 1, intervals: seven }) })).length,
    ).toBeGreaterThan(0);
  });

  it('no se contamina con __proto__ y rechaza propiedades extra (forbidNonWhitelisted)', async () => {
    const withProto = JSON.parse(
      `{"expectedVersion":"${VERSION}","days":${JSON.stringify(body('10:00', '11:00').days)},"__proto__":{"admin":true}}`,
    ) as object;
    // class-transformer ignora `__proto__`: no contamina nada (el rechazo explícito 400 lo hace el middleware global, ver e2e).
    const instance = plainToInstance(ReplaceBranchHoursRequest, withProto);
    expect(Object.keys(instance)).not.toContain('admin');
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
    const nested = body('10:00', '11:00');
    (nested.days[0] as { intervals: object[] }).intervals = [
      { opensAt: '10:00', closesAt: '11:00', extra: 1 },
    ];
    expect((await errors(nested)).length).toBeGreaterThan(0);
  });
});

describe('normalizeHours (defensa en profundidad, sin DTO)', () => {
  const week = (iv: { opensAt: string; closesAt: string }) =>
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, intervals: weekday === 1 ? [iv] : [] }));

  it.each([
    ['24:00', '24:00'],
    ['24:30', '25:00'],
    ['11:00\n', '12:00'],
    ['11:00', '12:00\n'],
    ['25:00', '26:00'],
    ['', ''],
  ])('rechaza %j - %j (400 o 422, nunca guarda)', (opensAt, closesAt) => {
    expect(() => normalizeHours(week({ opensAt, closesAt }))).toThrow();
  });
});

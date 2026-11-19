import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CASH_TENDERED_MAX_CENTS,
  centsToMoney,
  dbMoneyToCents,
  parseTenderedCents,
  requestHashOf,
  settleCash,
} from './cash-amount.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse: () => { code?: string } }).getResponse().code;
  }
  return undefined;
};

describe('parseTenderedCents (F24 #12, #13)', () => {
  it.each([
    ['200.00', 20000],
    ['200', 20000], // `200` y `200.00` son el mismo valor
    ['200.5', 20050],
    ['0.01', 1],
    ['0.1', 10],
    ['185.00', 18500],
    ['5000.00', CASH_TENDERED_MAX_CENTS],
    ['999999999.99', 99_999_999_999],
  ])('%s => %i centavos', (raw, cents) => {
    expect(parseTenderedCents(raw)).toBe(cents);
  });

  it('0.1 + 0.2 no produce errores de coma flotante (centavos enteros)', () => {
    expect(parseTenderedCents('0.1') + parseTenderedCents('0.2')).toBe(parseTenderedCents('0.3'));
    expect(centsToMoney(parseTenderedCents('0.1') + parseTenderedCents('0.2'))).toBe('0.30');
  });

  it.each([
    ['negativo', '-5'],
    ['cero', '0'],
    ['cero con decimales', '0.00'],
    ['vacío', ''],
    ['texto', 'abc'],
    ['notación científica', '1e2'],
    ['separador de miles', '1,000.00'],
    ['coma decimal', '200,00'],
    ['NaN', 'NaN'],
    ['más de 2 decimales (sin redondeo)', '200.001'],
    ['3 decimales aunque terminen en cero', '200.000'],
    ['espacios', ' 200.00'],
    ['signo +', '+200'],
    ['punto final', '200.'],
    ['sin enteros', '.5'],
    ['10 enteros', '1000000000'],
    ['hexadecimal', '0x10'],
    ['Infinity', 'Infinity'],
  ])('%s (%s) => 400 PAYMENT_AMOUNT_INVALID', (_n, raw) => {
    expect(codeOf(() => parseTenderedCents(raw))).toBe('PAYMENT_AMOUNT_INVALID');
  });

  it.each([[200], [200.0], [null], [undefined], [true], [{}], [['200.00']]])(
    'un valor que no es cadena (%j) => 400 (el contrato exige cadena decimal, nunca number)',
    (raw) => {
      expect(codeOf(() => parseTenderedCents(raw))).toBe('PAYMENT_AMOUNT_INVALID');
    },
  );
});

describe('settleCash: ingreso = deuda, cambio solo del servidor (F24 #9, #10, #11, #14)', () => {
  it('pago exacto: total 185.00 con 185.00 => cambio 0.00', () => {
    expect(settleCash(18500, 18500)).toEqual({ ok: true, changeCents: 0 });
  });

  it('pago con cambio: total 185.00 con 200.00 => cambio 15.00', () => {
    const r = settleCash(18500, 20000);
    expect(r).toEqual({ ok: true, changeCents: 1500 });
    expect(centsToMoney(r.ok ? r.changeCents : -1)).toBe('15.00');
  });

  it('insuficiente: 184.99 con total 185.00', () => {
    expect(settleCash(18500, 18499)).toEqual({ ok: false, reason: 'INSUFFICIENT' });
  });

  it('tope: 5000.00 pasa y 5000.01 es demasiado', () => {
    expect(settleCash(18500, 500_000)).toMatchObject({ ok: true });
    expect(settleCash(18500, 500_001)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('el cambio nunca es negativo ni se suma como ingreso: tendered - amount', () => {
    for (const [amount, tendered] of [
      [1, 1],
      [18500, 25000],
      [99999, 500000],
    ] as const) {
      const r = settleCash(amount, tendered);
      expect(r.ok && r.changeCents).toBe(tendered - amount);
    }
  });
});

describe('dinero de la BD y huella del cuerpo', () => {
  it('dbMoneyToCents / centsToMoney son inversas y rechazan formas ajenas', () => {
    expect(dbMoneyToCents('185.00')).toBe(18500);
    expect(dbMoneyToCents('0.00')).toBe(0);
    expect(dbMoneyToCents('185')).toBeNull();
    expect(dbMoneyToCents('-1.00')).toBeNull();
    expect(centsToMoney(18500)).toBe('185.00');
    expect(centsToMoney(5)).toBe('0.05');
    expect(() => centsToMoney(-1)).toThrow(RangeError);
    expect(() => centsToMoney(1.5)).toThrow(RangeError);
  });

  it('requestHash: 32 bytes, estable, depende del pedido y del importe normalizado (100 == 100.00)', () => {
    const a = requestHashOf('o1', parseTenderedCents('100'));
    expect(a).toHaveLength(32);
    expect(a.equals(requestHashOf('o1', parseTenderedCents('100.00')))).toBe(true);
    expect(a.equals(requestHashOf('o1', 10001))).toBe(false);
    expect(a.equals(requestHashOf('o2', 10000))).toBe(false);
  });
});

describe('barrido: sin transferencia ni tarjeta en el código de pedidos/pagos (F24 #6)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const root = join(__dirname, '..');

  it("ningún literal 'bank_transfer' / 'card' en código de producción de src/orders (comentarios aparte)", () => {
    const offenders = walk(root)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ file, n: i + 1, line }))
          .filter(
            ({ line }) =>
              !/^\s*(\/\/|\*|\/\*)/.test(line) &&
              /['"`](bank_transfer|card|transfer)['"`]/.test(line),
          ),
      );
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEMO_CARD,
  TEST_CARDS,
  findTestCard,
  formatCardNumber,
  formatExpiry,
  isExpiryValid,
  lastFour,
  maskCardNumber,
  validateCard,
} from './neonet';

const NOW = new Date('2026-11-11T20:25:00.000Z');

describe('formato de tarjeta', () => {
  it('agrupa de 4 en 4 y limita a 16 dígitos', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-4242 4242 4242 99')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('42')).toBe('42');
  });

  it('formatea el vencimiento como MM/AA', () => {
    expect(formatExpiry('1228')).toBe('12/28');
    expect(formatExpiry('12')).toBe('12');
    expect(formatExpiry('12/2')).toBe('12/2');
  });

  it('enmascara el número: nunca se muestra completo', () => {
    expect(maskCardNumber('4242 4242 4242 4242')).toBe('•••• •••• •••• 4242');
    expect(maskCardNumber('42')).toBe('•••• •••• •••• ••42');
    expect(maskCardNumber('4242 4242 4242 4242')).not.toContain('4242 4242');
    expect(lastFour('5555 5555 5555 4444')).toBe('4444');
  });
});

describe('tarjetas de prueba (simulación)', () => {
  it('son las cuatro del prototipo', () => {
    expect(TEST_CARDS.map((c) => [c.number, c.scenario])).toEqual([
      ['4242424242424242', 'approved'],
      ['5555555555554444', 'approved'],
      ['4000000000000002', 'declined'],
      ['4000000000000077', 'pending'],
    ]);
  });

  it('reconoce la tarjeta con o sin espacios y rechaza el resto', () => {
    expect(findTestCard('4000 0000 0000 0002')?.scenario).toBe('declined');
    expect(findTestCard('4111 1111 1111 1111')).toBeNull();
  });
});

describe('validación de la tarjeta', () => {
  it('acepta la tarjeta de demostración', () => {
    expect(validateCard(DEMO_CARD, NOW)).toEqual({});
  });

  it('solo acepta tarjetas de prueba', () => {
    expect(validateCard({ ...DEMO_CARD, number: '4111 1111 1111 1111' }, NOW).number).toBe(
      'neonet.errTestOnly',
    );
    expect(validateCard({ ...DEMO_CARD, number: '4242' }, NOW).number).toBe('neonet.errNumber');
  });

  it('valida titular, vencimiento y CVV', () => {
    const errors = validateCard(
      { number: DEMO_CARD.number, name: 'A', expiry: '01/20', cvv: '1' },
      NOW,
    );
    expect(errors).toEqual({
      name: 'neonet.errName',
      expiry: 'neonet.errExpiry',
      cvv: 'neonet.errCvv',
    });
  });

  it('el vencimiento del mes actual aún es válido; el mes anterior no', () => {
    expect(isExpiryValid('11/26', NOW)).toBe(true);
    expect(isExpiryValid('10/26', NOW)).toBe(false);
    expect(isExpiryValid('13/30', NOW)).toBe(false);
  });
});

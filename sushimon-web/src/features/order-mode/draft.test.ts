import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_DRAFT,
  checkZone,
  hasErrors,
  requiresZone,
  validateDraft,
  zoneChoices,
} from './draft';

const NONEXISTENT = [20, 22, 23];
const delivery = (patch = {}) => ({
  ...DEFAULT_DELIVERY_DRAFT,
  line: '6a avenida 10-50',
  ...patch,
});

describe('borrador del modo de pedido', () => {
  it('solo la Ciudad de Guatemala usa zonas', () => {
    expect(requiresZone('Guatemala', 'Guatemala')).toBe(true);
    expect(requiresZone('Guatemala', 'Mixco')).toBe(false);
    expect(requiresZone('Escuintla', 'Escuintla')).toBe(false);
  });

  it('valida la zona (1–25, sin 20/22/23)', () => {
    expect(checkZone('', NONEXISTENT)).toBe('required');
    expect(checkZone('  ', NONEXISTENT)).toBe('required');
    expect(checkZone('abc', NONEXISTENT)).toBe('invalid');
    expect(checkZone('0', NONEXISTENT)).toBe('invalid');
    expect(checkZone('26', NONEXISTENT)).toBe('invalid');
    expect(checkZone('22', NONEXISTENT)).toBe('invalid');
    expect(checkZone('10', NONEXISTENT)).toBe('ok');
  });

  it('exige dirección y zona (solo a domicilio, ADR-0036)', () => {
    expect(validateDraft({ delivery: delivery() }, NONEXISTENT)).toEqual({
      zone: 'mode.errZone',
    });
    expect(validateDraft({ delivery: delivery({ zone: '23' }) }, NONEXISTENT)).toEqual({
      zone: 'mode.errZoneInvalid',
    });
    expect(
      validateDraft({ delivery: delivery({ zone: '10', line: 'abc' }) }, NONEXISTENT).line,
    ).toBe('mode.errAddress');
    expect(
      hasErrors(validateDraft({ delivery: delivery({ municipality: 'Mixco' }) }, NONEXISTENT)),
    ).toBe(false);
  });

  it('las zonas elegibles son 1–25 sin las inexistentes (la tienda envía «Zona N», igual que el backoffice)', () => {
    const zones = zoneChoices(NONEXISTENT);
    expect(zones).toHaveLength(25 - NONEXISTENT.length);
    expect(zones).not.toContain(22);
    expect(zones[0]).toBe(1);
  });
});

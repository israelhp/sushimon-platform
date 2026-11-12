import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_DRAFT,
  checkZone,
  hasErrors,
  municipalitiesOf,
  requiresZone,
  validateDraft,
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

  it('exige el tipo, la sucursal al recoger y dirección + zona a domicilio', () => {
    const base = { branchId: null, delivery: delivery() };
    expect(validateDraft({ ...base, type: null }, NONEXISTENT).type).toBe('mode.errType');
    expect(validateDraft({ ...base, type: 'pickup' }, NONEXISTENT).branch).toBe(
      'validation.branch',
    );
    expect(hasErrors(validateDraft({ ...base, type: 'pickup', branchId: 's' }, NONEXISTENT))).toBe(
      false,
    );

    expect(validateDraft({ ...base, type: 'delivery' }, NONEXISTENT)).toEqual({
      zone: 'mode.errZone',
    });
    expect(
      validateDraft({ ...base, type: 'delivery', delivery: delivery({ zone: '23' }) }, NONEXISTENT),
    ).toEqual({ zone: 'mode.errZoneInvalid' });
    expect(
      validateDraft(
        { ...base, type: 'delivery', delivery: delivery({ zone: '10', line: 'abc' }) },
        NONEXISTENT,
      ).line,
    ).toBe('mode.errAddress');
    expect(
      hasErrors(
        validateDraft(
          { ...base, type: 'delivery', delivery: delivery({ municipality: 'Mixco' }) },
          NONEXISTENT,
        ),
      ),
    ).toBe(false);
  });

  it('lista los municipios de un departamento', () => {
    const departments = [{ department: 'A', municipalities: [{ name: 'x', zones: 0 }] }];
    expect(municipalitiesOf(departments, 'A')).toEqual([{ name: 'x', zones: 0 }]);
    expect(municipalitiesOf(departments, 'B')).toEqual([]);
  });
});

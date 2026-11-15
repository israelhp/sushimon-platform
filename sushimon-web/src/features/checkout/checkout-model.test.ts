import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_STORAGE_KEY,
  DEMO_ADDRESS,
  DEMO_CONTACT,
  EMPTY_ADDRESS,
  checkoutReducer,
  formatAddress,
  hasAnyError,
  initialDraft,
  isValidEmail,
  isValidPhone,
  parseDraft,
  serializeDraft,
  validateAddress,
  validateContact,
  zoneForOrder,
} from './checkout-model';

describe('validación de contacto', () => {
  it('acepta teléfonos de 8 dígitos con o sin +502', () => {
    expect(isValidPhone('5555-1234')).toBe(true);
    expect(isValidPhone('+502 5555 1234')).toBe(true);
    expect(isValidPhone('5555123')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
  });

  it('valida el correo', () => {
    expect(isValidEmail('cliente@ejemplo.com')).toBe(true);
    expect(isValidEmail('cliente@ejemplo')).toBe(false);
    expect(isValidEmail('sin arroba.com')).toBe(false);
  });

  it('devuelve claves de mensaje por campo', () => {
    expect(validateContact({ name: 'Al', phone: '12', email: 'x' })).toEqual({
      name: 'validation.name',
      phone: 'validation.phone',
      email: 'validation.email',
    });
    expect(hasAnyError(validateContact(DEMO_CONTACT))).toBe(false);
  });
});

describe('validación de dirección', () => {
  it('exige zona solo en la Ciudad de Guatemala y descarta zonas inexistentes', () => {
    const base = { ...EMPTY_ADDRESS, line: '6a avenida 10-50' };
    expect(validateAddress(base, [20, 22, 23]).zone).toBe('validation.zone');
    expect(validateAddress({ ...base, zone: '22' }, [20, 22, 23]).zone).toBe('mode.errZoneInvalid');
    expect(validateAddress({ ...base, zone: '30' }, [20, 22, 23]).zone).toBe('mode.errZoneInvalid');
    expect(hasAnyError(validateAddress({ ...base, zone: '10' }, [20, 22, 23]))).toBe(false);
    expect(hasAnyError(validateAddress({ ...base, municipality: 'Mixco' }, [20, 22, 23]))).toBe(
      false,
    );
  });

  it('pide departamento, municipio y una dirección de al menos 5 caracteres', () => {
    const errors = validateAddress({
      ...EMPTY_ADDRESS,
      department: '',
      municipality: '',
      line: 'ab',
    });
    expect(errors).toMatchObject({
      department: 'validation.department',
      municipality: 'validation.municipality',
      address: 'validation.address',
    });
  });

  it('normaliza la zona para el contrato y arma el texto', () => {
    expect(zoneForOrder({ ...DEMO_ADDRESS, zone: ' 07 ' })).toBe('7');
    expect(zoneForOrder({ ...DEMO_ADDRESS, municipality: 'Mixco', zone: '10' })).toBe('');
    expect(formatAddress(DEMO_ADDRESS, 'zona')).toBe(
      '6a avenida 10-50, Edificio Demo, apto. 3, zona 10, Guatemala, Guatemala',
    );
  });
});

describe('reductor del checkout', () => {
  it('cambiar la dirección invalida la cotización y la sucursal elegida a mano', () => {
    let s = checkoutReducer(initialDraft(true), { type: 'goto', step: 3 });
    expect(s.quoteWanted).toBe(true);
    s = checkoutReducer(s, { type: 'address', patch: { line: 'Otra dirección 12' } });
    expect(s.quoteWanted).toBe(false);
    expect(s.addressId).toBe('other');
    s = checkoutReducer(s, { type: 'goto', step: 3 });
    s = checkoutReducer(s, { type: 'delivery-branch', branchId: 'sucursal-2' });
    expect(s.quoteWanted).toBe(false);
    expect(s.deliveryBranchId).toBe('sucursal-2');
  });

  it('ir a un paso limpia los errores y "show-errors" los muestra', () => {
    let s = checkoutReducer(initialDraft(false), { type: 'show-errors' });
    expect(s.showErrors).toBe(true);
    s = checkoutReducer(s, { type: 'goto', step: 2 });
    expect(s.showErrors).toBe(false);
    expect(s.step).toBe(2);
  });

  it('con la fuente real el formulario nace vacío (los datos demo son solo del mock)', () => {
    expect(initialDraft(false).contact).toEqual({ name: '', phone: '', email: '' });
    expect(initialDraft(true).contact).toEqual(DEMO_CONTACT);
  });
});

describe('persistencia no sensible', () => {
  it('serializa sin errores visibles y se restaura', () => {
    const draft = { ...initialDraft(true), step: 4 as const, payment: 'cash' as const };
    const restored = parseDraft(serializeDraft(draft), initialDraft(true));
    expect(restored).toMatchObject({ step: 4, payment: 'cash', showErrors: false });
    expect(serializeDraft(draft)).not.toContain('showErrors');
  });

  it('descarta basura y valores fuera de rango', () => {
    expect(parseDraft('no es json', initialDraft(true))).toBeNull();
    expect(parseDraft(null, initialDraft(true))).toBeNull();
    expect(parseDraft(JSON.stringify({ step: 99 }), initialDraft(true))?.step).toBe(1);
  });

  it('el borrador no tiene ningún campo de tarjeta', () => {
    const json = serializeDraft(initialDraft(true)).toLowerCase();
    for (const forbidden of ['cardnumber', 'cvv', 'pan', 'expiry', 'holder']) {
      expect(json).not.toContain(forbidden);
    }
    expect(CHECKOUT_STORAGE_KEY).toBe('monsushi-checkout-v1');
  });
});

import { BadRequestException } from '@nestjs/common';
import {
  assertCoordinatePair,
  diffBranch,
  normalizeCreate,
  normalizePhone,
  normalizeStatus,
  normalizeUpdate,
  resultingCoordinates,
} from './branch-policy.js';
import type { AdminBranchView } from './branches.types.js';

const valid = { code: 'zona-10', name: 'Zona 10', address: '6a Avenida 12-34, Zona 10' };

const stored: AdminBranchView = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'zona-10',
  name: 'Zona 10',
  address: 'Zona 10',
  phone: '+502 2222-3333',
  latitude: 14.6,
  longitude: -90.5,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('branch-policy · alta', () => {
  it('crea con datos válidos y aplica valores por defecto', () => {
    expect(normalizeCreate(valid)).toEqual({
      ...valid,
      phone: null,
      latitude: null,
      longitude: null,
      active: true,
    });
  });

  it('normaliza el código (trim + minúsculas) y colapsa espacios en nombre y dirección', () => {
    const r = normalizeCreate({
      code: '  ZONA-10 ',
      name: '  Sushi   Mon  Z10 ',
      address: ' 6a   Av ',
    });
    expect(r).toMatchObject({ code: 'zona-10', name: 'Sushi Mon Z10', address: '6a Av' });
  });

  it.each([
    '',
    '   ',
    'a',
    'a'.repeat(41),
    'zona_10',
    '-zona',
    'zona-',
    'zo--na',
    'zona 10',
    'ñandú',
  ])('rechaza el código %j', (code) => {
    expect(() => normalizeCreate({ ...valid, code })).toThrow(BadRequestException);
  });

  it.each([{ name: '   ' }, { address: '' }, { address: '   ' }, { name: 'x'.repeat(101) }])(
    'rechaza nombre/dirección vacíos o demasiado largos %j',
    (over) => {
      expect(() => normalizeCreate({ ...valid, ...over })).toThrow(BadRequestException);
    },
  );

  it('el teléfono es opcional; vacío equivale a sin teléfono', () => {
    expect(normalizeCreate({ ...valid, phone: null }).phone).toBeNull();
    expect(normalizeCreate({ ...valid, phone: '  ' }).phone).toBeNull();
    expect(normalizeCreate({ ...valid, phone: '+502 (2222) 33-33' }).phone).toBe(
      '+502 (2222) 33-33',
    );
  });

  it.each(['123456', '1'.repeat(16), 'abc-1234567', '22 22 33 3x', '502+22223333', '<script>'])(
    'rechaza el teléfono %j',
    (phone) => {
      expect(() => normalizePhone(phone)).toThrow(BadRequestException);
    },
  );

  it('acepta coordenadas válidas y en los extremos', () => {
    expect(normalizeCreate({ ...valid, latitude: 90, longitude: -180 })).toMatchObject({
      latitude: 90,
      longitude: -180,
    });
  });

  it.each([
    { latitude: 91, longitude: 0 },
    { latitude: -90.0000001, longitude: 0 },
    { latitude: 0, longitude: 180.5 },
    { latitude: Number.NaN, longitude: 0 },
  ])('rechaza coordenadas fuera de rango %j', (c) => {
    expect(() => normalizeCreate({ ...valid, ...c })).toThrow(BadRequestException);
  });

  it('exige el par completo: lat sin lon o lon sin lat es inválido; ambas nulas es válido', () => {
    expect(() => normalizeCreate({ ...valid, latitude: 14.6 })).toThrow(BadRequestException);
    expect(() => normalizeCreate({ ...valid, longitude: -90.5 })).toThrow(BadRequestException);
    expect(() => normalizeCreate({ ...valid, latitude: null, longitude: null })).not.toThrow();
  });

  it('redondea las coordenadas a 7 decimales (numeric(10,7))', () => {
    expect(normalizeCreate({ ...valid, latitude: 14.123456789, longitude: -90.1 }).latitude).toBe(
      14.1234568,
    );
  });
});

describe('branch-policy · actualización', () => {
  it('solo incluye los campos presentes; null borra teléfono y coordenadas', () => {
    expect(normalizeUpdate({ name: ' Nuevo  nombre ' })).toEqual({ name: 'Nuevo nombre' });
    expect(normalizeUpdate({ phone: null, latitude: null, longitude: null })).toEqual({
      phone: null,
      latitude: null,
      longitude: null,
    });
  });

  it('un PATCH vacío es inválido', () => {
    expect(() => normalizeUpdate({})).toThrow(BadRequestException);
  });

  it('name/address no pueden quedar vacíos', () => {
    expect(() => normalizeUpdate({ name: '  ' })).toThrow(BadRequestException);
    expect(() => normalizeUpdate({ address: '' })).toThrow(BadRequestException);
  });

  it('valida el par resultante tras mezclar con lo almacenado', () => {
    const pair = (patch: Parameters<typeof resultingCoordinates>[1]) => {
      const { latitude, longitude } = resultingCoordinates(stored, patch);
      assertCoordinatePair(latitude, longitude);
    };
    expect(() => pair({ latitude: 10 })).not.toThrow(); // lon almacenada completa el par
    expect(() => pair({ latitude: null })).toThrow(BadRequestException); // dejaría lon sola
    expect(() => pair({ latitude: null, longitude: null })).not.toThrow();
  });

  it('diff: solo campos que cambian; sin cambios → null', () => {
    expect(diffBranch(stored, { name: 'Zona 10', phone: '+502 2222-3333' })).toBeNull();
    expect(diffBranch(stored, { name: 'Otra', address: 'Zona 10' })).toEqual({
      changes: { name: 'Otra' },
      oldValues: { name: 'Zona 10' },
      newValues: { name: 'Otra' },
    });
    expect(diffBranch(stored, { phone: null })?.newValues).toEqual({ phone: null });
  });
});

describe('branch-policy · estado', () => {
  it('desactivar exige motivo', () => {
    expect(() => normalizeStatus({ active: false })).toThrow(BadRequestException);
    expect(() => normalizeStatus({ active: false, reason: '   ' })).toThrow(BadRequestException);
    expect(normalizeStatus({ active: false, reason: ' Remodelación  total ' })).toEqual({
      active: false,
      reason: 'Remodelación total',
    });
  });

  it('activar no exige motivo', () => {
    expect(normalizeStatus({ active: true })).toEqual({ active: true, reason: null });
  });

  it('limita la longitud del motivo', () => {
    expect(() => normalizeStatus({ active: false, reason: 'x'.repeat(201) })).toThrow(
      BadRequestException,
    );
  });
});

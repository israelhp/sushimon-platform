import { describe, expect, it } from 'vitest';
import type { CustomerAddressResponse } from '@/lib/data-access/models';
import { toAddress, toCreateRequest, toUpdateRequest, zoneFromApi, zoneToApi } from './account';

describe('zona de la dirección (F05): «N» de la UI ↔ «Zona N» de la API', () => {
  it('ciudad de Guatemala: de la API a la UI quita «Zona »; sin zona (dirección antigua) queda vacía', () => {
    expect(zoneFromApi('Zona 10', 'Guatemala', 'Guatemala')).toBe('10');
    expect(zoneFromApi('zona 05', 'Guatemala', 'Guatemala')).toBe('5');
    expect(zoneFromApi(null, 'Guatemala', 'Guatemala')).toBe('');
    // Fuera de la ciudad es texto libre y no se reinterpreta.
    expect(zoneFromApi('Zona 10', 'Guatemala', 'Mixco')).toBe('Zona 10');
    expect(zoneFromApi('Colonia Lomas', 'Guatemala', 'Mixco')).toBe('Colonia Lomas');
  });

  it('de la UI a la API: número ⇒ «Zona N»; vacío ⇒ null; lo demás se envía y decide el servidor', () => {
    expect(zoneToApi('10', 'Guatemala', 'Guatemala')).toBe('Zona 10');
    expect(zoneToApi(' 05 ', 'Guatemala', 'Guatemala')).toBe('Zona 5');
    expect(zoneToApi('', 'Guatemala', 'Guatemala')).toBeNull();
    expect(zoneToApi('abc', 'Guatemala', 'Guatemala')).toBe('abc');
    expect(zoneToApi('  Colonia   Lomas ', 'Guatemala', 'Mixco')).toBe('Colonia Lomas');
    expect(zoneToApi('10', 'Guatemala', 'Mixco')).toBe('10');
    // Edición parcial sin lugar conocido: un número solo puede ser una zona de la ciudad.
    expect(zoneToApi('7')).toBe('Zona 7');
  });

  it('toAddress y los cuerpos de creación/edición aplican la conversión', () => {
    const response: CustomerAddressResponse = {
      id: 'a1',
      label: 'Casa',
      department: { id: 'd', name: 'Guatemala' },
      municipality: { id: 'm', name: 'Guatemala' },
      zone: 'Zona 12',
      addressLine: '5a avenida 1-23',
      referenceNote: null,
      latitude: null,
      longitude: null,
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(toAddress(response).zone).toBe('12');
    const input = {
      label: 'home' as const,
      municipalityId: 'm',
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '12',
      line: '5a avenida 1-23',
    };
    expect(toCreateRequest(input).zone).toBe('Zona 12');
    expect(toUpdateRequest(input)['zone']).toBe('Zona 12');
    expect(toUpdateRequest({ zone: '' })['zone']).toBeNull();
    expect(toUpdateRequest({ line: 'otra' })).not.toHaveProperty('zone');
  });
});

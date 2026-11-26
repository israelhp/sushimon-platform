import { describe, expect, it } from 'vitest';
import type { Address } from '@/lib/data-access/models';
import { MAX_ADDRESSES } from '@/features/account/validation';
import type { AddressForm } from './checkout-model';
import { addressSignature, decideSaveAddress, isAddressSaved } from './save-address';

const draft: AddressForm = {
  department: 'Guatemala',
  municipality: 'Mixco',
  zone: '3',
  line: ' 5a avenida 10-20 ',
  references: ' portón negro ',
};
const MUNICIPALITIES = [
  { id: 'm-guate', name: 'Guatemala' },
  { id: 'm-mixco', name: 'Mixco' },
];
const saved = (n: number): Address[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    isDefault: i === 0,
    label: 'home' as const,
    customLabel: '',
    municipalityId: 'm-guate',
    department: 'Guatemala',
    municipality: 'Guatemala',
    zone: '10',
    line: `Calle ${i}`,
    references: '',
    createdAt: '2026-01-01T00:00:00Z',
  }));

const base = {
  signedIn: true,
  wantsSave: true,
  isOther: true,
  label: 'work' as const,
  draft,
  addresses: [] as Address[],
  municipalities: MUNICIPALITIES,
  alreadySavedSignature: null,
};

describe('decideSaveAddress (F05, al continuar desde Entrega)', () => {
  it('guarda con el municipio del catálogo real y datos recortados', () => {
    expect(decideSaveAddress(base)).toEqual({
      action: 'save',
      input: {
        label: 'work',
        customLabel: '',
        municipalityId: 'm-mixco',
        department: 'Guatemala',
        municipality: 'Mixco',
        zone: '3',
        line: '5a avenida 10-20',
        references: 'portón negro',
      },
    });
  });

  it.each([
    ['invitado', { signedIn: false }],
    ['sin marcar «guardar»', { wantsSave: false }],
  ])('omite: %s', (_name, patch) => {
    expect(decideSaveAddress({ ...base, ...patch })).toEqual({ action: 'skip' });
  });

  it('omite si eligió una dirección guardada (no es "otra") o si la dirección ya existe', () => {
    expect(decideSaveAddress({ ...base, addresses: saved(2), isOther: false })).toEqual({
      action: 'skip',
    });
    const dup: Address = {
      ...saved(1)[0]!,
      line: '5A AVENIDA 10-20',
      municipality: 'Mixco',
      zone: '3',
    };
    expect(isAddressSaved(draft, [dup])).toBe(true);
    expect(decideSaveAddress({ ...base, addresses: [dup] })).toEqual({ action: 'skip' });
  });

  it('no crea duplicados al ir y volver: la firma ya guardada se omite', () => {
    const alreadySavedSignature = addressSignature(draft);
    expect(decideSaveAddress({ ...base, alreadySavedSignature })).toEqual({ action: 'skip' });
    // Otra dirección distinta sí se guarda.
    const other = { ...draft, line: 'Otra calle 1' };
    expect(decideSaveAddress({ ...base, draft: other, alreadySavedSignature }).action).toBe('save');
  });

  it('avisa (no silencioso) si ya hay el máximo de direcciones', () => {
    expect(decideSaveAddress({ ...base, addresses: saved(MAX_ADDRESSES) })).toEqual({
      action: 'full',
    });
  });

  it('avisa (no silencioso) si el municipio no está en el catálogo', () => {
    expect(decideSaveAddress({ ...base, municipalities: [] })).toEqual({
      action: 'no-municipality',
    });
    expect(
      decideSaveAddress({ ...base, municipalities: [{ id: 'x', name: 'Villa Nueva' }] }),
    ).toEqual({ action: 'no-municipality' });
  });
});

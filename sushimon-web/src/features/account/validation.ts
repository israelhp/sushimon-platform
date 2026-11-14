import type { AddressInput } from '@/lib/data-access/models';
import { checkZone, MIN_ADDRESS_LENGTH, requiresZone } from '../order-mode/draft';

/**
 * Validación de formularios de la cuenta. Puras y sin React: devuelven CLAVES de mensajes
 * (`validation.*` / `mode.*`) que la UI traduce y asocia con `aria-describedby`.
 * Es una ayuda de UX: la validación definitiva la hace siempre el servidor.
 */

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Teléfono de Guatemala: 8 dígitos (acepta el prefijo 502). */
export function isValidPhone(phone: string): boolean {
  const d = digitsOf(phone);
  return (d.length === 11 && d.startsWith('502') ? d.slice(3) : d).length === 8;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** F04: solo nombre y teléfono son editables; el correo es de la identidad (solo lectura). */
export type ProfileErrorKey = 'validation.name' | 'validation.phone';

export interface ProfileFormValues {
  fullName: string;
  phone: string;
}

export type ProfileErrors = Partial<Record<keyof ProfileFormValues, ProfileErrorKey>>;

export function validateProfile(values: ProfileFormValues): ProfileErrors {
  const errors: ProfileErrors = {};
  if (values.fullName.trim().length < 3) errors.fullName = 'validation.name';
  if (!isValidPhone(values.phone)) errors.phone = 'validation.phone';
  return errors;
}

export type AddressErrorKey =
  | 'validation.department'
  | 'validation.municipality'
  | 'validation.zone'
  | 'mode.errZoneInvalid'
  | 'validation.address';

export type AddressErrors = Partial<
  Record<'department' | 'municipality' | 'zone' | 'line', AddressErrorKey>
>;

export type AddressFormValues = Required<AddressInput>;

export const EMPTY_ADDRESS: AddressFormValues = {
  label: 'home',
  customLabel: '',
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '',
  line: '',
  references: '',
};

export function validateAddress(
  values: AddressFormValues,
  nonexistentZones: readonly number[],
): AddressErrors {
  const errors: AddressErrors = {};
  if (!values.department) errors.department = 'validation.department';
  if (!values.municipality) errors.municipality = 'validation.municipality';
  if (requiresZone(values.department, values.municipality)) {
    const zone = checkZone(values.zone, nonexistentZones);
    if (zone === 'required') errors.zone = 'validation.zone';
    if (zone === 'invalid') errors.zone = 'mode.errZoneInvalid';
  }
  if (values.line.trim().length < MIN_ADDRESS_LENGTH) errors.line = 'validation.address';
  return errors;
}

/** Máximo de direcciones por cuenta (igual que el servidor mock; la API real decide). */
export const MAX_ADDRESSES = 10;

export const hasErrors = (errors: object) => Object.values(errors).some(Boolean);

import type { AddressInput } from '@/lib/data-access/models';
import { MAX_ZONE, MIN_ADDRESS_LENGTH, requiresZone } from '../order-mode/draft';

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
  | 'validation.zoneInvalid'
  | 'validation.zoneTooLong'
  | 'validation.address';

export type AddressErrors = Partial<
  Record<'department' | 'municipality' | 'zone' | 'line', AddressErrorKey>
>;

export type AddressFormValues = Required<AddressInput>;

export const EMPTY_ADDRESS: AddressFormValues = {
  label: 'home',
  customLabel: '',
  municipalityId: '',
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '',
  line: '',
  references: '',
};

/** Zona libre (fuera de la ciudad de Guatemala): máximo de caracteres (ADR-0014 §13). */
export const ZONE_FREE_MAX = 60;

/**
 * Zona de una dirección (F05, decisión C2). Ciudad de Guatemala: OBLIGATORIA, número entero de 1 a 25 (la API la guarda
 * como «Zona N»). Demás municipios: opcional, texto libre ≤ 60. No se compara con las zonas de cobertura de F09 ni con
 * las zonas «inexistentes» de la configuración: esa regla es del checkout (pedido), no de la libreta de direcciones.
 */
export function checkAddressZone(
  values: Pick<AddressFormValues, 'department' | 'municipality' | 'zone'>,
): AddressErrorKey | undefined {
  const text = values.zone.trim();
  if (!requiresZone(values.department, values.municipality)) {
    return text.length > ZONE_FREE_MAX ? 'validation.zoneTooLong' : undefined;
  }
  if (!text) return 'validation.zone';
  const n = Number(text);
  return /^\d{1,3}$/.test(text) && n >= 1 && n <= MAX_ZONE ? undefined : 'validation.zoneInvalid';
}

export function validateAddress(values: AddressFormValues): AddressErrors {
  const errors: AddressErrors = {};
  if (!values.department) errors.department = 'validation.department';
  if (!values.municipality || !values.municipalityId)
    errors.municipality = 'validation.municipality';
  const zone = checkAddressZone(values);
  if (zone) errors.zone = zone;
  if (values.line.trim().length < MIN_ADDRESS_LENGTH) errors.line = 'validation.address';
  return errors;
}

/** Máximo de direcciones por cuenta (igual que el servidor mock; la API real decide). */
export const MAX_ADDRESSES = 10;

export const hasErrors = (errors: object) => Object.values(errors).some(Boolean);

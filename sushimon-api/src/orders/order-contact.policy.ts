import { BadRequestException } from '@nestjs/common';
import { normalizeFullName } from '../customers/customer-profile.policy.js';
import { contactIncomplete } from './orders-errors.js';

/**
 * Reglas PURAS del contacto, las notas y el texto de dirección de un pedido (F20, spec 021 §8). Sin Nest ni BD. PII:
 * nada de lo que se normaliza aquí se registra en logs; los mensajes de error son fijos (sin eco de la entrada).
 */

export const NOTES_MAX = 280;
export const ADDRESS_LINE_MIN = 5;
export const ADDRESS_LINE_MAX = 200;
export const REFERENCE_NOTE_MAX = 200;
export const EMAIL_MAX = 254;

/** Teléfono de Guatemala: 8 dígitos que empiezan por 2-7, con `+502`/`502`, espacios o guiones opcionales. */
const GT_PHONE = /^(\+?502)?[\s-]?([2-7][0-9]{3})[\s-]?([0-9]{4})$/;
/** Caracteres de control (salvo salto de línea y tabulación) y de dirección bidireccional (spoofing visual). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `+502XXXXXXXX` o `null` si no es un teléfono de Guatemala válido. */
export function normalizePhone(raw: string): string | null {
  const m = GT_PHONE.exec(raw.trim());
  return m ? `+502${m[2]}${m[3]}` : null;
}

/** Correo en minúsculas (<= 254) o `null` si no tiene forma de correo. */
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return value.length > 0 && value.length <= EMAIL_MAX && EMAIL.test(value) ? value : null;
}

/** Teléfono enmascarado para la respuesta: `****1234`. */
export function maskPhone(phone: string): string {
  return `****${phone.slice(-4)}`;
}

const invalid = (message: string) => new BadRequestException([message]);

/** Texto plano sin control/bidi, recortado, de longitud acotada en puntos de código. `null` si queda vacío. */
export function sanitizeText(raw: string, field: string, min: number, max: number): string | null {
  if (FORBIDDEN_TEXT.test(raw)) throw invalid(`${field}: contiene caracteres no permitidos`);
  const value = raw.trim();
  const length = [...value].length;
  if (length === 0) return null;
  if (length > max) throw invalid(`${field}: máximo ${max} caracteres`);
  if (length < min) throw invalid(`${field}: mínimo ${min} caracteres`);
  return value;
}

export function normalizeNotes(raw: string | undefined): string | null {
  return raw === undefined ? null : sanitizeText(raw, 'notes', 1, NOTES_MAX);
}

export interface AddressTextInput {
  addressLine: string;
  referenceNote?: string | undefined;
}

export interface AddressText {
  addressLine: string;
  referenceNote: string | null;
}

export function normalizeAddressText(input: AddressTextInput): AddressText {
  const addressLine = sanitizeText(
    input.addressLine,
    'deliveryAddress.addressLine',
    ADDRESS_LINE_MIN,
    ADDRESS_LINE_MAX,
  );
  if (addressLine === null) throw invalid('deliveryAddress.addressLine: es obligatorio');
  const referenceNote =
    input.referenceNote === undefined
      ? null
      : sanitizeText(input.referenceNote, 'deliveryAddress.referenceNote', 1, REFERENCE_NOTE_MAX);
  return { addressLine, referenceNote };
}

export interface ContactInput {
  fullName?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
}

/** Datos del perfil del cliente autenticado (`customers`). */
export interface ProfileContact {
  fullName: string;
  phone: string | null;
  email: string | null;
}

export interface OrderContact {
  fullName: string;
  phone: string;
  email: string | null;
}

/** Nombre del perfil, tolerante: el del perfil ya lo validó F04; aquí solo se limpia y se acota. */
function profileName(raw: string): string | null {
  const value = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...value];
  return chars.length >= 2 ? chars.slice(0, 120).join('') : null;
}

/**
 * Contacto del pedido. Invitado (`profile === null`): `fullName` y `phone` obligatorios (400 si faltan o son inválidos).
 * Autenticado: cada campo de `contact` prevalece y lo que falte se completa con el perfil; sin teléfono válido en
 * ninguno => 422 `CONTACT_INCOMPLETE`. NUNCA se escribe de vuelta en el perfil.
 */
export function resolveContact(
  input: ContactInput | undefined,
  profile: ProfileContact | null,
): OrderContact {
  const c = input ?? {};
  let fullName: string | null = null;
  if (c.fullName !== undefined) {
    const result = normalizeFullName(c.fullName);
    if (!result.ok) throw invalid('contact.fullName: nombre inválido');
    fullName = result.value;
  } else if (profile) {
    fullName = profileName(profile.fullName);
  }
  let phone: string | null = null;
  if (c.phone !== undefined) {
    phone = normalizePhone(c.phone);
    if (phone === null) throw invalid('contact.phone: teléfono de Guatemala inválido');
  } else if (profile?.phone) {
    phone = normalizePhone(profile.phone);
  }
  let email: string | null = null;
  if (c.email !== undefined) {
    email = normalizeEmail(c.email);
    if (email === null) throw invalid('contact.email: correo inválido');
  } else if (profile?.email) {
    email = normalizeEmail(profile.email);
  }

  if (profile === null) {
    if (fullName === null) throw invalid('contact.fullName: es obligatorio');
    if (phone === null) throw invalid('contact.phone: es obligatorio');
  } else if (fullName === null || phone === null) {
    throw contactIncomplete([
      ...(fullName === null
        ? [{ path: 'contact.fullName', code: 'REQUIRED', message: 'Falta el nombre' }]
        : []),
      ...(phone === null
        ? [{ path: 'contact.phone', code: 'REQUIRED', message: 'Falta el teléfono' }]
        : []),
    ]);
  }
  return { fullName, phone, email };
}

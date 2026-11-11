import type { AddressForm, ContactForm } from './checkout-model';

/**
 * "Recordar mis datos en este dispositivo" (opcional, con consentimiento explícito, como el prototipo):
 * guarda nombre, teléfono, correo y dirección en localStorage. NUNCA datos de tarjeta, y no autoriza nada.
 */
export const REMEMBER_CONSENT_KEY = 'monsushi-remember-consent-v1';
export const REMEMBER_DATA_KEY = 'monsushi-customer-v1';

export interface RememberedData {
  contact: ContactForm;
  address: AddressForm;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function hasRememberConsent(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function readRemembered(): RememberedData | null {
  if (!hasRememberConsent()) return null;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(REMEMBER_DATA_KEY) ?? 'null');
    if (!isObject(raw)) return null;
    return {
      contact: { name: str(raw.name), phone: str(raw.phone), email: str(raw.email) },
      address: {
        department: str(raw.department) || 'Guatemala',
        municipality: str(raw.municipality) || 'Guatemala',
        zone: str(raw.zone),
        line: str(raw.address),
        references: str(raw.references),
      },
    };
  } catch {
    return null;
  }
}

export function writeRemembered(data: RememberedData): void {
  try {
    window.localStorage.setItem(REMEMBER_CONSENT_KEY, '1');
    window.localStorage.setItem(
      REMEMBER_DATA_KEY,
      JSON.stringify({
        ...data.contact,
        department: data.address.department,
        municipality: data.address.municipality,
        zone: data.address.zone,
        address: data.address.line,
        references: data.address.references,
      }),
    );
  } catch {
    /* almacenamiento no disponible */
  }
}

export function clearRemembered(): void {
  try {
    window.localStorage.removeItem(REMEMBER_CONSENT_KEY);
    window.localStorage.removeItem(REMEMBER_DATA_KEY);
  } catch {
    /* nada que limpiar */
  }
}

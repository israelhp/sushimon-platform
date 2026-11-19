import { checkZone, requiresZone } from '@/features/order-mode/draft';

/**
 * Modelo PURO del checkout (sin React): borrador, reductor y validaciones. Devuelve CLAVES de mensajes
 * (`validation.*` / `mode.*`) que la UI traduce. F24: el único método es EFECTIVO (no se elige ni se guarda en el borrador):
 * aquí no vive NINGÚN dato de pago.
 */
export const CHECKOUT_STEP_COUNT = 5;
export type CheckoutStep = 1 | 2 | 3 | 4 | 5;

export interface ContactForm {
  name: string;
  phone: string;
  email: string;
}

export interface AddressForm {
  department: string;
  municipality: string;
  zone: string;
  line: string;
  references: string;
}

export interface CheckoutDraft {
  step: CheckoutStep;
  /** Muestra los errores de validación (tras intentar avanzar). */
  showErrors: boolean;
  contact: ContactForm;
  address: AddressForm;
  /** Dirección guardada elegida (id) o `'other'` (escrita a mano). */
  addressId: string;
  notes: string;
  /** Sucursal para recoger (null = la primera activa / la elegida en el modo de pedido). */
  pickupBranchId: string | null;
  /** Sucursal de origen elegida a mano a domicilio (null = asignada por cobertura). */
  deliveryBranchId: string | null;
  /** La estimación de envío se pide solo desde el paso Envío (y se invalida al cambiar dirección/sucursal). */
  quoteWanted: boolean;
}

export const EMPTY_CONTACT: ContactForm = { name: '', phone: '', email: '' };
export const EMPTY_ADDRESS: AddressForm = {
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '',
  line: '',
  references: '',
};

/** Datos de demostración que el prototipo precarga en el formulario (solo con la fuente mock). */
export const DEMO_CONTACT: ContactForm = {
  name: 'Cliente Demo',
  phone: '5555-1234',
  email: 'cliente@ejemplo.com',
};
export const DEMO_ADDRESS: AddressForm = {
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '10',
  line: '6a avenida 10-50, Edificio Demo, apto. 3',
  references: 'Portón negro, frente al parque',
};

export function initialDraft(demo: boolean): CheckoutDraft {
  return {
    step: 1,
    showErrors: false,
    contact: demo ? DEMO_CONTACT : EMPTY_CONTACT,
    address: demo ? DEMO_ADDRESS : EMPTY_ADDRESS,
    addressId: 'other',
    notes: '',
    pickupBranchId: null,
    deliveryBranchId: null,
    quoteWanted: false,
  };
}

// ── Reductor ────────────────────────────────────────────────────────────────────────────────

export type CheckoutAction =
  | { type: 'hydrate'; draft: CheckoutDraft }
  | { type: 'contact'; patch: Partial<ContactForm> }
  | { type: 'address'; patch: Partial<AddressForm>; addressId?: string }
  | { type: 'fill-address'; address: AddressForm; addressId: string }
  | { type: 'notes'; notes: string }
  | { type: 'pickup-branch'; branchId: string | null }
  | { type: 'delivery-branch'; branchId: string | null }
  | { type: 'goto'; step: CheckoutStep; showErrors?: boolean }
  | { type: 'show-errors' }
  | { type: 'reset'; demo: boolean };

export function checkoutReducer(state: CheckoutDraft, action: CheckoutAction): CheckoutDraft {
  switch (action.type) {
    case 'hydrate':
      return action.draft;
    case 'contact':
      return { ...state, contact: { ...state.contact, ...action.patch } };
    case 'address':
      return {
        ...state,
        address: { ...state.address, ...action.patch },
        addressId: action.addressId ?? 'other',
        quoteWanted: false,
      };
    case 'fill-address':
      return {
        ...state,
        address: action.address,
        addressId: action.addressId,
        deliveryBranchId: null,
        quoteWanted: false,
      };
    case 'notes':
      return { ...state, notes: action.notes };
    case 'pickup-branch':
      return { ...state, pickupBranchId: action.branchId };
    case 'delivery-branch':
      return { ...state, deliveryBranchId: action.branchId, quoteWanted: false };
    case 'goto':
      return {
        ...state,
        step: action.step,
        showErrors: action.showErrors ?? false,
        quoteWanted: action.step === 3 ? true : state.quoteWanted,
      };
    case 'show-errors':
      return { ...state, showErrors: true };
    case 'reset':
      return initialDraft(action.demo);
  }
}

// ── Validaciones ────────────────────────────────────────────────────────────────────────────

export type ValidationKey =
  | 'validation.name'
  | 'validation.phone'
  | 'validation.email'
  | 'validation.department'
  | 'validation.municipality'
  | 'validation.zone'
  | 'validation.address'
  | 'mode.errZoneInvalid';

export type ContactErrors = Partial<Record<keyof ContactForm, ValidationKey>>;
export interface AddressErrors {
  department?: ValidationKey;
  municipality?: ValidationKey;
  zone?: ValidationKey;
  address?: ValidationKey;
}

export const MIN_NAME_LENGTH = 3;
export const MIN_ADDRESS_LINE = 5;

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Teléfono de Guatemala: 8 dígitos, con o sin el prefijo +502. */
export function isValidPhone(value: string): boolean {
  const d = digitsOf(value);
  return (d.length === 11 && d.startsWith('502') ? d.slice(3) : d).length === 8;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function validateContact(contact: ContactForm): ContactErrors {
  const errors: ContactErrors = {};
  if (contact.name.trim().length < MIN_NAME_LENGTH) errors.name = 'validation.name';
  if (!isValidPhone(contact.phone)) errors.phone = 'validation.phone';
  if (!isValidEmail(contact.email)) errors.email = 'validation.email';
  return errors;
}

export function validateAddress(
  address: AddressForm,
  nonexistentZones: readonly number[] = [],
): AddressErrors {
  const errors: AddressErrors = {};
  if (!address.department) errors.department = 'validation.department';
  if (!address.municipality) errors.municipality = 'validation.municipality';
  if (requiresZone(address.department, address.municipality)) {
    const zone = checkZone(address.zone, nonexistentZones);
    if (zone === 'required') errors.zone = 'validation.zone';
    if (zone === 'invalid') errors.zone = 'mode.errZoneInvalid';
  }
  if (address.line.trim().length < MIN_ADDRESS_LINE) errors.address = 'validation.address';
  return errors;
}

export const hasAnyError = (errors: object) => Object.values(errors).some(Boolean);

/** Zona normalizada para el contrato (vacía si el municipio no usa zonas). */
export function zoneForOrder(address: AddressForm): string {
  return requiresZone(address.department, address.municipality)
    ? String(Number(address.zone.trim()))
    : '';
}

// ── Persistencia NO sensible (sessionStorage) ──────────────────────────────────────────────

/** Borrador del checkout de la pestaña: contacto y dirección (PII), nunca datos de tarjeta. */
export const CHECKOUT_STORAGE_KEY = 'monsushi-checkout-v1';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

export function serializeDraft(draft: CheckoutDraft): string {
  const { showErrors: _showErrors, ...rest } = draft;
  void _showErrors;
  return JSON.stringify(rest);
}

export function parseDraft(raw: string | null, fallback: CheckoutDraft): CheckoutDraft | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v)) return null;
    const contact = isObject(v.contact) ? v.contact : {};
    const address = isObject(v.address) ? v.address : {};
    const step = Number(v.step);
    return {
      step: (step >= 1 && step <= CHECKOUT_STEP_COUNT ? step : 1) as CheckoutStep,
      showErrors: false,
      contact: {
        name: str(contact.name, fallback.contact.name),
        phone: str(contact.phone, fallback.contact.phone),
        email: str(contact.email, fallback.contact.email),
      },
      address: {
        department: str(address.department, fallback.address.department),
        municipality: str(address.municipality, fallback.address.municipality),
        zone: str(address.zone),
        line: str(address.line),
        references: str(address.references),
      },
      addressId: str(v.addressId, 'other'),
      notes: str(v.notes).slice(0, 300),
      pickupBranchId: typeof v.pickupBranchId === 'string' ? v.pickupBranchId : null,
      deliveryBranchId: typeof v.deliveryBranchId === 'string' ? v.deliveryBranchId : null,
      quoteWanted: step === 3,
    };
  } catch {
    return null;
  }
}

/** "6a avenida 10-50, zona 10, Guatemala, Guatemala" (la palabra "zona" se traduce fuera). */
export function formatAddress(address: AddressForm, zoneWord: string): string {
  const zone =
    requiresZone(address.department, address.municipality) && address.zone
      ? `${zoneWord} ${address.zone}, `
      : '';
  return `${address.line}, ${zone}${address.municipality}, ${address.department}`;
}

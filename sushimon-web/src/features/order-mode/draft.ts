import type { Department, FulfillmentType } from '@/lib/data-access/models';

/**
 * Borrador y validación del modo de pedido (hoja "Pedir ahora" / "Programar"). Puras y sin React:
 * devuelven CLAVES de mensajes (`validation.*` / `mode.*`) que la UI traduce. La validación
 * definitiva (cobertura, horarios, sucursal abierta) la hace siempre el servidor.
 */
export interface DeliveryDraft {
  department: string;
  municipality: string;
  zone: string;
  line: string;
}

export const DEFAULT_DELIVERY_DRAFT: DeliveryDraft = {
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '',
  line: '',
};

export const MIN_ADDRESS_LENGTH = 5;
export const MAX_ZONE = 25;

/** La Ciudad de Guatemala usa zonas (1–25); el resto de municipios no. */
export function requiresZone(department: string, municipality: string): boolean {
  return department === 'Guatemala' && municipality === 'Guatemala';
}

/** Municipios de un departamento según la configuración de la tienda. */
export function municipalitiesOf(departments: Department[], department: string) {
  return departments.find((d) => d.department === department)?.municipalities ?? [];
}

export type ZoneCheck = 'ok' | 'required' | 'invalid';

export function checkZone(zone: string, nonexistent: readonly number[]): ZoneCheck {
  const text = zone.trim();
  if (!text) return 'required';
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ZONE || nonexistent.includes(n)) return 'invalid';
  return 'ok';
}

export type DraftErrorKey =
  | 'mode.errType'
  | 'validation.branch'
  | 'validation.department'
  | 'validation.municipality'
  | 'mode.errAddress'
  | 'mode.errZone'
  | 'mode.errZoneInvalid';

export interface DraftErrors {
  type?: DraftErrorKey;
  branch?: DraftErrorKey;
  department?: DraftErrorKey;
  municipality?: DraftErrorKey;
  line?: DraftErrorKey;
  zone?: DraftErrorKey;
}

export function validateDraft(
  input: {
    type: FulfillmentType | null;
    branchId: string | null;
    delivery: DeliveryDraft;
  },
  nonexistentZones: readonly number[],
): DraftErrors {
  const errors: DraftErrors = {};
  if (!input.type) {
    errors.type = 'mode.errType';
    return errors;
  }
  if (input.type === 'pickup') {
    if (!input.branchId) errors.branch = 'validation.branch';
    return errors;
  }
  const { department, municipality, zone, line } = input.delivery;
  if (!department) errors.department = 'validation.department';
  if (!municipality) errors.municipality = 'validation.municipality';
  if (line.trim().length < MIN_ADDRESS_LENGTH) errors.line = 'mode.errAddress';
  if (requiresZone(department, municipality)) {
    const zoneCheck = checkZone(zone, nonexistentZones);
    if (zoneCheck === 'required') errors.zone = 'mode.errZone';
    if (zoneCheck === 'invalid') errors.zone = 'mode.errZoneInvalid';
  }
  return errors;
}

export const hasErrors = (errors: DraftErrors) => Object.keys(errors).length > 0;

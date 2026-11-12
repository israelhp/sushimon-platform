import type { CreateIncidentRequest } from '@/lib/data-access/models';

export type IncidentType = CreateIncidentRequest['type'];
export type IncidentResolution = CreateIncidentRequest['resolution'];

export const INCIDENT_TYPES: readonly IncidentType[] = [
  'missing',
  'wrong',
  'late',
  'quality',
  'charge',
  'other',
];

export const INCIDENT_RESOLUTIONS: readonly IncidentResolution[] = [
  'replace',
  'refund',
  'credit',
  'inform',
];

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 500;

/** Tipos que exigen marcar al menos un producto (igual que el servidor mock/API). */
export const TYPES_REQUIRING_ITEMS: readonly IncidentType[] = ['missing', 'wrong', 'quality'];

export interface IncidentDraft {
  type: IncidentType | null;
  items: string[];
  description: string;
  resolution: IncidentResolution | null;
}

export type IncidentField = 'type' | 'items' | 'description' | 'resolution';

/** Clave i18n (`incidents.*`) del error de cada campo; solo los campos inválidos. */
export type IncidentErrors = Partial<
  Record<IncidentField, 'errType' | 'errItems' | 'errDescription' | 'errResolution'>
>;

export const EMPTY_INCIDENT_DRAFT: IncidentDraft = {
  type: null,
  items: [],
  description: '',
  resolution: null,
};

export function validateIncident(draft: IncidentDraft): IncidentErrors {
  const errors: IncidentErrors = {};
  if (!draft.type) errors.type = 'errType';
  if (draft.type && TYPES_REQUIRING_ITEMS.includes(draft.type) && draft.items.length === 0) {
    errors.items = 'errItems';
  }
  const length = draft.description.trim().length;
  if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) errors.description = 'errDescription';
  if (!draft.resolution) errors.resolution = 'errResolution';
  return errors;
}

/** Primer campo inválido, en orden de pantalla (para llevarle el foco). */
export function firstInvalidField(errors: IncidentErrors): IncidentField | null {
  const order: IncidentField[] = ['type', 'items', 'description', 'resolution'];
  return order.find((f) => errors[f]) ?? null;
}

/** Cuerpo de `POST /v1/incidents` (el servidor valida de nuevo y decide si el pedido es visible). */
export function toIncidentRequest(orderId: string, draft: IncidentDraft): CreateIncidentRequest {
  if (!draft.type || !draft.resolution) throw new Error('Reclamo incompleto');
  return {
    orderId,
    type: draft.type,
    items: draft.items,
    description: draft.description.trim(),
    resolution: draft.resolution,
  };
}

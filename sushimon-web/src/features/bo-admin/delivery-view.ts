import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminDeliveryZone,
  CreateDeliveryZoneRequest,
  ProviderIntegrationStatus,
  UpdateDeliveryZoneRequest,
} from '@/lib/data-access/models';
import {
  MONEY_INPUT_PATTERN,
  ZONE_LABEL_MAX,
  normalizeMoney,
  normalizeZoneLabel,
  sameMoney,
  zoneKeyOf,
} from '@/lib/delivery-zone';
import type { DeliveryZoneFilters } from '@/services/delivery-zones';
import { errorMessage } from '../bo-orders/error-message';

/**
 * Entrega por sucursal (UI del backoffice) — F09. Lógica pura: formulario de zonas (validación equivalente a la del
 * servidor para dar mensajes inmediatos; la API decide), solicitudes mínimas, filtros del listado, traducción de errores
 * del contrato (`code` + `violations`) y lectura del estado de la integración de PedidosYa. El backoffice es solo español.
 */

// ── Formulario de zonas ──────────────────────────────────────────────────────────────────

export interface ZoneFormValues {
  branchId: string;
  departmentId: string;
  municipalityId: string;
  /** Vacío = cobertura general del municipio. */
  zoneLabel: string;
  /** Texto: 0–2 decimales (`15`, `15.5`). Nunca `number`. */
  baseFee: string;
  active: boolean;
}

export const ZONE_FIELDS = ['branchId', 'municipalityId', 'zoneLabel', 'baseFee'] as const;
export type ZoneField = (typeof ZONE_FIELDS)[number];
export type ZoneFormErrors = Partial<Record<ZoneField, string>>;

export const emptyZoneForm = (branchId = ''): ZoneFormValues => ({
  branchId,
  departmentId: '',
  municipalityId: '',
  zoneLabel: '',
  baseFee: '',
  active: true,
});

export const zoneToForm = (zone: AdminDeliveryZone): ZoneFormValues => ({
  branchId: zone.branchId,
  departmentId: zone.departmentId,
  municipalityId: zone.municipalityId,
  zoneLabel: zone.zoneLabel ?? '',
  baseFee: zone.baseFee,
  active: zone.active,
});

export const FEE_MESSAGE =
  'Escribe un monto en quetzales entre 0 y 99999.99, con hasta 2 decimales.';

export function validateZoneForm(values: ZoneFormValues, mode: 'create' | 'edit'): ZoneFormErrors {
  const errors: ZoneFormErrors = {};
  if (mode === 'create') {
    if (!values.branchId) errors.branchId = 'Elige la sucursal.';
    if (!values.municipalityId) errors.municipalityId = 'Elige el municipio.';
  }
  const label = normalizeZoneLabel(values.zoneLabel);
  if (!label.ok) {
    errors.zoneLabel =
      label.reason === 'control'
        ? 'La zona no admite caracteres de control.'
        : `La zona admite como máximo ${ZONE_LABEL_MAX} caracteres.`;
  } else if (label.label !== null && zoneKeyOf(label.label) === null) {
    errors.zoneLabel = 'La zona no es válida.';
  }
  if (!values.baseFee.trim()) errors.baseFee = 'Indica la tarifa de envío.';
  else if (!MONEY_INPUT_PATTERN.test(values.baseFee.trim())) errors.baseFee = FEE_MESSAGE;
  return errors;
}

export const firstZoneError = (errors: ZoneFormErrors): ZoneField | undefined =>
  ZONE_FIELDS.find((f) => errors[f]);

/** Etiqueta normalizada del formulario (D6) o `null` = cobertura general. Asume el formulario ya validado. */
const labelOfForm = (values: ZoneFormValues): string | null => {
  const result = normalizeZoneLabel(values.zoneLabel);
  return result.ok ? result.label : null;
};

export function toCreateRequest(values: ZoneFormValues): CreateDeliveryZoneRequest {
  return {
    branchId: values.branchId,
    municipalityId: values.municipalityId,
    zoneLabel: labelOfForm(values),
    baseFee: normalizeMoney(values.baseFee) as string,
    active: values.active,
  };
}

/**
 * Solo lo que cambió (el contrato exige al menos `zoneLabel` o `baseFee`) + `expectedVersion` de la zona cargada;
 * `null` = sin cambios. La sucursal y el municipio son inmutables.
 */
export function toUpdateRequest(
  values: ZoneFormValues,
  original: AdminDeliveryZone,
): UpdateDeliveryZoneRequest | null {
  const patch: UpdateDeliveryZoneRequest = { expectedVersion: original.version };
  const label = labelOfForm(values);
  const fee = normalizeMoney(values.baseFee) as string;
  if (label !== original.zoneLabel) patch.zoneLabel = label;
  if (!sameMoney(fee, original.baseFee)) patch.baseFee = fee;
  return patch.zoneLabel === undefined && patch.baseFee === undefined ? null : patch;
}

export const zoneLabelText = (zone: Pick<AdminDeliveryZone, 'zoneLabel'>): string =>
  zone.zoneLabel ?? 'Todo el municipio';

// ── Listado ──────────────────────────────────────────────────────────────────────────────

export type ZoneStatusFilter = 'all' | 'active' | 'inactive';
export type ZoneSortKey = 'municipality' | 'baseFee' | 'createdAt';

export interface ZoneListState {
  branchId: string;
  departmentId: string;
  municipalityId: string;
  q: string;
  status: ZoneStatusFilter;
  sort: ZoneSortKey;
  order: 'asc' | 'desc';
  page: number;
}

export const ZONE_PAGE_SIZE = 20;

export const DEFAULT_ZONE_LIST: ZoneListState = {
  branchId: '',
  departmentId: '',
  municipalityId: '',
  q: '',
  status: 'all',
  sort: 'municipality',
  order: 'asc',
  page: 1,
};

export function toZoneFilters(state: ZoneListState, fixedBranchId?: string): DeliveryZoneFilters {
  const branchId = fixedBranchId ?? state.branchId;
  return {
    branchId: branchId || undefined,
    departmentId: state.departmentId || undefined,
    municipalityId: state.municipalityId || undefined,
    q: state.q.trim() || undefined,
    active: state.status === 'all' ? undefined : state.status === 'active',
    sort: state.sort,
    order: state.order,
    page: state.page,
    pageSize: ZONE_PAGE_SIZE,
  };
}

export const hasZoneFilters = (state: ZoneListState, fixedBranchId?: string) =>
  (!fixedBranchId && state.branchId !== '') ||
  state.departmentId !== '' ||
  state.municipalityId !== '' ||
  state.q.trim() !== '' ||
  state.status !== 'all';

export const zonePageCount = (total: number, pageSize = ZONE_PAGE_SIZE) =>
  Math.max(1, Math.ceil(total / pageSize));

// ── Errores del servidor ─────────────────────────────────────────────────────────────────

export type ZoneErrorKind =
  'duplicate' | 'versionConflict' | 'municipality' | 'invalid' | 'forbidden' | 'notFound' | 'other';

export interface ZoneServerError {
  kind: ZoneErrorKind;
  message: string;
  fields: ZoneFormErrors;
  /** La zona cambió o ya no existe: hay que recargar la lista/detalle antes de reintentar. */
  reload: boolean;
}

/** 409 `DELIVERY_ZONE_DUPLICATE`/`DELIVERY_ZONE_VERSION_CONFLICT`, 422 `MUNICIPALITY_NOT_FOUND`, 400, 403 y 404. */
export function zoneServerError(error: unknown): ZoneServerError {
  const base = { fields: {} as ZoneFormErrors, reload: false };
  if (!isApiError(error)) return { kind: 'other', message: errorMessage(error), ...base };
  switch (error.businessCode) {
    case 'DELIVERY_ZONE_DUPLICATE':
      return {
        kind: 'duplicate',
        message:
          'Ya existe una zona con esa etiqueta en este municipio de la sucursal (activa o inactiva). Edítala o actívala en lugar de crear otra.',
        fields: { zoneLabel: 'Ya existe esta zona en el municipio.' },
        reload: false,
      };
    case 'DELIVERY_ZONE_VERSION_CONFLICT':
      return {
        kind: 'versionConflict',
        message:
          'Otra persona modificó esta zona mientras la editabas. Se recargaron los datos vigentes: revisa y vuelve a guardar.',
        fields: {},
        reload: true,
      };
    case 'MUNICIPALITY_NOT_FOUND':
      return {
        kind: 'municipality',
        message: 'El municipio elegido ya no existe.',
        fields: { municipalityId: 'El municipio ya no existe.' },
        reload: false,
      };
  }
  if (error.status === 400) {
    const fields: ZoneFormErrors = {};
    for (const detail of error.details ?? []) {
      const field = ZONE_FIELDS.find((f) => detail.startsWith(`${f}:`));
      if (field) fields[field] ??= detail.slice(field.length + 1).trim();
      else if (/^La zona/.test(detail)) fields.zoneLabel ??= detail;
    }
    return {
      kind: 'invalid',
      message: `Revisa los datos: ${(error.details ?? []).join(' · ') || error.message}`,
      fields,
      reload: false,
    };
  }
  if (error.status === 403) {
    return {
      kind: 'forbidden',
      message: 'No tienes permiso para modificar zonas de entrega de esta sucursal.',
      ...base,
    };
  }
  if (error.status === 404) {
    return {
      kind: 'notFound',
      message: 'La zona o la sucursal ya no existe o está fuera de tu alcance.',
      fields: {},
      reload: true,
    };
  }
  return { kind: 'other', message: errorMessage(error), ...base };
}

// ── PedidosYa ────────────────────────────────────────────────────────────────────────────

export interface PedidosYaIntegrationView {
  /** Texto principal; NUNCA indica una conexión exitosa. */
  label: string;
  detail: string;
  /** El dato viene de un adaptador MOCK: se rotula como «Simulación». */
  simulated: boolean;
}

/**
 * Lectura de `pedidosyaIntegrationStatus`. `BLOCKED_EXTERNAL` (defecto y único posible hoy) = integración pendiente de
 * documentación y credenciales; `MOCK` = simulación; `LIVE` está reservado a F29 y F09 jamás lo produce, por lo que
 * cualquier valor distinto de `MOCK` se trata como pendiente (los enums son abiertos: no se asume conexión).
 */
export function pedidosyaIntegrationView(
  status: ProviderIntegrationStatus,
): PedidosYaIntegrationView {
  if (status === 'MOCK') {
    return {
      label: 'Simulación',
      detail:
        'La respuesta de PedidosYa viene de un adaptador simulado (solo desarrollo). No autoriza ninguna operación real.',
      simulated: true,
    };
  }
  return {
    label: 'Integración pendiente de documentación y credenciales',
    detail:
      'PedidosYa no tiene API, sandbox ni credenciales: su cobertura no se puede verificar y se muestra como «no confirmable». El interruptor solo indica si el restaurante quiere considerarlo.',
    simulated: false,
  };
}

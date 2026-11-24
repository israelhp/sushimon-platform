import type { PillTone } from '@/components/ui/Pill';
import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminRider,
  AdminRiderSummary,
  CreateRiderRequest,
  RiderAvailabilityFilter,
  RiderOperationalState,
  RiderVehicleType,
  UpdateRiderRequest,
} from '@/lib/data-access/models';
import {
  RIDER_PHONE_RE,
  RIDER_PLATE_RE,
  RIDER_REASON_MAX,
  RIDER_SEARCH_MAX,
  normalizeRiderPlate,
  riderNameProblem,
  collapseRiderName,
} from '@/lib/rider-rules';
import type { AdminRiderFilters } from '@/services/admin-riders';

/**
 * Motoristas (UI) — F27. Lógica pura de filtros, formularios y errores. La UI solo orienta (valida lo evidente y oculta lo que
 * no corresponde): el servidor decide permisos, alcance, unicidad del teléfono, versión y entregas activas.
 */

export const RIDER_PAGE_SIZE = 20;
export { RIDER_REASON_MAX };

// ── Listado ───────────────────────────────────────────────────────────────────────────────

export type RiderStatusFilter = 'all' | 'active' | 'inactive';
export type RiderSortKey = 'fullName' | 'createdAt' | 'updatedAt';

export interface RiderListState {
  q: string;
  /** '' = todas las sucursales autorizadas. */
  branchId: string;
  status: RiderStatusFilter;
  /** '' = todas. */
  availability: '' | RiderAvailabilityFilter;
  sort: RiderSortKey;
  order: 'asc' | 'desc';
  page: number;
}

export const DEFAULT_RIDER_LIST: RiderListState = {
  q: '',
  branchId: '',
  status: 'all',
  availability: '',
  sort: 'fullName',
  order: 'asc',
  page: 1,
};

export function toRiderFilters(state: RiderListState): AdminRiderFilters {
  return {
    q: state.q.trim().slice(0, RIDER_SEARCH_MAX) || undefined,
    branchId: state.branchId || undefined,
    active: state.status === 'all' ? undefined : state.status === 'active',
    availability: state.availability || undefined,
    sort: state.sort,
    order: state.order,
    page: state.page,
    pageSize: RIDER_PAGE_SIZE,
  };
}

/** ¿Hay algún filtro distinto del predeterminado (búsqueda, sucursal, estado o disponibilidad)? */
export const hasRiderFilters = (state: RiderListState): boolean =>
  state.q.trim() !== '' ||
  state.branchId !== '' ||
  state.status !== 'all' ||
  state.availability !== '';

export const riderPageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

// ── Estado visible ────────────────────────────────────────────────────────────────────────

export const OPERATIONAL_TONE: Record<RiderOperationalState, PillTone> = {
  INACTIVE: 'muted',
  UNAVAILABLE: 'warning',
  BUSY: 'info',
  AVAILABLE: 'success',
};

/**
 * Ocupación a mostrar: solo es real con `busyKnown`. Sin F28 NUNCA se afirma «libre» ni «ocupado»: «sin dato».
 */
export type RiderOccupancy = 'unknown' | 'busy' | 'free';
export const riderOccupancy = (r: Pick<AdminRiderSummary, 'busy' | 'busyKnown'>): RiderOccupancy =>
  !r.busyKnown ? 'unknown' : r.busy ? 'busy' : 'free';

export const VEHICLE_OPTIONS: readonly RiderVehicleType[] = [
  'MOTORCYCLE',
  'BICYCLE',
  'CAR',
  'ON_FOOT',
];

// ── Formulario ────────────────────────────────────────────────────────────────────────────

export interface RiderFormValues {
  branchId: string;
  fullName: string;
  phone: string;
  /** '' = sin vehículo. */
  vehicleType: '' | RiderVehicleType;
  licensePlate: string;
}

export type RiderFormField = keyof RiderFormValues;
/** Clave i18n (`backoffice.riders.form.errors.*`) por campo con error. */
export type RiderFormErrors = Partial<Record<RiderFormField, string>>;

export const emptyRiderForm = (branchId = ''): RiderFormValues => ({
  branchId,
  fullName: '',
  phone: '',
  vehicleType: '',
  licensePlate: '',
});

export const riderToForm = (rider: AdminRider): RiderFormValues => ({
  branchId: rider.branchId,
  fullName: rider.fullName,
  phone: rider.phone,
  vehicleType: rider.vehicleType ?? '',
  licensePlate: rider.licensePlate ?? '',
});

/** Comodidad de entrada: quita separadores de ESPACIO/guion/paréntesis del teléfono (el formato estricto lo valida el resto). */
export const cleanRiderPhone = (raw: string): string => raw.replace(/[\s\-().]+/g, '');

const FIELD_ORDER: readonly RiderFormField[] = [
  'branchId',
  'fullName',
  'phone',
  'vehicleType',
  'licensePlate',
];

export function validateRiderForm(
  values: RiderFormValues,
  mode: 'create' | 'edit',
): RiderFormErrors {
  const errors: RiderFormErrors = {};
  if (mode === 'create' && !values.branchId) errors.branchId = 'branchRequired';
  const name = riderNameProblem(values.fullName);
  if (name === 'length') errors.fullName = 'nameLength';
  else if (name === 'control') errors.fullName = 'nameControl';
  if (!RIDER_PHONE_RE.test(cleanRiderPhone(values.phone))) errors.phone = 'phoneFormat';
  if (values.licensePlate.trim() !== '') {
    if (!RIDER_PLATE_RE.test(normalizeRiderPlate(values.licensePlate))) {
      errors.licensePlate = 'plateFormat';
    }
  }
  return errors;
}

export const hasRiderErrors = (errors: RiderFormErrors): boolean => Object.keys(errors).length > 0;
export const firstRiderErrorField = (errors: RiderFormErrors): RiderFormField | null =>
  FIELD_ORDER.find((f) => errors[f]) ?? null;

export function toCreateRiderRequest(values: RiderFormValues): CreateRiderRequest {
  const plate = normalizeRiderPlate(values.licensePlate);
  return {
    branchId: values.branchId,
    fullName: collapseRiderName(values.fullName),
    phone: cleanRiderPhone(values.phone),
    ...(values.vehicleType ? { vehicleType: values.vehicleType } : {}),
    ...(plate ? { licensePlate: plate } : {}),
  };
}

/**
 * Cambios de la edición (solo campos distintos) con `expectedVersion` del registro que se está editando. `null` si no hay nada
 * que guardar. El traslado NO va aquí (tiene su propio flujo con confirmación).
 */
export function toUpdateRiderRequest(
  values: RiderFormValues,
  rider: AdminRider,
): UpdateRiderRequest | null {
  const patch: Omit<UpdateRiderRequest, 'expectedVersion'> = {};
  const name = collapseRiderName(values.fullName);
  if (name !== rider.fullName) patch.fullName = name;
  const phone = cleanRiderPhone(values.phone);
  if (phone !== rider.phone) patch.phone = phone;
  const vehicle = values.vehicleType === '' ? null : values.vehicleType;
  if (vehicle !== rider.vehicleType) patch.vehicleType = vehicle;
  const plate = values.licensePlate.trim() === '' ? null : normalizeRiderPlate(values.licensePlate);
  if (plate !== rider.licensePlate) patch.licensePlate = plate;
  return Object.keys(patch).length === 0 ? null : { expectedVersion: rider.version, ...patch };
}

export function validateRiderReason(reason: string): string {
  return [...reason.trim()].length > RIDER_REASON_MAX ? 'reasonTooLong' : '';
}

// ── Errores del contrato (por `code`, nunca por `message`) ───────────────────────────────

export type RiderErrorKind =
  | 'phoneTaken'
  | 'versionConflict'
  | 'hasActiveDelivery'
  | 'inactive'
  | 'branchUnavailable'
  | 'actionForbidden'
  | 'mfa'
  | 'forbidden'
  | 'notFound'
  | 'rate'
  | 'busy'
  | 'network'
  | 'invalid'
  | 'unknown';

export interface RiderError {
  kind: RiderErrorKind;
  code: string | null;
  /** `RIDER_VERSION_CONFLICT`: versión vigente (`current`). */
  current: number | null;
  retryAfterSec: number | null;
  /** Campo del formulario al que apunta un 400/409 de teléfono. */
  field: RiderFormField | null;
}

const FIELD_HINTS: readonly RiderFormField[] = [
  'fullName',
  'phone',
  'vehicleType',
  'licensePlate',
  'branchId',
];

export function classifyRiderError(error: unknown): RiderError {
  const base: RiderError = {
    kind: 'unknown',
    code: null,
    current: null,
    retryAfterSec: null,
    field: null,
  };
  if (!isApiError(error)) return base;
  const code = error.businessCode ?? null;
  const body = error.body as { current?: unknown } | undefined;
  const result: RiderError = {
    ...base,
    code,
    retryAfterSec: error.retryAfterSec ?? null,
    current: typeof body?.current === 'number' ? body.current : null,
  };
  const { status } = error;
  if (status === 0 || (status >= 500 && status !== 503)) return { ...result, kind: 'network' };
  if (status === 503) return { ...result, kind: 'busy' };
  if (status === 429) return { ...result, kind: 'rate' };
  if (status === 403) {
    return {
      ...result,
      kind:
        code === 'MFA_REQUIRED'
          ? 'mfa'
          : code === 'RIDER_ACTION_FORBIDDEN'
            ? 'actionForbidden'
            : 'forbidden',
    };
  }
  if (status === 404) return { ...result, kind: 'notFound' };
  if (status === 409) {
    const kind: RiderErrorKind =
      code === 'RIDER_PHONE_TAKEN'
        ? 'phoneTaken'
        : code === 'RIDER_VERSION_CONFLICT'
          ? 'versionConflict'
          : code === 'RIDER_HAS_ACTIVE_DELIVERY'
            ? 'hasActiveDelivery'
            : code === 'RIDER_INACTIVE'
              ? 'inactive'
              : 'unknown';
    return { ...result, kind, field: kind === 'phoneTaken' ? 'phone' : null };
  }
  if (status === 422) {
    return {
      ...result,
      kind: code === 'BRANCH_NOT_AVAILABLE' ? 'branchUnavailable' : 'unknown',
      field: code === 'BRANCH_NOT_AVAILABLE' ? 'branchId' : null,
    };
  }
  if (status === 400) {
    const first = error.details?.[0] ?? '';
    return {
      ...result,
      kind: 'invalid',
      field: FIELD_HINTS.find((f) => first.startsWith(f)) ?? null,
    };
  }
  return result;
}

/** ¿Merece un reintento automático acotado? Solo el 503 `RIDERS_BUSY` (la solicitud ni siquiera se procesó). */
export const isRidersBusy = (error: unknown): boolean =>
  isApiError(error) &&
  error.status === 503 &&
  (error.businessCode ?? 'RIDERS_BUSY') === 'RIDERS_BUSY';

/** Espera (ms) entre reintentos de `RIDERS_BUSY`: respeta `Retry-After`, acotada a 1–3 s. */
export const busyDelayMs = (error: unknown): number => {
  const sec = isApiError(error) ? (error.retryAfterSec ?? 1) : 1;
  return Math.min(3, Math.max(1, sec)) * 1000;
};

export const MAX_BUSY_RETRIES = 2;

/** Clave i18n (`backoffice.riders.*`) del texto de disponibilidad: «Ocupado» solo si el servidor lo SABE (`busyKnown`). */
export function riderStateTextKey(
  r: Pick<AdminRiderSummary, 'availability' | 'operationalState'>,
): 'stateBusy' | 'stateAvailable' | 'stateUnavailable' {
  if (r.operationalState === 'BUSY') return 'stateBusy';
  return r.availability === 'AVAILABLE' ? 'stateAvailable' : 'stateUnavailable';
}

/** Sucursales (de las visibles en el shell) donde se puede ejecutar un permiso; cosmético: la API decide. */
export function branchesWhere<B extends { id: string }>(
  branches: readonly B[],
  allowed: (branchId: string) => boolean,
): B[] {
  return branches.filter((b) => allowed(b.id));
}

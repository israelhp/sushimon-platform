import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminRider } from '@/lib/data-access/models';
import {
  DEFAULT_RIDER_LIST,
  MAX_BUSY_RETRIES,
  busyDelayMs,
  branchesWhere,
  classifyRiderError,
  cleanRiderPhone,
  emptyRiderForm,
  firstRiderErrorField,
  hasRiderErrors,
  hasRiderFilters,
  isRidersBusy,
  riderOccupancy,
  riderPageCount,
  riderStateTextKey,
  riderToForm,
  toCreateRiderRequest,
  toRiderFilters,
  toUpdateRiderRequest,
  validateRiderForm,
  validateRiderReason,
} from './rider-model';

const rider: AdminRider = {
  id: 'rider-1',
  branchId: 'sucursal-1',
  branchName: 'Sucursal 1',
  fullName: 'Juan Carlos Pérez',
  phone: '+50255501001',
  phoneMasked: '+502****1001',
  vehicleType: 'MOTORCYCLE',
  licensePlate: 'M482HJK',
  active: true,
  availability: 'AVAILABLE',
  busy: false,
  busyKnown: false,
  operationalState: 'AVAILABLE',
  version: 4,
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
};

const apiError = (
  status: number,
  code?: string,
  extra: { body?: unknown; retry?: number; details?: string[] } = {},
) =>
  new ApiError(
    status,
    'x',
    'mensaje del servidor',
    undefined,
    extra.details,
    code,
    undefined,
    extra.retry,
    extra.body,
  );

describe('filtros del listado', () => {
  it('estado inicial: sin filtros, orden por nombre, 20 por página', () => {
    expect(toRiderFilters(DEFAULT_RIDER_LIST)).toEqual({
      q: undefined,
      branchId: undefined,
      active: undefined,
      availability: undefined,
      sort: 'fullName',
      order: 'asc',
      page: 1,
      pageSize: 20,
    });
    expect(hasRiderFilters(DEFAULT_RIDER_LIST)).toBe(false);
  });

  it('traduce estado activo/inactivo a `active`, recorta la búsqueda y marca filtros activos', () => {
    const f = toRiderFilters({
      ...DEFAULT_RIDER_LIST,
      q: '  luis ',
      branchId: 'sucursal-2',
      status: 'inactive',
      availability: 'UNAVAILABLE',
      page: 3,
    });
    expect(f).toMatchObject({
      q: 'luis',
      branchId: 'sucursal-2',
      active: false,
      availability: 'UNAVAILABLE',
      page: 3,
    });
    expect(toRiderFilters({ ...DEFAULT_RIDER_LIST, status: 'active' }).active).toBe(true);
    expect(hasRiderFilters({ ...DEFAULT_RIDER_LIST, availability: 'BUSY' })).toBe(true);
  });

  it('páginas: nunca menos de 1', () => {
    expect(riderPageCount(0, 20)).toBe(1);
    expect(riderPageCount(41, 20)).toBe(3);
  });
});

describe('ocupación y texto de estado (sin inventar)', () => {
  it('sin busyKnown la ocupación es «sin dato» aunque busy sea false', () => {
    expect(riderOccupancy({ busy: false, busyKnown: false })).toBe('unknown');
    expect(riderOccupancy({ busy: true, busyKnown: false })).toBe('unknown');
    expect(riderOccupancy({ busy: true, busyKnown: true })).toBe('busy');
    expect(riderOccupancy({ busy: false, busyKnown: true })).toBe('free');
  });

  it('«Ocupado» solo si el servidor lo deriva como BUSY', () => {
    expect(riderStateTextKey({ availability: 'AVAILABLE', operationalState: 'BUSY' })).toBe(
      'stateBusy',
    );
    expect(riderStateTextKey({ availability: 'AVAILABLE', operationalState: 'AVAILABLE' })).toBe(
      'stateAvailable',
    );
    expect(riderStateTextKey({ availability: 'UNAVAILABLE', operationalState: 'INACTIVE' })).toBe(
      'stateUnavailable',
    );
  });
});

describe('formulario', () => {
  const valid = { ...emptyRiderForm('sucursal-1'), fullName: 'Ana Ruiz', phone: '+502 5550-1234' };

  it('limpia separadores del teléfono pero conserva el formato estricto', () => {
    expect(cleanRiderPhone('+502 5550-1234')).toBe('+50255501234');
    expect(cleanRiderPhone('(+502) 5550 1234')).toBe('+50255501234');
  });

  it('alta válida: sin errores; opcionales ausentes no viajan', () => {
    expect(validateRiderForm(valid, 'create')).toEqual({});
    expect(toCreateRiderRequest(valid)).toEqual({
      branchId: 'sucursal-1',
      fullName: 'Ana Ruiz',
      phone: '+50255501234',
    });
  });

  it('alta con vehículo y placa normalizada', () => {
    expect(
      toCreateRiderRequest({ ...valid, vehicleType: 'CAR', licensePlate: ' p-551 bcd ' }),
    ).toEqual({
      branchId: 'sucursal-1',
      fullName: 'Ana Ruiz',
      phone: '+50255501234',
      vehicleType: 'CAR',
      licensePlate: 'P551BCD',
    });
  });

  it('errores por campo (claves i18n) y primer campo con error', () => {
    const errors = validateRiderForm(
      { branchId: '', fullName: 'A', phone: '5550', vehicleType: '', licensePlate: 'AB' },
      'create',
    );
    expect(errors).toEqual({
      branchId: 'branchRequired',
      fullName: 'nameLength',
      phone: 'phoneFormat',
      licensePlate: 'plateFormat',
    });
    expect(hasRiderErrors(errors)).toBe(true);
    expect(firstRiderErrorField(errors)).toBe('branchId');
    // En edición la sucursal no se valida (el traslado tiene su propio flujo).
    expect(validateRiderForm({ ...valid, branchId: '' }, 'edit')).toEqual({});
  });

  it('edición: solo los campos cambiados, con expectedVersion de la línea base; sin cambios => null', () => {
    expect(toUpdateRiderRequest(riderToForm(rider), rider)).toBeNull();
    expect(
      toUpdateRiderRequest({ ...riderToForm(rider), fullName: '  Juan   Pérez ' }, rider),
    ).toEqual({ expectedVersion: 4, fullName: 'Juan Pérez' });
    expect(
      toUpdateRiderRequest(
        { ...riderToForm(rider), phone: '+502 5550 9999', licensePlate: 'abc 123' },
        rider,
      ),
    ).toEqual({ expectedVersion: 4, phone: '+50255509999', licensePlate: 'ABC123' });
  });

  it('edición: vaciar vehículo/placa envía null (solo si había valor)', () => {
    expect(
      toUpdateRiderRequest({ ...riderToForm(rider), vehicleType: '', licensePlate: '' }, rider),
    ).toEqual({ expectedVersion: 4, vehicleType: null, licensePlate: null });
    const bare: AdminRider = { ...rider, vehicleType: null, licensePlate: null };
    expect(toUpdateRiderRequest(riderToForm(bare), bare)).toBeNull();
  });

  it('motivo: máximo 200', () => {
    expect(validateRiderReason('x'.repeat(200))).toBe('');
    expect(validateRiderReason('x'.repeat(201))).toBe('reasonTooLong');
  });

  it('sucursales donde se puede actuar', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(branchesWhere(list, (id) => id !== 'b').map((b) => b.id)).toEqual(['a', 'c']);
  });
});

describe('errores del contrato (por code, nunca por message)', () => {
  const kind = (e: unknown) => classifyRiderError(e).kind;

  it('clasifica los 409, 422, 403 y 404 por code', () => {
    expect(kind(apiError(409, 'RIDER_PHONE_TAKEN'))).toBe('phoneTaken');
    expect(classifyRiderError(apiError(409, 'RIDER_PHONE_TAKEN')).field).toBe('phone');
    expect(kind(apiError(409, 'RIDER_HAS_ACTIVE_DELIVERY'))).toBe('hasActiveDelivery');
    expect(kind(apiError(409, 'RIDER_INACTIVE'))).toBe('inactive');
    expect(kind(apiError(422, 'BRANCH_NOT_AVAILABLE'))).toBe('branchUnavailable');
    expect(kind(apiError(403, 'RIDER_ACTION_FORBIDDEN'))).toBe('actionForbidden');
    expect(kind(apiError(403, 'MFA_REQUIRED'))).toBe('mfa');
    expect(kind(apiError(403))).toBe('forbidden');
    expect(kind(apiError(404, 'RIDER_NOT_FOUND'))).toBe('notFound');
    expect(kind(apiError(429, 'RATE_LIMITED'))).toBe('rate');
    expect(kind(apiError(0))).toBe('network');
    expect(kind(new Error('x'))).toBe('unknown');
  });

  it('el mensaje del servidor no decide: mismo status con otro code => unknown', () => {
    expect(kind(apiError(409, 'OTRA_COSA'))).toBe('unknown');
  });

  it('RIDER_VERSION_CONFLICT trae la versión vigente (`current`)', () => {
    const c = classifyRiderError(apiError(409, 'RIDER_VERSION_CONFLICT', { body: { current: 7 } }));
    expect(c).toMatchObject({ kind: 'versionConflict', current: 7 });
  });

  it('400 apunta al campo si el detalle lo nombra', () => {
    const c = classifyRiderError(
      apiError(400, undefined, { details: ['phone debe ser +502 seguido de 8 dígitos'] }),
    );
    expect(c).toMatchObject({ kind: 'invalid', field: 'phone' });
  });

  it('503 RIDERS_BUSY es reintentable de forma acotada y respeta Retry-After (1 a 3 s)', () => {
    const busy = apiError(503, 'RIDERS_BUSY', { retry: 2 });
    expect(kind(busy)).toBe('busy');
    expect(isRidersBusy(busy)).toBe(true);
    expect(isRidersBusy(apiError(429, 'RATE_LIMITED'))).toBe(false);
    expect(busyDelayMs(busy)).toBe(2000);
    expect(busyDelayMs(apiError(503, 'RIDERS_BUSY', { retry: 90 }))).toBe(3000);
    expect(busyDelayMs(apiError(503, 'RIDERS_BUSY'))).toBe(1000);
    expect(MAX_BUSY_RETRIES).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminPromotion } from '@/lib/data-access/models';
import {
  EMPTY_FILTERS,
  MESSAGES,
  buildSchedule,
  discountLabel,
  emptyPromotionForm,
  filterDatesInvalid,
  filtersToQuery,
  hasActiveFilters,
  newSlotRow,
  promotionServerError,
  promotionToForm,
  toCreateRequest,
  toUpdateRequest,
  validatePromotionForm,
  type PromotionFormValues,
} from './promotions-view';

const base = (over: Partial<PromotionFormValues> = {}): PromotionFormValues => ({
  ...emptyPromotionForm('2026-11-11', true),
  name: 'Jueves de sashimi',
  ...over,
});
const errorsOf = (v: PromotionFormValues) => validatePromotionForm(v).map((e) => e.field);

const current: AdminPromotion = {
  id: 'p1',
  code: null,
  name: 'Happy Hour',
  description: 'Texto',
  kind: 'PERCENT',
  value: '25.00',
  startsAt: '2026-10-01T06:00:00.000Z',
  endsAt: '2027-01-01T06:00:00.000Z',
  dineInOnly: true,
  active: true,
  lifecycle: 'RUNNING',
  liveNow: false,
  branchScope: 'SELECTED',
  branches: [{ id: 'sucursal-1', name: 'Sucursal 1' }],
  productScope: 'SELECTED',
  productCount: 1,
  scheduleCount: 2,
  editable: true,
  version: 4,
  createdAt: '2026-09-20T18:00:00.000Z',
  updatedAt: '2026-09-20T18:00:00.000Z',
  products: [{ id: 'dumplings', name: 'Dumplings', slug: 'dumplings' }],
  schedule: [
    { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
    { weekday: 2, startsAt: '15:00', endsAt: '18:00' },
  ],
};

describe('filtros del listado', () => {
  it('sin filtros activos y con ellos', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: ' x ' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, kind: 'PERCENT' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(false);
  });

  it('arma la consulta: omite «todos», recorta la búsqueda y convierte días locales en instantes [from, to)', () => {
    expect(filtersToQuery(EMPTY_FILTERS, 1, 12)).toEqual({
      q: undefined,
      branchId: undefined,
      status: undefined,
      kind: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      pageSize: 12,
    });
    const q = filtersToQuery(
      {
        q: ' bienvenida ',
        branchId: 'sucursal-1',
        status: 'running',
        kind: 'PERCENT',
        from: '2026-11-01',
        to: '2026-11-30',
      },
      2,
      12,
    );
    expect(q).toMatchObject({
      q: 'bienvenida',
      branchId: 'sucursal-1',
      status: 'running',
      kind: 'PERCENT',
      page: 2,
    });
    // 00:00 de Guatemala = 06:00Z; `to` es el día SIGUIENTE (inclusivo para quien filtra).
    expect(q.from).toBe('2026-11-01T06:00:00.000Z');
    expect(q.to).toBe('2026-12-01T06:00:00.000Z');
  });

  it('un rango invertido se detecta y no genera fechas para la API', () => {
    const f = { ...EMPTY_FILTERS, from: '2026-12-01', to: '2026-11-01' };
    expect(filterDatesInvalid(f)).toBe(true);
    expect(filtersToQuery(f, 1, 12)).toMatchObject({ from: undefined, to: undefined });
    expect(filterDatesInvalid({ ...EMPTY_FILTERS, from: '2026-11-01', to: '2026-11-01' })).toBe(
      false,
    );
  });
});

describe('presentación', () => {
  it('etiqueta el descuento con la cadena del contrato, sin aritmética', () => {
    expect(discountLabel({ kind: 'PERCENT', value: '20.00' })).toBe('-20%');
    expect(discountLabel({ kind: 'PERCENT', value: '12.50' })).toBe('-12.5%');
    expect(discountLabel({ kind: 'FIXED_AMOUNT', value: '20.00' })).toBe('Q20.00');
  });
});

describe('formulario: valores iniciales y validación', () => {
  it('nueva promoción: automática, 15 %, 30 días, sin horario; `ALL` solo con alcance global', () => {
    expect(emptyPromotionForm('2026-11-11', true)).toMatchObject({
      code: '',
      kind: 'PERCENT',
      value: '15',
      startsAt: '2026-11-11T00:00',
      endsAt: '2026-12-11T00:00',
      branchScope: 'ALL',
      productScope: 'ALL',
      slots: [],
    });
    expect(emptyPromotionForm('2026-11-11', false).branchScope).toBe('SELECTED');
    expect(emptyPromotionForm('', true).startsAt).toBe('');
  });

  it('una promoción válida no tiene errores', () => {
    expect(validatePromotionForm(base())).toEqual([]);
  });

  it('nombre, descripción y código', () => {
    expect(errorsOf(base({ name: '  ' }))).toEqual(['name']);
    expect(errorsOf(base({ name: 'x'.repeat(121) }))).toEqual(['name']);
    expect(errorsOf(base({ description: 'x'.repeat(501) }))).toEqual(['description']);
    expect(errorsOf(base({ code: 'ab' }))).toEqual(['code']);
    expect(errorsOf(base({ code: 'con espacio' }))).toEqual(['code']);
    expect(errorsOf(base({ code: ' bienvenido10 ' }))).toEqual([]);
  });

  it('valor: obligatorio > 0; PERCENT ≤ 100; FIXED hasta 999999.99; hasta 2 decimales', () => {
    const msg = (v: Partial<PromotionFormValues>) => validatePromotionForm(base(v))[0]?.message;
    expect(msg({ value: '' })).toBe(MESSAGES.valueRequired);
    expect(msg({ value: '0' })).toBe(MESSAGES.valueRequired);
    expect(msg({ value: '1.234' })).toBe(MESSAGES.valueRequired);
    expect(msg({ value: '100.01' })).toBe(MESSAGES.percentMax);
    expect(msg({ value: '100' })).toBeUndefined();
    expect(msg({ kind: 'FIXED_AMOUNT', value: '20,50' })).toBeUndefined();
    expect(msg({ kind: 'FIXED_AMOUNT', value: '1000000' })).toBe(MESSAGES.valueRequired);
  });

  it('vigencia: ambas fechas y fin posterior al inicio', () => {
    expect(errorsOf(base({ startsAt: '' }))).toEqual(['startsAt']);
    expect(errorsOf(base({ endsAt: '' }))).toEqual(['endsAt']);
    expect(errorsOf(base({ endsAt: '2026-11-11T00:00' }))).toEqual(['endsAt']);
    expect(errorsOf(base({ endsAt: '2026-11-10T00:00' }))).toEqual(['endsAt']);
  });

  it('alcance: SELECTED exige al menos una sucursal y un producto', () => {
    expect(errorsOf(base({ branchScope: 'SELECTED' }))).toEqual(['branches']);
    expect(errorsOf(base({ branchScope: 'SELECTED', branchIds: ['sucursal-1'] }))).toEqual([]);
    expect(errorsOf(base({ productScope: 'SELECTED' }))).toEqual(['products']);
    expect(
      errorsOf(base({ productScope: 'SELECTED', products: [{ id: 'dumplings', name: 'D' }] })),
    ).toEqual([]);
    expect(
      errorsOf(
        base({
          branchScope: 'SELECTED',
          branchIds: Array.from({ length: 21 }, (_, i) => `b${i}`),
        }),
      ),
    ).toEqual(['branches']);
  });

  it('horario: horas completas, fin posterior, sin cruzar sin marcarlo, sin solapes', () => {
    const row = (over: object) => ({ ...newSlotRow(1), ...over });
    expect(validatePromotionForm(base({ slots: [row({ start: '' })] }))[0]?.message).toBe(
      MESSAGES.slotTime,
    );
    expect(
      validatePromotionForm(base({ slots: [row({ start: '18:00', end: '15:00' })] }))[0]?.message,
    ).toBe(MESSAGES.slotOrder);
    expect(
      validatePromotionForm(base({ slots: [row({ start: '10:00', end: '10:00' })] }))[0]?.message,
    ).toBe(MESSAGES.slotOrder);
    // Cruzar la medianoche es válido si se marca y el fin es anterior al inicio.
    expect(
      validatePromotionForm(
        base({ slots: [row({ start: '22:00', end: '02:00', overnight: true })] }),
      ),
    ).toEqual([]);
    expect(
      validatePromotionForm(
        base({ slots: [row({ start: '10:00', end: '12:00', overnight: true })] }),
      )[0]?.message,
    ).toBe(MESSAGES.slotOvernight);
    // Solape el mismo día; contiguos válidos; mismo rango en días distintos válido.
    expect(
      validatePromotionForm(base({ slots: [row({}), row({ start: '17:00', end: '19:00' })] }))[0]
        ?.message,
    ).toBe(MESSAGES.slotOverlap);
    expect(
      validatePromotionForm(base({ slots: [row({}), row({ start: '18:00', end: '19:00' })] })),
    ).toEqual([]);
    expect(validatePromotionForm(base({ slots: [row({}), row({ weekday: 2 })] }))).toEqual([]);
    // Un cruce que choca con el tramo del día siguiente se detecta tras partirlo.
    expect(
      validatePromotionForm(
        base({
          slots: [
            row({ weekday: 5, start: '22:00', end: '02:00', overnight: true }),
            row({ weekday: 6, start: '01:00', end: '03:00' }),
          ],
        }),
      )[0]?.message,
    ).toBe(MESSAGES.slotOverlap);
  });

  it('más de 6 franjas en un día es un error de límite', () => {
    const slots = Array.from({ length: 7 }, (_, i) => ({
      ...newSlotRow(1),
      start: `0${i}:00`,
      end: `0${i}:30`,
    }));
    expect(validatePromotionForm(base({ slots }))[0]?.message).toBe(MESSAGES.slotLimit);
  });
});

describe('horario: filas → tramos del contrato', () => {
  it('fin 00:00 = hasta la medianoche (24:00); cruzar parte en dos días; orden canónico', () => {
    const rows = [
      { ...newSlotRow(6), start: '20:00', end: '00:00' },
      { ...newSlotRow(5), start: '22:00', end: '02:00', overnight: true },
      { ...newSlotRow(1), start: '15:00', end: '18:00' },
    ];
    expect(buildSchedule(rows)).toEqual([
      { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
      { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
      { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
      { weekday: 6, startsAt: '20:00', endsAt: '24:00' },
    ]);
  });

  it('un tramo que ya viene del servidor vuelve a una fila sin «cruza» (24:00 se muestra 00:00)', () => {
    const form = promotionToForm({
      ...current,
      schedule: [{ weekday: 5, startsAt: '22:00', endsAt: '24:00' }],
    });
    expect(form.slots[0]).toMatchObject({
      weekday: 5,
      start: '22:00',
      end: '00:00',
      overnight: false,
    });
    expect(buildSchedule(form.slots)).toEqual([{ weekday: 5, startsAt: '22:00', endsAt: '24:00' }]);
  });
});

describe('peticiones al contrato', () => {
  it('alta: instantes con zona, importes como cadena, sin `code` si es automática y sin ids con ALL', () => {
    const body = toCreateRequest(
      base({
        value: '15,5',
        description: ' ',
        startsAt: '2026-11-11T00:00',
        endsAt: '2026-12-11T00:00',
      }),
    );
    expect(body).toEqual({
      name: 'Jueves de sashimi',
      kind: 'PERCENT',
      value: '15.50',
      startsAt: '2026-11-11T06:00:00.000Z',
      endsAt: '2026-12-11T06:00:00.000Z',
      dineInOnly: false,
      branchScope: 'ALL',
      productScope: 'ALL',
    });
  });

  it('alta de cupón con alcance y horario', () => {
    const body = toCreateRequest(
      base({
        code: ' nuevo-10 ',
        branchScope: 'SELECTED',
        branchIds: ['sucursal-1'],
        productScope: 'SELECTED',
        products: [{ id: 'dumplings', name: 'Dumplings' }],
        slots: [{ ...newSlotRow(4), start: '18:00', end: '22:00' }],
      }),
    );
    expect(body).toMatchObject({
      code: 'NUEVO-10',
      branchIds: ['sucursal-1'],
      productIds: ['dumplings'],
      schedule: [{ weekday: 4, startsAt: '18:00', endsAt: '22:00' }],
    });
  });

  it('edición: solo lo que cambió + `expectedVersion`; sin cambios devuelve null', () => {
    expect(toUpdateRequest(promotionToForm(current), current)).toBeNull();
    const form = { ...promotionToForm(current), name: 'Nuevo', value: '30' };
    expect(toUpdateRequest(form, current)).toEqual({
      expectedVersion: 4,
      name: 'Nuevo',
      value: '30.00',
    });
  });

  it('edición: alcance, horario y código se envían solo si cambian', () => {
    const form = promotionToForm(current);
    expect(toUpdateRequest({ ...form, branchScope: 'ALL', branchIds: [] }, current)).toEqual({
      expectedVersion: 4,
      branchScope: 'ALL',
    });
    expect(toUpdateRequest({ ...form, branchIds: ['sucursal-1', 'sucursal-2'] }, current)).toEqual({
      expectedVersion: 4,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-1', 'sucursal-2'],
    });
    expect(toUpdateRequest({ ...form, slots: [] }, current)).toEqual({
      expectedVersion: 4,
      schedule: [],
    });
    expect(toUpdateRequest({ ...form, code: 'cupon-1' }, current)).toEqual({
      expectedVersion: 4,
      code: 'CUPON-1',
    });
    expect(toUpdateRequest({ ...form, description: '' }, current)).toEqual({
      expectedVersion: 4,
      description: null,
    });
    expect(toUpdateRequest({ ...form, productScope: 'ALL', products: [] }, current)).toEqual({
      expectedVersion: 4,
      productScope: 'ALL',
    });
  });
});

describe('errores del servidor por `code`', () => {
  const api = (status: number, code?: string) =>
    new ApiError(status, 'x', 'mensaje del servidor', undefined, undefined, code);

  it('ramifica por businessCode y asigna campo', () => {
    expect(promotionServerError(api(409, 'PROMOTION_CODE_TAKEN'))).toMatchObject({
      kind: 'codeTaken',
      field: 'code',
      reload: false,
    });
    expect(promotionServerError(api(409, 'PROMOTION_VERSION_CONFLICT'))).toMatchObject({
      kind: 'versionConflict',
      reload: true,
    });
    expect(promotionServerError(api(422, 'PROMOTION_VALUE_INVALID'))).toMatchObject({
      field: 'value',
    });
    expect(promotionServerError(api(422, 'PROMOTION_PERIOD_INVALID'))).toMatchObject({
      field: 'endsAt',
    });
    expect(promotionServerError(api(422, 'PROMOTION_SCHEDULE_INVALID'))).toMatchObject({
      field: 'schedule',
    });
    expect(promotionServerError(api(422, 'PROMOTION_SCOPE_INVALID'))).toMatchObject({
      field: 'products',
    });
    expect(promotionServerError(api(403, 'PROMOTION_SCOPE_FORBIDDEN'))).toMatchObject({
      kind: 'scopeForbidden',
    });
    expect(promotionServerError(api(404, 'PROMOTION_NOT_FOUND'))).toMatchObject({
      kind: 'notFound',
      reload: true,
    });
    expect(promotionServerError(api(404, 'BRANCH_NOT_FOUND'))).toMatchObject({
      kind: 'branchNotFound',
      field: 'branches',
      reload: true,
    });
    expect(promotionServerError(api(503, 'PROMOTIONS_BUSY'))).toMatchObject({ kind: 'busy' });
  });

  it('sin código de negocio: por estado HTTP; nunca por el texto', () => {
    expect(promotionServerError(api(400))).toMatchObject({ kind: 'invalid' });
    expect(promotionServerError(api(401))).toMatchObject({ kind: 'unauthorized' });
    expect(promotionServerError(api(403))).toMatchObject({ kind: 'forbidden' });
    expect(promotionServerError(api(409, undefined)).kind).toBe('other');
    expect(promotionServerError(new Error('boom')).kind).toBe('other');
  });
});

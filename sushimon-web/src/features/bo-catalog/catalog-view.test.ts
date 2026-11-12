import { describe, expect, it } from 'vitest';
import type { Category } from '@/lib/data-access/models';
import {
  availabilityPatch,
  availabilityState,
  discountLabel,
  emptyPromotionForm,
  filterProducts,
  formatRange,
  isRunning,
  moveId,
  orderChanges,
  parsePrice,
  promotionInput,
  sortCategories,
  validateProductForm,
  validatePromotionForm,
  type ProductFormValues,
} from './catalog-view';

const avail = (...flags: [string, boolean][]) => ({
  availability: flags.map(([branchId, available]) => ({ branchId, available })),
});

describe('disponibilidad por sucursal', () => {
  it('distingue disponible, agotado y parcial en el alcance', () => {
    const p = avail(['a', true], ['b', false], ['c', true]);
    expect(availabilityState(p, ['a'])).toEqual({ kind: 'on', on: 1, total: 1 });
    expect(availabilityState(p, ['b'])).toEqual({ kind: 'off', on: 0, total: 1 });
    expect(availabilityState(p, ['a', 'b', 'c'])).toEqual({ kind: 'partial', on: 2, total: 3 });
    expect(availabilityState(p, ['a', 'c']).kind).toBe('on');
  });

  it('un alcance vacío no cuenta como disponible', () => {
    expect(availabilityState(avail(['a', true]), []).kind).toBe('off');
  });

  it('el parche solo toca las sucursales del alcance', () => {
    expect(availabilityPatch(['a', 'c'], false)).toEqual([
      { branchId: 'a', available: false },
      { branchId: 'c', available: false },
    ]);
  });
});

describe('búsqueda y filtros', () => {
  const items = [
    { name: 'Dumplings', nameEn: 'Dumplings', categoryId: 'entradas' },
    { name: 'Té Lipton', nameEn: 'Lipton tea', categoryId: 'relax' },
    { name: 'California Roll', categoryId: 'rolls' },
  ];
  it('ignora mayúsculas y acentos, y filtra por categoría', () => {
    expect(filterProducts(items, { query: 'te lipton', categoryId: 'all' })).toHaveLength(1);
    expect(filterProducts(items, { query: 'TEA', categoryId: 'all' })).toHaveLength(1);
    expect(filterProducts(items, { query: '', categoryId: 'rolls' })).toHaveLength(1);
    expect(filterProducts(items, { query: 'roll', categoryId: 'relax' })).toHaveLength(0);
  });
});

describe('orden de categorías', () => {
  const cat = (id: string, sortOrder: number): Category => ({
    id,
    name: id,
    sortOrder,
    visible: true,
    kind: 'products',
  });
  const cats = [cat('c', 3), cat('a', 1), cat('b', 2)];

  it('ordena por sortOrder', () => {
    expect(sortCategories(cats).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  it('mueve una posición y respeta los extremos', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toBeNull();
  });
  it('solo envía los sortOrder que cambian', () => {
    expect(orderChanges(sortCategories(cats), ['b', 'a', 'c'])).toEqual([
      { id: 'b', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
    ]);
  });
});

describe('formulario de producto', () => {
  const valid: ProductFormValues = {
    name: 'Roll Mon',
    nameEn: '',
    description: '',
    descriptionEn: '',
    categoryId: 'rolls',
    price: '45',
    featured: false,
    availability: {},
  };
  it('acepta un producto válido', () => {
    expect(validateProductForm(valid)).toEqual([]);
  });
  it('reporta nombre, categoría y precio en el orden de los campos', () => {
    expect(validateProductForm({ ...valid, name: ' ', categoryId: '', price: '0' })).toEqual([
      { field: 'name', code: 'nameRequired' },
      { field: 'categoryId', code: 'categoryRequired' },
      { field: 'price', code: 'priceInvalid' },
    ]);
  });
  it('valida el precio: positivo, finito, con coma decimal y tope', () => {
    expect(parsePrice('12,5')).toBe(12.5);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('-3')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('100000')).toBeNull();
  });
});

describe('formulario de promoción', () => {
  const base = emptyPromotionForm('2026-11-11', '2026-12-11');
  const named = { ...base, name: 'Jueves de sashimi' };

  it('trae los valores iniciales del prototipo', () => {
    expect(base).toMatchObject({ kind: 'percent', value: '15', days: [5, 6], start: '12:00' });
  });
  it('acepta una promoción válida y arma el cuerpo del contrato', () => {
    expect(validatePromotionForm(named)).toEqual([]);
    expect(promotionInput({ ...named, days: [6, 5] })).toMatchObject({
      name: 'Jueves de sashimi',
      kind: 'percent',
      value: 15,
      daysOfWeek: [5, 6],
      validFrom: '2026-11-11',
      validTo: '2026-12-11',
      active: true,
    });
  });
  it('exige nombre, valor, al menos un día, horas y fechas coherentes', () => {
    expect(validatePromotionForm(base)[0]).toEqual({ field: 'name', code: 'nameRequired' });
    expect(validatePromotionForm({ ...named, value: '0' })[0]).toEqual({
      field: 'value',
      code: 'valueRequired',
    });
    expect(validatePromotionForm({ ...named, value: '120' })[0]?.code).toBe('percentMax');
    expect(validatePromotionForm({ ...named, days: [] })[0]?.code).toBe('daysRequired');
    expect(validatePromotionForm({ ...named, start: '18:00', end: '15:00' })[0]).toEqual({
      field: 'end',
      code: 'timeOrder',
    });
    expect(validatePromotionForm({ ...named, from: '2026-12-01', to: '2026-11-01' })[0]).toEqual({
      field: 'to',
      code: 'dateOrder',
    });
  });
  it('el 2x1 no necesita valor', () => {
    expect(validatePromotionForm({ ...named, kind: '2x1', value: '' })).toEqual([]);
    expect(promotionInput({ ...named, kind: '2x1' }).value).toBe(0);
  });
});

describe('presentación de promociones', () => {
  it('etiqueta el descuento y el rango de vigencia', () => {
    expect(discountLabel({ kind: '2x1', value: 0 })).toBe('2x1');
    expect(discountLabel({ kind: 'percent', value: 20 })).toBe('-20%');
    expect(discountLabel({ kind: 'fixed_price', value: 199 })).toBe('Q199');
    const months = 'ene,feb,mar,abr,may,jun,jul,ago,sep,oct,nov,dic'.split(',');
    expect(formatRange('2026-10-01', '2026-12-31', months)).toBe('1 oct – 31 dic 2026');
  });
  it('una promoción vencida o inactiva no cuenta como activa', () => {
    expect(isRunning({ active: true, status: 'current' })).toBe(true);
    expect(isRunning({ active: true, status: 'expired' })).toBe(false);
    expect(isRunning({ active: false, status: 'inactive' })).toBe(false);
  });
});

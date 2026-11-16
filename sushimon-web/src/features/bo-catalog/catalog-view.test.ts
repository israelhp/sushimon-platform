import { describe, expect, it } from 'vitest';
import {
  categoryLook,
  discountLabel,
  emptyPromotionForm,
  formatRange,
  isRunning,
  promotionInput,
  validatePromotionForm,
} from './catalog-view';

describe('arte por categoría', () => {
  it('usa el primer slug conocido de la cadena (categoría y ancestros) y roll por defecto', () => {
    expect(categoryLook(['rolls-frios', 'rolls']).art).toBe('roll');
    expect(categoryLook(['subcat', 'postres']).art).toBe('dessert');
    expect(categoryLook(['desconocida']).art).toBe('roll');
    expect(categoryLook([]).tile).toBe('tile-beige');
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

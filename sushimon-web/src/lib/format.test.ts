import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  toIntlLocale,
} from './format';

describe('formatMoney', () => {
  it('usa dos decimales por defecto (xe)', () => {
    expect(formatMoney(1234.5)).toBe('Q1,234.50');
    expect(formatMoney(85, 'en')).toBe('Q85.00');
    expect(formatMoney(0)).toBe('Q0.00');
  });
  it('decimales automáticos 0–2 (kt)', () => {
    expect(formatMoney(85, 'es', { decimals: 'auto' })).toBe('Q85');
    expect(formatMoney(85.5, 'es', { decimals: 'auto' })).toBe('Q85.5');
    expect(formatMoney(12.345, 'es', { decimals: 'auto' })).toBe('Q12.35');
  });
  it('es y en producen el mismo formato (como el prototipo)', () => {
    expect(formatMoney(15999.9, 'es')).toBe(formatMoney(15999.9, 'en'));
  });
  it('negativos con signo antes de la Q', () => {
    expect(formatMoney(-15)).toBe('-Q15.00');
  });
});

describe('fechas y horas', () => {
  // 2026-11-11 18:05 UTC = 12:05 en Guatemala (UTC-6)
  const d = new Date(Date.UTC(2026, 10, 11, 18, 5));

  it('mapea idiomas a locales Intl', () => {
    expect(toIntlLocale('es')).toBe('es-GT');
    expect(toIntlLocale('en')).toBe('en-US');
    expect(toIntlLocale('fr')).toBe('es-GT');
  });
  it('formatDate en zona de Guatemala y sin puntos de abreviatura', () => {
    expect(formatDate(d, 'en')).toBe('Nov 11, 2026');
    expect(formatDate(d, 'es')).toMatch(/^11 nov 2026$/);
    expect(formatDate(Date.UTC(2026, 10, 12, 3, 0), 'en')).toBe('Nov 11, 2026');
  });
  it('formatTime y formatDateTime', () => {
    expect(formatTime(d, 'en')).toMatch(/^12:05\sPM$/);
    expect(formatTime(d, 'es')).toMatch(/^12:05\sp\.\sm\.$/);
    expect(formatDateTime(d.toISOString(), 'en')).toMatch(/^Nov 11, 2026, 12:05\sPM$/);
  });
  it('formatClock replica el formato fijo del prototipo', () => {
    expect(formatClock('13:30', 'es')).toBe('1:30 p. m.');
    expect(formatClock('13:30', 'en')).toBe('1:30 p.m.');
    expect(formatClock('00:05', 'es')).toBe('12:05 a. m.');
    expect(formatClock('12:00', 'en')).toBe('12:00 p.m.');
  });
});

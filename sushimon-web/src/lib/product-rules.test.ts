import { describe, expect, it } from 'vitest';
import {
  centsToPrice,
  isValidMediaUrl,
  isValidSku,
  normalizeSku,
  parsePriceInput,
  priceToCents,
  priceToNumber,
  safeMediaUrl,
} from './product-rules';

describe('precio como cadena decimal', () => {
  it('priceToCents acepta solo la forma del contrato y el rango', () => {
    expect(priceToCents('85.00')).toBe(8500);
    expect(priceToCents('0.01')).toBe(1);
    expect(priceToCents('999999.99')).toBe(99_999_999);
    for (const bad of ['85', '85.5', '0.00', '1000000.00', '-1.00', '85,00', ' 85.00', 'abc', '']) {
      expect(priceToCents(bad), bad).toBeNull();
    }
  });
  it('parsePriceInput normaliza el texto del formulario (coma o punto, 0–2 decimales)', () => {
    expect(parsePriceInput('85')).toBe('85.00');
    expect(parsePriceInput('85.5')).toBe('85.50');
    expect(parsePriceInput('85,5')).toBe('85.50');
    expect(parsePriceInput(' 0,05 ')).toBe('0.05');
    expect(parsePriceInput('999999.99')).toBe('999999.99');
    for (const bad of ['', '0', '0.00', '1000000', '85.555', '-3', '1e3', 'Q85']) {
      expect(parsePriceInput(bad), bad).toBeNull();
    }
  });
  it('sin coma flotante: 0.10 + 0.20 en céntimos y ida y vuelta', () => {
    expect(centsToPrice(30)).toBe('0.30');
    expect(centsToPrice(priceToCents('19.99') as number)).toBe('19.99');
    expect(priceToNumber('85.00')).toBe(85);
    expect(priceToNumber('malo')).toBeNaN();
  });
});

describe('imágenes', () => {
  it('solo https absoluta ≤ 2048, sin espacios ni controles', () => {
    expect(isValidMediaUrl('https://cdn.ejemplo.com/a.jpg')).toBe(true);
    for (const bad of [
      'http://x.com/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//x.com/a.jpg',
      '/a.jpg',
      'https://',
      'https://x .com/a',
      'https://user:pw@cdn.ejemplo.com/a.jpg',
      'https://localhost/a.jpg',
      'https://intranet/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://192.168.1.5/a.jpg',
      'https://[::1]/a.jpg',
      'https://app.localhost/a.jpg',
      '',
      `https://x.com/${'a'.repeat(2048)}`,
    ]) {
      expect(isValidMediaUrl(bad), bad).toBe(false);
    }
  });
  it('safeMediaUrl nunca devuelve otro esquema', () => {
    expect(safeMediaUrl('https://a.test/x.png')).toBe('https://a.test/x.png');
    expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
    expect(safeMediaUrl(null)).toBeNull();
  });
});

describe('SKU', () => {
  it('forma y normalización a mayúsculas', () => {
    expect(isValidSku('rm-1.a_b')).toBe(true);
    expect(isValidSku('-x')).toBe(false);
    expect(isValidSku('a'.repeat(41))).toBe(false);
    expect(isValidSku('a b')).toBe(false);
    expect(normalizeSku(' rm-1 ')).toBe('RM-1');
    expect(normalizeSku('  ')).toBeNull();
  });
});

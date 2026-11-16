import { describe, expect, it } from 'vitest';
import { ISO_DAYS, PROMO_TONES, categoryLook } from './catalog-view';

describe('arte por categoría', () => {
  it('usa el primer slug conocido de la cadena (categoría y ancestros) y roll por defecto', () => {
    expect(categoryLook(['rolls-frios', 'rolls']).art).toBe('roll');
    expect(categoryLook(['subcat', 'postres']).art).toBe('dessert');
    expect(categoryLook(['desconocida']).art).toBe('roll');
    expect(categoryLook([]).tile).toBe('tile-beige');
  });
});

describe('constantes de promociones', () => {
  it('días ISO de lunes (1) a domingo (7) y tres tonos de franja', () => {
    expect(ISO_DAYS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PROMO_TONES).toHaveLength(3);
  });
});

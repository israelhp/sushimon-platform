import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as admin from '@/services/backoffice-admin';
import { createHarness } from '../testing';

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
  return 200;
}

const product = { name: 'Roll X', description: 'ok', price: 70, categoryId: 'rolls' };

describe('validación de handlers de escritura del backoffice', () => {
  it('producto: precio finito, > 0 y con tope', async () => {
    const h = createHarness();
    h.asStaff('admin');
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 100_001]) {
      expect(await status(admin.createProduct(h.client, { ...product, price }))).toBe(400);
      expect(await status(admin.updateProduct(h.client, 'dumplings', { price }))).toBe(400);
    }
    expect(await status(admin.createProduct(h.client, { ...product, price: 100_000 }))).toBe(200);
    expect(await status(admin.updateProduct(h.client, 'dumplings', { price: '12' as never }))).toBe(
      200,
    );
  });

  it('producto: longitud máxima de nombre (120) y descripción (600)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(await status(admin.createProduct(h.client, { ...product, name: 'a'.repeat(121) }))).toBe(
      400,
    );
    expect(await status(admin.createProduct(h.client, { ...product, name: 'a'.repeat(120) }))).toBe(
      200,
    );
    expect(
      await status(admin.createProduct(h.client, { ...product, description: 'd'.repeat(601) })),
    ).toBe(400);
    expect(
      await status(admin.updateProduct(h.client, 'dumplings', { description: 'd'.repeat(601) })),
    ).toBe(400);
  });

  it('promoción: porcentaje ≤ 100, precio fijo con tope y valor finito', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const base = {
      name: 'Promo',
      kind: 'percent' as const,
      value: 15,
      daysOfWeek: [4],
      startTime: '18:00',
      endTime: '22:00',
      validFrom: '2026-11-01',
      validTo: '2026-12-31',
    };
    expect(await status(admin.createPromotion(h.client, { ...base, value: 101 }))).toBe(400);
    expect(await status(admin.createPromotion(h.client, { ...base, value: 100 }))).toBe(200);
    const fixed = { ...base, kind: 'fixed_price' as const };
    expect(await status(admin.createPromotion(h.client, { ...fixed, value: 100_001 }))).toBe(400);
    expect(
      await status(admin.createPromotion(h.client, { ...fixed, value: Number.POSITIVE_INFINITY })),
    ).toBe(400);
    expect(await status(admin.createPromotion(h.client, { ...fixed, value: 99 }))).toBe(200);
  });
});

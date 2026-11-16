import { describe, expect, it } from 'vitest';
import { MediaClientError, optimizeImage, type ImageProcessor } from './media-optimize';
import { bannerGeometry, planBannerOptimization } from './media-rules';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const png = () => new Blob([PNG], { type: 'image/png' });
const subtle = globalThis.crypto.subtle;

function processor(width: number, height: number, sizes: number[]) {
  const calls: { size: { width: number; height: number }; quality: number; crop?: unknown }[] = [];
  const p: ImageProcessor = {
    measure: async () => ({ width, height }),
    encodeWebp: async (_blob, size, quality, crop) => {
      calls.push({ size, quality, crop });
      return new Blob([new Uint8Array(sizes[Math.min(calls.length - 1, sizes.length - 1)]!)], {
        type: 'image/webp',
      });
    },
  };
  return { p, calls };
}

describe('perfil de banner: geometría 3:1 y ≤ 1920 px', () => {
  it('recorta centrado a 3:1 exacto y reduce el ancho a 1920', () => {
    expect(bannerGeometry(4000, 1000)).toEqual({
      crop: { x: 500, y: 0, width: 3000, height: 1000 },
      size: { width: 1920, height: 640 },
    });
    expect(bannerGeometry(3000, 3000)).toEqual({
      crop: { x: 0, y: 1000, width: 3000, height: 1000 },
      size: { width: 1920, height: 640 },
    });
    // Nunca agranda.
    expect(bannerGeometry(900, 300).size).toEqual({ width: 900, height: 300 });
    expect(bannerGeometry(600, 600)).toMatchObject({
      crop: { width: 600, height: 200 },
      size: { width: 600, height: 200 },
    });
  });
  it('WebP/AVIF ya 3:1, ≤ 1920 px y ≤ 1 MiB se respetan; el resto se convierte', () => {
    const ok = {
      mimeType: 'image/webp' as const,
      width: 1920,
      height: 640,
      sizeBytes: 1024 * 1024,
    };
    expect(planBannerOptimization(ok)).toBe('keep');
    expect(planBannerOptimization({ ...ok, sizeBytes: 1024 * 1024 + 1 })).toBe('convert');
    expect(planBannerOptimization({ ...ok, height: 700 })).toBe('convert');
    expect(planBannerOptimization({ ...ok, width: 2400, height: 800 })).toBe('convert');
    expect(planBannerOptimization({ ...ok, mimeType: 'image/png' as never })).toBe('convert');
  });
});

describe('optimizeImage con perfil banner', () => {
  it('recorta con el rectángulo 3:1 y sube a WebP', async () => {
    const { p, calls } = processor(4000, 2000, [200_000]);
    const out = await optimizeImage(png(), { processor: p, subtle, profile: 'banner' });
    expect(out).toMatchObject({
      mimeType: 'image/webp',
      width: 1920,
      height: 640,
      recompressed: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      quality: 0.82,
      crop: { x: 0, y: 333, width: 4000, height: 1333 },
    });
  });

  it('baja la calidad por pasos hasta caber en 1 MiB', async () => {
    const { p, calls } = processor(3000, 1000, [2_000_000, 1_500_000, 900_000]);
    const out = await optimizeImage(png(), { processor: p, subtle, profile: 'banner' });
    expect(calls.map((c) => c.quality)).toEqual([0.82, 0.7, 0.55]);
    expect(out.sizeBytes).toBe(900_000);
  });

  it('si no cabe en 1 MiB ni a la calidad mínima: tooLarge', async () => {
    const { p, calls } = processor(3000, 1000, [3_000_000]);
    await expect(
      optimizeImage(png(), { processor: p, subtle, profile: 'banner' }),
    ).rejects.toMatchObject({ kind: 'tooLarge' });
    expect(calls).toHaveLength(4);
    // El perfil de producto conserva su tope de 5 MiB.
    const prod = processor(3000, 1000, [3_000_000]);
    expect((await optimizeImage(png(), { processor: prod.p, subtle })).sizeBytes).toBe(3_000_000);
  });

  it('un archivo que no es imagen se rechaza por sus bytes', async () => {
    const { p } = processor(10, 10, [10]);
    const err = await optimizeImage(new Blob(['<svg/>']), {
      processor: p,
      subtle,
      profile: 'banner',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MediaClientError);
    expect(err.kind).toBe('typeNotAllowed');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  MediaClientError,
  hexToBase64,
  optimizeImage,
  sha256HexOfBlob,
  type ImageProcessor,
} from './media-optimize';
import { MEDIA_MAX_BYTES } from './media-rules';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
/** Cabecera mínima válida de cada formato + relleno. */
const png = (n = 64) =>
  new Blob(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(7)])],
    { type: 'image/png' },
  );
const jpeg = (n = 64) =>
  new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)])], {
    type: 'image/jpeg',
  });
const webp = (n = 64) =>
  new Blob(
    [Uint8Array.from([...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'), ...new Array(n).fill(7)])],
    { type: 'image/webp' },
  );

/** Doble del canvas: mide lo que se le dice y «codifica» a un blob del tamaño indicado. */
function fakeProcessor(dims: { width: number; height: number }, encodedBytes = 1000) {
  const encodeWebp = vi.fn<ImageProcessor['encodeWebp']>(
    async () => new Blob([new Uint8Array(encodedBytes)], { type: 'image/webp' }),
  );
  const measure = vi.fn(async () => dims);
  const processor: ImageProcessor = { measure, encodeWebp };
  return { processor, measure, encodeWebp };
}

describe('F14 · optimización del cliente (canvas inyectado)', () => {
  it('PNG se recomprime a WebP calidad 0.82, lado máximo 1600 y calcula el SHA-256 del resultado', async () => {
    const { processor, encodeWebp } = fakeProcessor({ width: 3200, height: 1600 }, 2048);
    const out = await optimizeImage(png(), { processor });
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(encodeWebp.mock.calls[0]![1]).toEqual({ width: 1600, height: 800 });
    expect(encodeWebp.mock.calls[0]![2]).toBe(0.82);
    expect(out).toMatchObject({
      mimeType: 'image/webp',
      sizeBytes: 2048,
      width: 1600,
      height: 800,
      recompressed: true,
    });
    expect(out.blob.type).toBe('image/webp');
    expect(out.checksumSha256).toBe(await sha256HexOfBlob(out.blob));
    expect(out.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('JPEG pequeño también pasa por WebP (sin agrandar)', async () => {
    const { processor, encodeWebp } = fakeProcessor({ width: 800, height: 600 });
    const out = await optimizeImage(jpeg(), { processor });
    expect(encodeWebp.mock.calls[0]![1]).toEqual({ width: 800, height: 600 });
    expect(out.mimeType).toBe('image/webp');
  });

  it('WebP que ya cumple se sube TAL CUAL (sin canvas)', async () => {
    const { processor, encodeWebp } = fakeProcessor({ width: 1200, height: 900 });
    const file = webp(500);
    const out = await optimizeImage(file, { processor });
    expect(encodeWebp).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      mimeType: 'image/webp',
      sizeBytes: file.size,
      recompressed: false,
    });
  });

  it('WebP con lado > 1600 sí se reduce', async () => {
    const { processor, encodeWebp } = fakeProcessor({ width: 2400, height: 1200 });
    await optimizeImage(webp(), { processor });
    expect(encodeWebp.mock.calls[0]![1]).toEqual({ width: 1600, height: 800 });
  });

  it('GIF, SVG y HTML renombrado se rechazan por BYTES (typeNotAllowed), aunque el File diga image/png', async () => {
    const { processor, measure } = fakeProcessor({ width: 10, height: 10 });
    const fakePng = new Blob(['<!DOCTYPE html><html>'], { type: 'image/png' });
    for (const file of [
      new Blob(['GIF89a......'], { type: 'image/gif' }),
      new Blob(['<svg/>']),
      fakePng,
    ]) {
      await expect(optimizeImage(file, { processor })).rejects.toMatchObject({
        kind: 'typeNotAllowed',
      });
    }
    expect(measure).not.toHaveBeenCalled();
  });

  it('archivo vacío o ilegible => decode', async () => {
    const { processor } = fakeProcessor({ width: 1, height: 1 });
    await expect(optimizeImage(new Blob([]), { processor })).rejects.toMatchObject({
      kind: 'decode',
    });
    const broken: ImageProcessor = {
      measure: async () => {
        throw new Error('no decodifica');
      },
      encodeWebp: async () => new Blob([]),
    };
    await expect(optimizeImage(png(), { processor: broken })).rejects.toMatchObject({
      kind: 'decode',
    });
    const zero = fakeProcessor({ width: 0, height: 5 });
    await expect(optimizeImage(png(), { processor: zero.processor })).rejects.toMatchObject({
      kind: 'decode',
    });
  });

  it('falla del canvas al codificar => decode; salida vacía => decode', async () => {
    const failing: ImageProcessor = {
      measure: async () => ({ width: 10, height: 10 }),
      encodeWebp: async () => {
        throw new Error('canvas');
      },
    };
    await expect(optimizeImage(png(), { processor: failing })).rejects.toMatchObject({
      kind: 'decode',
    });
    const empty = fakeProcessor({ width: 10, height: 10 }, 0);
    await expect(optimizeImage(png(), { processor: empty.processor })).rejects.toMatchObject({
      kind: 'decode',
    });
  });

  it('rechaza si tras optimizar supera 5 MiB (tooLarge)', async () => {
    const { processor } = fakeProcessor({ width: 1600, height: 1200 }, MEDIA_MAX_BYTES + 1);
    await expect(optimizeImage(png(), { processor })).rejects.toMatchObject({ kind: 'tooLarge' });
    const exact = fakeProcessor({ width: 1600, height: 1200 }, MEDIA_MAX_BYTES);
    await expect(optimizeImage(png(), { processor: exact.processor })).resolves.toMatchObject({
      sizeBytes: MEDIA_MAX_BYTES,
    });
  });

  it('SHA-256 con Web Crypto: vector conocido ("abc") y error tipado sin crypto.subtle', async () => {
    expect(await sha256HexOfBlob(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    await expect(
      sha256HexOfBlob(new Blob(['abc']), null as unknown as SubtleCrypto),
    ).rejects.toBeInstanceOf(MediaClientError);
  });

  it('hexToBase64 (formato de x-amz-checksum-sha256)', () => {
    expect(hexToBase64('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(
      'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
    );
  });
});

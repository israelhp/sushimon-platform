import { describe, expect, it } from 'vitest';
import {
  MEDIA_MAX_BYTES,
  MEDIA_PER_PRODUCT_MAX,
  canAttachMore,
  extensionForMime,
  fitWithin,
  formatBytes,
  intentShapeProblems,
  isAllowedMime,
  isRetryableKind,
  isSimulatedMediaUrl,
  isValidChecksum,
  mediaErrorKindForCode,
  planOptimization,
  remainingSlots,
  sniffImageMime,
} from './media-rules';

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

describe('F14 · reglas de medios', () => {
  it('constantes del contrato: 5 MiB y 8 por producto', () => {
    expect(MEDIA_MAX_BYTES).toBe(5_242_880);
    expect(MEDIA_PER_PRODUCT_MAX).toBe(8);
  });

  it('MIME permitidos: JPEG, PNG, WebP y AVIF; GIF, SVG y vacío no', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(isAllowedMime(m)).toBe(true);
    }
    for (const m of ['image/gif', 'image/svg+xml', 'text/html', '', null, 3]) {
      expect(isAllowedMime(m)).toBe(false);
    }
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/avif')).toBe('avif');
  });

  it('checksum: 64 hex en minúsculas', () => {
    expect(isValidChecksum('a'.repeat(64))).toBe(true);
    expect(isValidChecksum('A'.repeat(64))).toBe(false);
    expect(isValidChecksum('a'.repeat(63))).toBe(false);
    expect(isValidChecksum(undefined)).toBe(false);
  });

  it('tope de 8: canAttachMore y remainingSlots', () => {
    expect(canAttachMore(7)).toBe(true);
    expect(canAttachMore(8)).toBe(false);
    expect(canAttachMore(5, 3)).toBe(true);
    expect(canAttachMore(5, 4)).toBe(false);
    expect(remainingSlots(3)).toBe(5);
    expect(remainingSlots(12)).toBe(0);
  });

  it('firma real por bytes: JPEG, PNG, WebP y AVIF; HTML renombrado, GIF, SVG y truncados => null', () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffImageMime(text('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageMime(Uint8Array.from([0, 0, 0, 0x1c, ...text('ftypavif')]))).toBe(
      'image/avif',
    );
    expect(sniffImageMime(Uint8Array.from([0, 0, 0, 0x1c, ...text('ftypheic')]))).toBeNull();
    expect(sniffImageMime(text('<!DOCTYPE html><html>'))).toBeNull();
    expect(sniffImageMime(text('GIF89a......'))).toBeNull();
    expect(sniffImageMime(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageMime(bytes(0xff, 0xd8))).toBeNull(); // truncado
    expect(sniffImageMime(bytes())).toBeNull();
  });

  it('fitWithin: reduce proporcionalmente, nunca agranda', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(10_000, 1)).toEqual({ width: 1600, height: 1 });
  });

  it('planOptimization: WebP/AVIF que cumplen se conservan; JPEG/PNG o grandes se convierten', () => {
    const base = { width: 1200, height: 800, sizeBytes: 100_000 };
    expect(planOptimization({ ...base, mimeType: 'image/webp' })).toBe('keep');
    expect(planOptimization({ ...base, mimeType: 'image/avif' })).toBe('keep');
    expect(planOptimization({ ...base, mimeType: 'image/jpeg' })).toBe('convert');
    expect(planOptimization({ ...base, mimeType: 'image/png' })).toBe('convert');
    expect(planOptimization({ ...base, width: 1601, mimeType: 'image/webp' })).toBe('convert');
    expect(
      planOptimization({ ...base, sizeBytes: MEDIA_MAX_BYTES + 1, mimeType: 'image/webp' }),
    ).toBe('convert');
  });

  it('formatBytes', () => {
    expect(formatBytes(2048)).toBe('2 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
    expect(formatBytes(10)).toBe('1 KiB');
  });

  it('forma del intent (400): propiedades desconocidas, kind, tamaño y checksum', () => {
    const ok = {
      kind: 'PRODUCT_IMAGE',
      mimeType: 'image/webp',
      sizeBytes: 10,
      checksumSha256: 'a'.repeat(64),
    };
    expect(intentShapeProblems(ok)).toEqual([]);
    // MIME y tamaño máximo NO son de forma (son 422).
    expect(intentShapeProblems({ ...ok, mimeType: 'image/gif', sizeBytes: 99_999_999 })).toEqual(
      [],
    );
    expect(intentShapeProblems({ ...ok, kind: 'BANNER' })).toHaveLength(1);
    expect(intentShapeProblems({ ...ok, sizeBytes: 0 })).toHaveLength(1);
    expect(intentShapeProblems({ ...ok, sizeBytes: 1.5 })).toHaveLength(1);
    expect(intentShapeProblems({ ...ok, checksumSha256: 'xyz' })).toHaveLength(1);
    expect(intentShapeProblems({ ...ok, extra: 1 })).toEqual(['extra: campo no permitido']);
    expect(intentShapeProblems(null)).toHaveLength(1);
    expect(intentShapeProblems([])).toHaveLength(1);
  });

  it('code → clase de mensaje; códigos ajenos => null', () => {
    expect(mediaErrorKindForCode('MEDIA_IN_USE')).toBe('inUse');
    expect(mediaErrorKindForCode('MEDIA_UPLOAD_EXPIRED')).toBe('uploadExpired');
    expect(mediaErrorKindForCode('PRODUCT_MEDIA_INVALID')).toBe('productMediaInvalid');
    expect(mediaErrorKindForCode('MEDIA_BUSY')).toBe('busy');
    expect(mediaErrorKindForCode('OTRO')).toBeNull();
    expect(mediaErrorKindForCode(undefined)).toBeNull();
    expect(isRetryableKind('busy')).toBe(true);
    expect(isRetryableKind('typeNotAllowed')).toBe(false);
  });

  it('URL simulada: solo el host reservado .invalid', () => {
    expect(isSimulatedMediaUrl('https://media-simulado.invalid/products/2026/x.webp')).toBe(true);
    expect(isSimulatedMediaUrl('https://cdn.example.test/x.webp')).toBe(false);
    expect(isSimulatedMediaUrl('no es url')).toBe(false);
    expect(isSimulatedMediaUrl(null)).toBe(false);
  });
});

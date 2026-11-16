import {
  ALLOWED_MIME_TYPES,
  baseContentType,
  buildObjectKey,
  checksumHexToBase64,
  detectImageType,
  isValidObjectKey,
  signatureMatches,
  toAssetView,
  validateIntent,
} from './media-policy.js';
import type { MediaAssetRow } from './media.types.js';

const MAX = 5_242_880;
const SHA = 'a'.repeat(64);
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const fail = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('validateIntent', () => {
  it.each(ALLOWED_MIME_TYPES)('acepta %s', (mimeType) => {
    expect(validateIntent({ mimeType, sizeBytes: 10, checksumSha256: SHA }, MAX)).toBe(mimeType);
  });

  it.each([
    'image/svg+xml',
    'image/gif',
    'text/html',
    'application/pdf',
    'IMAGE/PNG',
    '',
    'image/png ',
  ])('rechaza el MIME %j con 422 MEDIA_TYPE_NOT_ALLOWED', (mimeType) => {
    const e = fail(() => validateIntent({ mimeType, sizeBytes: 10, checksumSha256: SHA }, MAX));
    expect(code(e)).toBe('MEDIA_TYPE_NOT_ALLOWED');
    expect(status(e)).toBe(422);
  });

  it('tamaño: 1 y el máximo valen; 0, negativo, decimal, no seguro y máximo+1 => 422 MEDIA_TOO_LARGE', () => {
    for (const ok of [1, MAX]) {
      expect(() =>
        validateIntent({ mimeType: 'image/png', sizeBytes: ok, checksumSha256: SHA }, MAX),
      ).not.toThrow();
    }
    for (const bad of [0, -1, 1.5, MAX + 1, 2 ** 60, Number.NaN]) {
      const e = fail(() =>
        validateIntent({ mimeType: 'image/png', sizeBytes: bad, checksumSha256: SHA }, MAX),
      );
      expect(code(e)).toBe('MEDIA_TOO_LARGE');
      expect(status(e)).toBe(422);
    }
  });

  it('respeta un máximo configurado menor', () => {
    const e = fail(() =>
      validateIntent({ mimeType: 'image/png', sizeBytes: 101, checksumSha256: SHA }, 100),
    );
    expect(code(e)).toBe('MEDIA_TOO_LARGE');
  });

  it('el MIME se valida antes que el tamaño', () => {
    const e = fail(() =>
      validateIntent({ mimeType: 'image/gif', sizeBytes: MAX + 1, checksumSha256: SHA }, MAX),
    );
    expect(code(e)).toBe('MEDIA_TYPE_NOT_ALLOWED');
  });
});

describe('checksumHexToBase64', () => {
  it('convierte el hex de SHA-256 al base64 que firma x-amz-checksum-sha256', () => {
    // SHA-256("") = e3b0c442...b855
    const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(checksumHexToBase64(empty)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), `${'a'.repeat(64)}\n`])(
    'rechaza %j',
    (hex) => {
      expect(() => checksumHexToBase64(hex)).toThrow();
    },
  );
});

describe('buildObjectKey', () => {
  const uuid = '3f2b8c1e-9a4d-4e6b-8f1a-0c2d4e6f8a1b';
  const now = new Date('2026-11-16T12:00:00Z');

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
  ] as const)('%s => extensión %s derivada del MIME', (mime, ext) => {
    expect(buildObjectKey(mime, uuid, now)).toBe(`products/2026/${uuid}.${ext}`);
  });

  it('cumple la regla del CHECK de BD y rechaza UUID que no lo sea (nunca el nombre del cliente)', () => {
    expect(isValidObjectKey(buildObjectKey('image/png', uuid, now))).toBe(true);
    for (const bad of ['../../etc/passwd', 'foo.png', `${uuid}/../x`, uuid.toUpperCase()]) {
      expect(() => buildObjectKey('image/png', bad, now)).toThrow();
    }
  });

  it.each([
    ['Products/x.png', false],
    ['/products/x.png', false],
    ['products/../x.png', false],
    ['products//x.png', false],
    ['products/x y.png', false],
    ['products/x.png', true],
    [`p/${'a'.repeat(199)}`, false],
  ])('isValidObjectKey(%j) = %s', (key, ok) => {
    expect(isValidObjectKey(key)).toBe(ok);
  });
});

describe('detectImageType / signatureMatches (firma real)', () => {
  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], 'xxxxxxxx');
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR');
  const webp = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ');
  const avif = bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0]);
  const avis = bytes([0, 0, 0, 0x1c], 'ftypavis', [0, 0, 0, 0]);

  it('reconoce JPEG, PNG, WebP y AVIF (avif/avis)', () => {
    expect(detectImageType(jpeg)).toBe('image/jpeg');
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(webp)).toBe('image/webp');
    expect(detectImageType(avif)).toBe('image/avif');
    expect(detectImageType(avis)).toBe('image/avif');
  });

  it('coincide solo con el MIME declarado', () => {
    expect(signatureMatches('image/png', png)).toBe(true);
    expect(signatureMatches('image/jpeg', png)).toBe(false);
    expect(signatureMatches('image/webp', jpeg)).toBe(false);
  });

  it.each([
    ['HTML renombrado', bytes('<!DOCTYPE html><html><body>x</body></html>')],
    ['SVG', bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['GIF89a', bytes('GIF89a', [1, 0, 1, 0])],
    ['GIF87a', bytes('GIF87a', [1, 0, 1, 0])],
    ['PDF', bytes('%PDF-1.7')],
    ['ZIP/ejecutable', bytes('PK', [3, 4], 'xxxx')],
    ['vacío', new Uint8Array()],
    ['JPEG truncado (2 bytes)', bytes([0xff, 0xd8])],
    ['PNG truncado (7 bytes)', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
    ['PNG con cola cambiada', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])],
    ['RIFF WAVE', bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt ')],
    ['RIFF truncado', bytes('RIFF', [1, 2, 3, 4], 'WEB')],
    ['ftyp heic', bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0])],
    ['ftyp mp4', bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0])],
    ['ftyp avif truncado', bytes([0, 0, 0, 0x1c], 'ftypavi')],
  ])('no reconoce %s', (_name, data) => {
    expect(detectImageType(data)).toBeNull();
    for (const mime of ALLOWED_MIME_TYPES) expect(signatureMatches(mime, data)).toBe(false);
  });
});

describe('baseContentType', () => {
  it('quita parámetros y normaliza', () => {
    expect(baseContentType('Image/PNG; charset=binary')).toBe('image/png');
    expect(baseContentType(null)).toBeNull();
    expect(baseContentType('')).toBeNull();
  });
});

describe('toAssetView', () => {
  const row: MediaAssetRow = {
    id: 'a1',
    kind: 'PRODUCT_IMAGE',
    objectKey: 'products/2026/x.png',
    bucket: 'b',
    mimeType: 'image/png',
    sizeBytes: 10,
    checksumSha256: SHA,
    status: 'READY',
    createdByStaffId: 'staff',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: new Date('2026-01-01T00:01:00Z'),
    expiresAt: null,
    usageCount: 2,
  };

  it('READY lleva url pública; PENDING la omite; no expone bucket, clave ni quién lo creó', () => {
    const url = (k: string) => `https://cdn.example.com/${k}`;
    const ready = toAssetView(row, 'R2', url);
    expect(ready.url).toBe('https://cdn.example.com/products/2026/x.png');
    expect(ready.usageCount).toBe(2);
    expect(ready).not.toHaveProperty('objectKey');
    expect(ready).not.toHaveProperty('bucket');
    expect(ready).not.toHaveProperty('createdByStaffId');
    const pending = toAssetView({ ...row, status: 'PENDING', confirmedAt: null }, 'MOCK', url);
    expect(pending.url).toBeNull();
    expect(pending.storageMode).toBe('MOCK');
  });
});

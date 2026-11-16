import { MediaStorageError } from './media-storage-error.js';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { MOCK_UPLOAD_BASE_URL } from './media-config.js';
import { MEDIA_CACHE_CONTROL } from './media-policy.js';
import { MockMediaStorageAdapter } from './mock-media-storage.adapter.js';
import {
  createR2Client,
  R2MediaStorageAdapter,
  SIGNED_PUT_HEADERS,
} from './r2-media-storage.adapter.js';
import { UnavailableMediaStorageAdapter } from './unavailable-media-storage.adapter.js';

const CANARY = 'SECRETO-DE-PRUEBA-NO-REAL-0123456789';
const ACCESS = 'AKIAPRUEBAPRUEBA01';
const SHA_HEX = 'ab'.repeat(32);
const SHA_B64 = Buffer.from(SHA_HEX, 'hex').toString('base64');

/** Cliente real del SDK con credenciales de prueba: firma SIN red (no hay ninguna llamada a R2 ni a AWS). */
function setup() {
  const client = createR2Client({
    endpoint: 'https://cuenta12345.r2.cloudflarestorage.com',
    region: 'auto',
    accessKeyId: ACCESS,
    secretAccessKey: CANARY,
  });
  const send = vi.fn();
  (client as unknown as { send: unknown }).send = send;
  return { adapter: new R2MediaStorageAdapter(client, 'bucket-test'), send };
}

const presignInput = {
  objectKey: 'products/2026/3f2b8c1e-9a4d-4e6b-8f1a-0c2d4e6f8a1b.png',
  contentType: 'image/png',
  sizeBytes: 4321,
  checksumSha256Hex: SHA_HEX,
  cacheControl: MEDIA_CACHE_CONTROL,
  expiresInSeconds: 120,
};

describe('R2MediaStorageAdapter.presignPut (sin red)', () => {
  it('firma PUT contra el endpoint S3 con TTL y las 3 cabeceras firmadas; devuelve los headers exactos', async () => {
    const { adapter, send } = setup();
    const out = await adapter.presignPut(presignInput);
    const url = new URL(out.url);
    expect(url.origin).toBe('https://cuenta12345.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/bucket-test/${presignInput.objectKey}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    for (const header of SIGNED_PUT_HEADERS) expect(signed).toContain(header);
    // El checksum viaja como cabecera firmada, no hoisted a la query.
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
    // El tamaño exacto va firmado: el PUT con otro Content-Length lo rechaza el proveedor (a verificar con R2 real).
    expect(signed).toContain('content-length');
    expect(out.headers).toEqual({
      'Content-Type': 'image/png',
      'Content-Length': '4321',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-amz-checksum-sha256': SHA_B64,
    });
    expect(send).not.toHaveBeenCalled(); // firmar es local
  });

  it('el secreto no aparece en la URL firmada ni en los headers; la clave de acceso solo como credencial pública', async () => {
    const { adapter } = setup();
    const out = await adapter.presignPut(presignInput);
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it('el TTL pedido es el firmado (30 y 300)', async () => {
    const { adapter } = setup();
    for (const ttl of [30, 300]) {
      const out = await adapter.presignPut({ ...presignInput, expiresInSeconds: ttl });
      expect(new URL(out.url).searchParams.get('X-Amz-Expires')).toBe(String(ttl));
    }
  });

  it('un checksum no hexadecimal falla antes de firmar', async () => {
    const { adapter } = setup();
    await expect(
      adapter.presignPut({ ...presignInput, checksumSha256Hex: 'xx' }),
    ).rejects.toThrow();
  });
});

describe('R2MediaStorageAdapter (operaciones con cliente simulado)', () => {
  it('headObject traduce tamaño, tipo y checksum; ausente (404/NotFound) => null', async () => {
    const { adapter, send } = setup();
    send.mockResolvedValueOnce({
      ContentLength: 321,
      ContentType: 'image/png',
      ChecksumSHA256: SHA_B64,
    });
    expect(await adapter.headObject('k')).toEqual({
      sizeBytes: 321,
      contentType: 'image/png',
      checksumSha256Base64: SHA_B64,
    });
    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: 'bucket-test',
      Key: 'k',
      ChecksumMode: 'ENABLED',
    });
    send.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
    );
    expect(await adapter.headObject('k')).toBeNull();
  });

  it('headObject sin checksum informado => checksum null', async () => {
    const { adapter, send } = setup();
    send.mockResolvedValueOnce({ ContentLength: 5, ContentType: 'image/png' });
    expect((await adapter.headObject('k'))?.checksumSha256Base64).toBeNull();
  });

  it('readRange pide los primeros bytes con Range y devuelve el cuerpo; ausente => null', async () => {
    const { adapter, send } = setup();
    const body = { transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2, 3])) };
    send.mockResolvedValueOnce({ Body: body });
    expect(await adapter.readRange('k', 32)).toEqual(Uint8Array.from([1, 2, 3]));
    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({ Key: 'k', Range: 'bytes=0-31' });
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    expect(await adapter.readRange('k', 32)).toBeNull();
  });

  it('deleteObject: ausente cuenta como éxito', async () => {
    const { adapter, send } = setup();
    send.mockResolvedValueOnce({});
    await expect(adapter.deleteObject('k')).resolves.toBeUndefined();
    send.mockRejectedValueOnce(
      Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }),
    );
    await expect(adapter.deleteObject('k')).resolves.toBeUndefined();
  });

  it('un fallo del proveedor se reduce a MediaStorageError SIN el mensaje original (puede traer URL o credenciales)', async () => {
    const { adapter, send } = setup();
    const leaky = Object.assign(
      new Error(`AccessDenied for ${ACCESS} secret ${CANARY} https://x.r2/obj?X-Amz-Signature=abc`),
      {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      },
    );
    for (const call of [
      () => adapter.headObject('k'),
      () => adapter.readRange('k', 32),
      () => adapter.deleteObject('k'),
    ]) {
      send.mockRejectedValueOnce(leaky);
      const error = (await call().then(
        () => null,
        (e: unknown) => e,
      )) as MediaStorageError;
      expect(error).toBeInstanceOf(MediaStorageError);
      expect(error.providerCode).toBe('AccessDenied');
      expect(error.httpStatus).toBe(403);
      const text = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain(ACCESS);
      expect(text).not.toContain('X-Amz-Signature');
    }
  });
});

describe('UnavailableMediaStorageAdapter', () => {
  it('toda operación responde 503 MEDIA_STORAGE_UNAVAILABLE con mensaje fijo', async () => {
    const adapter = new UnavailableMediaStorageAdapter();
    expect(adapter.mode).toBe('UNAVAILABLE');
    for (const call of [
      () => adapter.presignPut(),
      () => adapter.headObject(),
      () => adapter.readRange(),
      () => adapter.deleteObject(),
    ]) {
      const e = (await call().then(
        () => null,
        (err: unknown) => err,
      )) as HttpException;
      expect(e.getStatus()).toBe(503);
      expect((e.getResponse() as { code: string }).code).toBe('MEDIA_STORAGE_UNAVAILABLE');
    }
  });
});

describe('MockMediaStorageAdapter', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('firma con host reservado .invalid y headers; jamás un dominio real', async () => {
    const mock = new MockMediaStorageAdapter();
    const out = await mock.presignPut(presignInput);
    expect(new URL(out.url).hostname.endsWith('.invalid')).toBe(true);
    expect(out.url.startsWith(MOCK_UPLOAD_BASE_URL)).toBe(true);
    expect(out.headers['x-amz-checksum-sha256']).toBe(SHA_B64);
  });

  it('simula el PUT: head devuelve tamaño, tipo y SHA-256 reales; readRange recorta; delete borra', async () => {
    const mock = new MockMediaStorageAdapter();
    expect(await mock.headObject('k')).toBeNull();
    mock.simulateUpload('k', bytes, 'image/png');
    expect(await mock.headObject('k')).toEqual({
      sizeBytes: bytes.length,
      contentType: 'image/png',
      checksumSha256Base64: createHash('sha256').update(bytes).digest('base64'),
    });
    expect(await mock.readRange('k', 4)).toEqual(bytes.slice(0, 4));
    await mock.deleteObject('k');
    expect(await mock.headObject('k')).toBeNull();
    expect(await mock.readRange('k', 4)).toBeNull();
  });
});

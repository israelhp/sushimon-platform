import { createHash } from 'node:crypto';
import { MOCK_BUCKET, MOCK_UPLOAD_BASE_URL } from './media-config.js';
import { checksumHexToBase64 } from './media-policy.js';
import type {
  MediaStoragePort,
  PresignedPut,
  PresignPutInput,
  StoredObjectHead,
} from './media-storage.port.js';

interface MockObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Almacenamiento EN MEMORIA, solo desarrollo y pruebas (`MEDIA_STORAGE_ADAPTER=mock` con NODE_ENV development|test).
 * No hace red ni sube bytes por HTTP: las URL usan el host reservado `*.invalid`. Nunca prueba una integración real;
 * `simulateUpload` emula lo que haría el navegador al hacer el PUT.
 */
export class MockMediaStorageAdapter implements MediaStoragePort {
  readonly mode = 'MOCK' as const;
  readonly objects = new Map<string, MockObject>();

  presignPut(input: PresignPutInput): Promise<PresignedPut> {
    const url = `${MOCK_UPLOAD_BASE_URL}/${MOCK_BUCKET}/${input.objectKey}?mock=1&expires=${input.expiresInSeconds}`;
    return Promise.resolve({
      url,
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.sizeBytes),
        'Cache-Control': input.cacheControl,
        'x-amz-checksum-sha256': checksumHexToBase64(input.checksumSha256Hex),
      },
    });
  }

  /** Emula el PUT del navegador (solo pruebas/desarrollo). */
  simulateUpload(objectKey: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(objectKey, { bytes: new Uint8Array(bytes), contentType });
  }

  headObject(objectKey: string): Promise<StoredObjectHead | null> {
    const found = this.objects.get(objectKey);
    if (!found) return Promise.resolve(null);
    return Promise.resolve({
      sizeBytes: found.bytes.length,
      contentType: found.contentType,
      checksumSha256Base64: createHash('sha256').update(found.bytes).digest('base64'),
    });
  }

  readRange(objectKey: string, length: number): Promise<Uint8Array | null> {
    const found = this.objects.get(objectKey);
    return Promise.resolve(found ? found.bytes.slice(0, length) : null);
  }

  deleteObject(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

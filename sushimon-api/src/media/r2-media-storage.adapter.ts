import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { checksumHexToBase64 } from './media-policy.js';
import { MediaStorageError } from './media-storage-error.js';
import type {
  MediaStoragePort,
  PresignedPut,
  PresignPutInput,
  StoredObjectHead,
} from './media-storage.port.js';

export interface R2ClientConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Cabeceras firmadas del PUT (en minúsculas, como aparecen en `X-Amz-SignedHeaders`). */
export const SIGNED_PUT_HEADERS = [
  'cache-control',
  'content-type',
  'x-amz-checksum-sha256',
] as const;

/** Tiempos acotados por llamada al proveedor (ms). */
const CONNECTION_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 8_000;

export function createR2Client(config: R2ClientConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    // R2 no soporta los checksums automáticos por defecto del SDK reciente: solo se firma el SHA-256 explícito.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // Sin reintentos automáticos: el cliente reintenta `complete` (idempotente) o pide otro intent.
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    },
  });
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return typeof status === 'number' ? status : null;
};

const nameOf = (error: unknown): string =>
  typeof (error as { name?: unknown } | null)?.name === 'string'
    ? (error as { name: string }).name
    : 'Error';

const isMissing = (error: unknown): boolean =>
  statusOf(error) === 404 || ['NotFound', 'NoSuchKey'].includes(nameOf(error));

/**
 * Adaptador real contra el endpoint S3 de Cloudflare R2 con el SDK oficial.
 * ESTADO: `BLOCKED_EXTERNAL`. Escrito contra el SDK, probado solo con cliente sin red; NO verificado contra R2 real
 * (ver `docs/integrations/cloudflare-r2.md`). Los errores del proveedor se reducen a `MediaStorageError` (nombre/código/
 * estado HTTP): jamás el mensaje, la URL ni las credenciales.
 */
export class R2MediaStorageAdapter implements MediaStoragePort {
  readonly mode = 'R2' as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    const checksum = checksumHexToBase64(input.checksumSha256Hex);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      CacheControl: input.cacheControl,
      ChecksumSHA256: checksum,
    });
    try {
      const url = await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
        // Que viajen como cabeceras FIRMADAS (no hoisted a la query): el navegador debe enviarlas exactas.
        signableHeaders: new Set<string>(SIGNED_PUT_HEADERS),
        unhoistableHeaders: new Set<string>(['x-amz-checksum-sha256']),
      });
      return {
        url,
        headers: {
          'Content-Type': input.contentType,
          'Content-Length': String(input.sizeBytes),
          'Cache-Control': input.cacheControl,
          'x-amz-checksum-sha256': checksum,
        },
      };
    } catch (error) {
      throw new MediaStorageError('presignPut', nameOf(error), statusOf(error));
    }
  }

  async headObject(objectKey: string): Promise<StoredObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }),
      );
      return {
        sizeBytes: Number(out.ContentLength ?? 0),
        contentType: out.ContentType ?? null,
        checksumSha256Base64: out.ChecksumSHA256 ?? null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw new MediaStorageError('headObject', nameOf(error), statusOf(error));
    }
  }

  async readRange(objectKey: string, length: number): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Range: `bytes=0-${Math.max(0, length - 1)}`,
        }),
      );
      if (!out.Body) return new Uint8Array();
      return await out.Body.transformToByteArray();
    } catch (error) {
      if (isMissing(error)) return null;
      throw new MediaStorageError('readRange', nameOf(error), statusOf(error));
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      if (isMissing(error)) return;
      throw new MediaStorageError('deleteObject', nameOf(error), statusOf(error));
    }
  }
}

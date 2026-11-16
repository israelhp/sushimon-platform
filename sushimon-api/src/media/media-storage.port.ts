import type { StorageKind } from './media.types.js';

/** Token del puerto de almacenamiento de objetos (F14). Un adaptador por entorno, elegido por configuración. */
export const MEDIA_STORAGE_PORT = Symbol('MEDIA_STORAGE_PORT');

export interface PresignPutInput {
  objectKey: string;
  contentType: string;
  /** Tamaño exacto declarado: se firma como `Content-Length` (el PUT con otro tamaño lo rechaza el proveedor). */
  sizeBytes: number;
  /** SHA-256 en hexadecimal minúsculas (el adaptador lo firma en base64). */
  checksumSha256Hex: string;
  cacheControl: string;
  expiresInSeconds: number;
}

export interface PresignedPut {
  /** URL PUT firmada. Secreto de corta vida: solo viaja en la respuesta del intent. Jamás se registra. */
  url: string;
  /** Cabeceras que el navegador debe enviar tal cual (están firmadas). */
  headers: Record<string, string>;
}

export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string | null;
  /** SHA-256 en base64 tal como lo devuelve el proveedor (null si no lo informa). */
  checksumSha256Base64: string | null;
}

/**
 * Almacenamiento de objetos. Contrato de errores: un objeto ausente NO es un error (`null` / borrado idempotente);
 * cualquier otro fallo del proveedor se lanza y el servicio lo traduce a 503 `MEDIA_STORAGE_UNAVAILABLE` sin detalles.
 */
export interface MediaStoragePort {
  readonly mode: StorageKind;
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  headObject(objectKey: string): Promise<StoredObjectHead | null>;
  /** Primeros `length` bytes del objeto (GET con rango). `null` si no existe. */
  readRange(objectKey: string, length: number): Promise<Uint8Array | null>;
  /** Un objeto ausente cuenta como éxito. */
  deleteObject(objectKey: string): Promise<void>;
}

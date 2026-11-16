import { storageUnavailable } from './media-policy.js';
import type { MediaStoragePort } from './media-storage.port.js';

/** Defecto sin variables R2: toda operación que necesita almacenamiento responde 503 `MEDIA_STORAGE_UNAVAILABLE`. */
export class UnavailableMediaStorageAdapter implements MediaStoragePort {
  readonly mode = 'UNAVAILABLE' as const;

  presignPut(): Promise<never> {
    return Promise.reject(storageUnavailable());
  }
  headObject(): Promise<never> {
    return Promise.reject(storageUnavailable());
  }
  readRange(): Promise<never> {
    return Promise.reject(storageUnavailable());
  }
  deleteObject(): Promise<never> {
    return Promise.reject(storageUnavailable());
  }
}

/** Error del proveedor sin detalles (jamás copia mensajes, URL ni credenciales del SDK). Sin dependencias del SDK. */
export class MediaStorageError extends Error {
  constructor(
    readonly operation: string,
    readonly providerCode: string,
    readonly httpStatus: number | null,
  ) {
    super(`Fallo del almacenamiento en ${operation}`);
    this.name = 'MediaStorageError';
  }
}

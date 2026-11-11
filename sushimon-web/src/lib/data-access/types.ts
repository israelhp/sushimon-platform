/**
 * Puerto de acceso a datos. Los servicios de cada feature dependen de esta interfaz;
 * la implementación (mock o http) se elige por configuración. Las pantallas no la conocen.
 */
export interface DataClient {
  readonly kind: 'mock' | 'http';
  get<T>(path: string, init?: { signal?: AbortSignal }): Promise<T>;
}

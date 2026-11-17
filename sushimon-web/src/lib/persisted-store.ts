/**
 * Estado del cliente persistido en Web Storage (SOLO preferencias: carrito, modo de pedido…;
 * nunca autenticación). SSR-safe: en el servidor devuelve el valor inicial y lee el
 * almacenamiento en el primer uso en el navegador. Errores de almacenamiento se ignoran.
 * Pensado para `useSyncExternalStore(store.subscribe, store.get, store.getServer)`.
 */
export interface PersistedStore<T> {
  get(): T;
  getServer(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export interface PersistedStoreLoad<T> {
  raw: string | null;
  value: T;
  /** Valor en memoria ANTES de esta lectura (`initial` en la primera). */
  previous: T;
  /** `initial` = primera lectura en el navegador; `storage` = evento de OTRA pestaña (último escritor gana). */
  source: 'initial' | 'storage';
}

export function createPersistedStore<T>(options: {
  key: string;
  initial: T;
  parse: (raw: string | null) => T;
  storage?: 'local' | 'session';
  /** Escucha el evento `storage` (cambios hechos en otras pestañas) y vuelve a leer con `parse`. Solo con `storage: 'local'`. */
  crossTab?: boolean;
  /** Se invoca tras cada lectura del almacenamiento (inicial o por evento): avisos y limpieza de claves dañadas. */
  onLoad?: (load: PersistedStoreLoad<T>) => void;
  /**
   * Se invoca tras cada escritura con `ok = false` si `setItem` falló (cuota/modo privado: el estado sigue en memoria) o `true`
   * si se logró (permite reiniciar un aviso ya dado).
   */
  onWrite?: (ok: boolean) => void;
  /**
   * Lectura de un evento `storage` de OTRA pestaña. Recibe el valor en memoria; devolverlo tal cual lo CONSERVA (p. ej. si lo
   * recibido es inválido: no se pisa un estado válido por uno vacío). Por defecto usa `parse`.
   */
  parseExternal?: (raw: string | null, current: T) => T;
  /** Texto a guardar (por defecto `JSON.stringify`). */
  serialize?: (value: T) => string;
}): PersistedStore<T> {
  const {
    key,
    initial,
    parse,
    storage = 'local',
    crossTab = false,
    onLoad,
    onWrite,
    parseExternal,
    serialize = JSON.stringify,
  } = options;
  let value = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const area = () =>
    typeof window === 'undefined'
      ? null
      : storage === 'local'
        ? window.localStorage
        : window.sessionStorage;

  function read(raw: string | null, source: 'initial' | 'storage') {
    const previous = value;
    try {
      value = source === 'storage' && parseExternal ? parseExternal(raw, value) : parse(raw);
    } catch {
      value = source === 'storage' ? previous : initial;
    }
    onLoad?.({ raw, value, previous, source });
  }

  function get(): T {
    if (!loaded && typeof window !== 'undefined') {
      loaded = true;
      let raw: string | null = null;
      try {
        raw = area()?.getItem(key) ?? null;
      } catch {
        raw = null;
      }
      read(raw, 'initial');
    }
    return value;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== area()) return;
    if (event.key !== null && event.key !== key) return;
    loaded = true;
    read(event.key === null ? null : event.newValue, 'storage');
    listeners.forEach((l) => l());
  };

  return {
    get,
    getServer: () => initial,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(get()) : next;
      try {
        area()?.setItem(key, serialize(value));
        onWrite?.(true);
      } catch {
        // almacenamiento lleno o bloqueado: el estado sigue en memoria
        onWrite?.(false);
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      if (crossTab && listeners.size === 1 && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (crossTab && listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
        }
      };
    },
  };
}

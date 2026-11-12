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

export function createPersistedStore<T>(options: {
  key: string;
  initial: T;
  parse: (raw: string | null) => T;
  storage?: 'local' | 'session';
}): PersistedStore<T> {
  const { key, initial, parse, storage = 'local' } = options;
  let value = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const area = () =>
    typeof window === 'undefined'
      ? null
      : storage === 'local'
        ? window.localStorage
        : window.sessionStorage;

  function get(): T {
    if (!loaded && typeof window !== 'undefined') {
      loaded = true;
      try {
        value = parse(area()?.getItem(key) ?? null);
      } catch {
        value = initial;
      }
    }
    return value;
  }

  return {
    get,
    getServer: () => initial,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(get()) : next;
      try {
        area()?.setItem(key, JSON.stringify(value));
      } catch {
        // almacenamiento lleno o bloqueado: el estado sigue en memoria
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

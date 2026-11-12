import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SESSION_KEY, readDemoSession, writeDemoSession } from '@/lib/demo-session';
import { createPersistedStore } from '@/lib/persisted-store';
import { createSeedStore } from './seed';
import { flushPersist, loadPersistedStore, persistStore, storageKey } from './store';

/** Almacenamiento en memoria para simular `window` en el entorno node de Vitest. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe('persistencia en el navegador', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('MockStore: guarda y recupera por escenario con clave versionada', () => {
    const store = createSeedStore('default');
    store.orders[0]!.note = 'cambiado';
    persistStore(store);
    flushPersist();
    expect(window.sessionStorage.getItem(storageKey('default'))).toContain('cambiado');
    expect(storageKey('default')).toBe('sushimon-mock-store-v1:default');
    expect(loadPersistedStore('default')?.orders[0]?.note).toBe('cambiado');
    expect(loadPersistedStore('empty')).toBeNull();
  });

  it('ignora datos corruptos o de otra versión', () => {
    window.sessionStorage.setItem(storageKey('default'), '{nope');
    expect(loadPersistedStore('default')).toBeNull();
    window.sessionStorage.setItem(
      storageKey('default'),
      JSON.stringify({ version: 999, scenario: 'default' }),
    );
    expect(loadPersistedStore('default')).toBeNull();
  });

  it('tolera almacenamiento que falla', () => {
    const broken = memoryStorage();
    broken.setItem = () => {
      throw new Error('QuotaExceeded');
    };
    vi.stubGlobal('window', { sessionStorage: broken, localStorage: broken });
    expect(() => {
      persistStore(createSeedStore());
      flushPersist();
    }).not.toThrow();
    expect(() => writeDemoSession({ customer: null, staff: null })).not.toThrow();
  });

  it('sesión de demostración en sessionStorage', () => {
    expect(readDemoSession()).toEqual({ customer: null, staff: null });
    writeDemoSession({
      customer: { email: 'a@b.co', name: 'A', provider: 'google-demo' },
      staff: null,
    });
    expect(window.sessionStorage.getItem(DEMO_SESSION_KEY)).toContain('a@b.co');
    expect(readDemoSession().customer?.email).toBe('a@b.co');
    expect(window.localStorage.getItem(DEMO_SESSION_KEY)).toBeNull();
  });

  it('preferencias persistidas (carrito) en localStorage', () => {
    const s = createPersistedStore<number[]>({
      key: 'k',
      initial: [],
      parse: (raw) => (raw ? (JSON.parse(raw) as number[]) : []),
    });
    const listener = vi.fn();
    s.subscribe(listener);
    s.set((prev) => [...prev, 1]);
    expect(window.localStorage.getItem('k')).toBe('[1]');
    expect(listener).toHaveBeenCalledOnce();
    expect(s.getServer()).toEqual([]);
  });
});

describe('persistStore con debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
  });
  afterEach(() => {
    flushPersist();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('agrupa escrituras: una sola serialización a los 300 ms con el último estado', () => {
    const setItem = vi.spyOn(window.sessionStorage, 'setItem');
    const store = createSeedStore('default');
    for (let i = 0; i < 10; i++) {
      store.orders[0]!.note = `n${i}`;
      persistStore(store);
    }
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledOnce();
    expect(loadPersistedStore('default')?.orders[0]?.note).toBe('n9');
  });

  it('flushPersist escribe de inmediato y no deja escritura pendiente', () => {
    const setItem = vi.spyOn(window.sessionStorage, 'setItem');
    persistStore(createSeedStore('default'));
    flushPersist();
    expect(setItem).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(setItem).toHaveBeenCalledOnce();
  });
});

describe('SSR', () => {
  it('sin window no lee ni escribe', () => {
    expect(typeof window).toBe('undefined');
    expect(loadPersistedStore('default')).toBeNull();
    expect(() => persistStore(createSeedStore())).not.toThrow();
    expect(readDemoSession()).toEqual({ customer: null, staff: null });
  });
});

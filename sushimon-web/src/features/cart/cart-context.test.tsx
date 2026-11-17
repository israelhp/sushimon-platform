import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CART_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  parseCartV2,
  type AddToCartInput,
} from '@/lib/cart-rules';
import { cartInput } from '@/test/cart';

type Mod = typeof import('./cart-context');
type Api = ReturnType<Mod['useCart']>;

/** Módulo NUEVO por caso: el store del carrito es un singleton de módulo (simula una recarga de la página). */
async function mount() {
  vi.resetModules();
  const mod: Mod = await import('./cart-context');
  let api!: Api;
  function Probe() {
    api = mod.useCart();
    return (
      <>
        <output data-testid="count">{api.count}</output>
        <output data-testid="notice">{api.notice ?? ''}</output>
        <output data-testid="external">{api.externalUpdates}</output>
      </>
    );
  }
  const view = render(
    <mod.CartProvider>
      <Probe />
    </mod.CartProvider>,
  );
  await act(async () => {});
  return { api: () => api, view };
}

const stored = () => JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? 'null');
const add = (api: Api, ...inputs: AddToCartInput[]) =>
  act(() => {
    expect(api.add(inputs).ok).toBe(true);
  });

beforeEach(() => {
  window.localStorage.clear();
});

describe('cart-context · persistencia (#22 #26)', () => {
  it('guarda en monsushi-cart-v2 y recupera tras «recargar»', async () => {
    const first = await mount();
    await add(first.api(), cartInput('dumplings', 2));
    expect(stored()).toMatchObject({
      v: 2,
      branchId: 'sucursal-1',
      lines: [{ productId: 'dumplings', quantity: 2 }],
    });
    first.view.unmount();

    const again = await mount();
    expect(again.api().count).toBe(2);
    expect(again.api().lines[0]?.productId).toBe('dumplings');
    expect(again.api().branchId).toBe('sucursal-1');
    expect(again.api().notice).toBeNull();
  });

  it('el HTML del servidor (y el primer render de hidratación) es SIEMPRE un carrito vacío, aunque haya datos guardados', async () => {
    const first = await mount();
    await add(first.api(), cartInput('dumplings', 2));
    first.view.unmount();
    vi.resetModules();
    const mod: Mod = await import('./cart-context');
    function Count() {
      const cart = mod.useCart();
      return <span>{`n=${cart.count};ready=${cart.ready}`}</span>;
    }
    const html = renderToString(
      <mod.CartProvider>
        <Count />
      </mod.CartProvider>,
    );
    expect(html).toContain('n=0;ready=false');
    // Ya en el navegador (tras hidratar) se lee lo guardado.
    render(
      <mod.CartProvider>
        <Count />
      </mod.CartProvider>,
    );
    expect(await screen.findByText('n=2;ready=true')).toBeInTheDocument();
  });

  it('el contador son UNIDADES, no líneas (#27)', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 3), cartInput('b', 4), cartInput('a', 1, 'nota'));
    expect(api().lines).toHaveLength(3);
    expect(api().count).toBe(8);
    expect(screen.getByTestId('count')).toHaveTextContent('8');
  });

  it('quitar, deshacer y vaciar', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 1), cartInput('b', 2));
    let removed: ReturnType<Api['remove']> = null;
    act(() => {
      removed = api().remove(api().lines[0]!.lineId);
    });
    expect(api().lines).toHaveLength(1);
    act(() => {
      expect(api().restore(removed!).ok).toBe(true);
    });
    expect(api().lines).toHaveLength(2);
    act(() => api().clear());
    expect(api().count).toBe(0);
    expect(api().branchId).toBeNull();
    expect(stored().lines).toEqual([]);
  });

  it('applyRevalidation no cambia las selecciones, la cantidad ni updatedAt', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 2, '', { unitCents: 1000 }));
    const before = stored();
    const line = api().lines[0]!;
    act(() =>
      api().applyRevalidation([
        { lineId: line.lineId, unitCents: 1200, name: 'A nuevo', imageUrl: null, options: [] },
      ]),
    );
    const after = stored();
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.lines[0]).toMatchObject({
      quantity: 2,
      selections: [],
      display: { unitCents: 1200, name: 'A nuevo', priceChange: { fromCents: 1000 } },
    });
    act(() => api().acknowledgePrice(line.lineId));
    expect(stored().lines[0].display.priceChange).toBeNull();
  });
});

describe('cart-context · avisos (#23 #24 #25)', () => {
  it('v1 con productos: se elimina, no se migra y avisa UNA vez', async () => {
    window.localStorage.setItem(
      LEGACY_CART_STORAGE_KEY,
      JSON.stringify([{ productId: 'dumplings', quantity: 1, note: '' }]),
    );
    const { api } = await mount();
    expect(api().count).toBe(0);
    expect(api().notice).toBe('legacy');
    expect(window.localStorage.getItem(LEGACY_CART_STORAGE_KEY)).toBeNull();
    act(() => api().dismissNotice());
    expect(api().notice).toBeNull();
  });

  it('v1 vacío: se elimina sin avisar', async () => {
    window.localStorage.setItem(LEGACY_CART_STORAGE_KEY, '[]');
    const { api } = await mount();
    expect(api().notice).toBeNull();
    expect(window.localStorage.getItem(LEGACY_CART_STORAGE_KEY)).toBeNull();
  });

  it('JSON corrupto: vacío, aviso y la clave se borra', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, '{corrupto');
    const { api } = await mount();
    expect(api().count).toBe(0);
    expect(api().notice).toBe('corrupt');
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('TTL vencido: vacío con aviso', async () => {
    const old = parseCartV2(null, 0);
    expect(old.notice).toBeNull();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ v: 2, branchId: null, updatedAt: 1, lines: [] }),
    );
    const { api } = await mount();
    expect(api().notice).toBe('expired');
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('si el almacenamiento falla, el carrito sigue en memoria y avisa una vez', async () => {
    const { api } = await mount();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    await add(api(), cartInput('a', 1));
    await act(async () => {});
    expect(api().count).toBe(1);
    expect(api().notice).toBe('storage');
    spy.mockRestore();
  });
});

describe('cart-context · pestañas y sesión (#28 #29)', () => {
  const fromOtherTab = (state: object | null) =>
    act(() => {
      const newValue = state === null ? null : JSON.stringify(state);
      if (newValue === null) window.localStorage.removeItem(CART_STORAGE_KEY);
      else window.localStorage.setItem(CART_STORAGE_KEY, newValue);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CART_STORAGE_KEY,
          newValue,
          storageArea: window.localStorage,
        }),
      );
    });

  it('el evento storage de otra pestaña actualiza el carrito (último escritor gana) y se anuncia', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 1));
    const other = {
      ...stored(),
      lines: [{ ...stored().lines[0], quantity: 5 }],
      updatedAt: Date.now() + 10,
    };
    fromOtherTab(other);
    await act(async () => {});
    expect(api().count).toBe(5);
    expect(api().externalUpdates).toBe(1);
    expect(screen.getByTestId('external')).toHaveTextContent('1');
  });

  it('ignora otras claves; un valor externo INVÁLIDO conserva el estado válido y NO borra la clave', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 1));
    const before = window.localStorage.getItem(CART_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'otra-clave',
          newValue: 'x',
          storageArea: window.localStorage,
        }),
      );
    });
    expect(api().count).toBe(1);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CART_STORAGE_KEY,
          newValue: '{mal',
          storageArea: window.localStorage,
        }),
      );
    });
    await act(async () => {});
    expect(api().count).toBe(1);
    expect(api().notice).toBeNull();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(before);
  });

  it('un ajuste idempotente de revalidación de otra pestaña NO cuenta como «actualizado en otra pestaña»', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 2, '', { unitCents: 1000 }));
    const doc = stored();
    doc.lines[0].display.unitCents = 1200; // solo presentación
    fromOtherTab(doc);
    await act(async () => {});
    expect(api().externalUpdates).toBe(0);
    doc.lines[0].quantity = 3; // cambio real
    fromOtherTab(doc);
    await act(async () => {});
    expect(api().externalUpdates).toBe(1);
  });

  it('vaciar en otra pestaña (clave eliminada) vacía esta', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 1));
    fromOtherTab(null);
    expect(api().count).toBe(0);
  });

  it('el carrito es anónimo: no hay identidad en el JSON ni se duplica al re-montar con sesión', async () => {
    const first = await mount();
    await add(first.api(), cartInput('a', 2));
    const json = window.localStorage.getItem(CART_STORAGE_KEY)!;
    expect(json).not.toMatch(/customer|session|user|email/i);
    first.view.unmount();
    // «Iniciar sesión» no toca el almacenamiento del carrito: re-leerlo da las mismas líneas, sin duplicar.
    const again = await mount();
    expect(again.api().lines).toHaveLength(1);
    expect(again.api().count).toBe(2);
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(json);
  });
});

describe('cart-context · vigencia y escritura (S1, S3)', () => {
  it('al volver al foco se reevalúa el TTL: si venció, se vacía con aviso', async () => {
    const { api } = await mount();
    await add(api(), cartInput('a', 1));
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {});
    expect(api().count).toBe(0);
    expect(api().notice).toBe('expired');
    spy.mockRestore();
  });

  it('un updatedAt en el futuro es documento corrupto (vacío + aviso + clave borrada)', async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ v: 2, branchId: null, updatedAt: Date.now() + 3_600_000, lines: [] }),
    );
    const { api } = await mount();
    expect(api().notice).toBe('corrupt');
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('líneas descartadas al leer: se reescribe el documento limpio (el aviso no se repite en cada carga)', async () => {
    const first = await mount();
    await add(first.api(), cartInput('a', 1), cartInput('b', 1));
    first.view.unmount();
    const doc = stored();
    doc.lines.push({ ...doc.lines[0], quantity: 0 });
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(doc));
    const second = await mount();
    expect(second.api().notice).toBe('dropped');
    expect(stored().lines).toHaveLength(2);
    second.view.unmount();
    const third = await mount();
    expect(third.api().notice).toBeNull();
  });

  it('tras una escritura lograda, un nuevo fallo vuelve a avisar', async () => {
    const { api } = await mount();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    await add(api(), cartInput('a', 1));
    await act(async () => {});
    expect(api().notice).toBe('storage');
    act(() => api().dismissNotice());
    spy.mockRestore();
    await add(api(), cartInput('b', 1)); // escritura OK: reinicia el aviso
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    await add(api(), cartInput('c', 1));
    await act(async () => {});
    expect(api().notice).toBe('storage');
    vi.restoreAllMocks();
  });
});

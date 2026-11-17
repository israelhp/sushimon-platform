import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY } from '@/lib/cart-rules';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { CartAnnouncer, EXTERNAL_ANNOUNCE_MS } from './CartAnnouncer';

const fromOtherTab = (quantity: number) =>
  act(async () => {
    const doc = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)!);
    doc.lines[0].quantity = quantity;
    const newValue = JSON.stringify(doc);
    window.localStorage.setItem(CART_STORAGE_KEY, newValue);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: CART_STORAGE_KEY,
        newValue,
        storageArea: window.localStorage,
      }),
    );
  });

describe('CartAnnouncer · un solo anuncio por ráfaga (S2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('varios cambios seguidos de otra pestaña se anuncian UNA vez, cuando se calma la ráfaga', async () => {
    const view = await renderStore(<CartAnnouncer />, { branchId: 'sucursal-1' });
    await act(async () => view.api().cart.add(cartInput('dumplings', 1)));
    const region = screen.getByRole('status');
    await fromOtherTab(2);
    act(() => vi.advanceTimersByTime(200));
    await fromOtherTab(3);
    act(() => vi.advanceTimersByTime(200));
    await fromOtherTab(4);
    // mientras la ráfaga sigue, nada se anuncia
    act(() => vi.advanceTimersByTime(EXTERNAL_ANNOUNCE_MS - 1));
    expect(region).not.toHaveTextContent('otra pestaña');
    act(() => vi.advanceTimersByTime(1));
    expect(region).toHaveTextContent('Tu pedido se actualizó en otra pestaña.');
    // y no se repite
    act(() => vi.advanceTimersByTime(60_000));
    expect(region).toBeEmptyDOMElement();
    expect(view.api().cart.count).toBe(4);
  });
});

import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuCartAside } from '@/features/menu/components/menu-cart-aside';
import { queryKeys } from '@/features/query-keys';
import { cartInput } from '@/test/cart';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { DETAIL_CONCURRENCY, useBranchLive } from './use-branch-live';
import { useCart } from './cart-context';

vi.mock('next/navigation', () => ({
  usePathname: () => '/menu',
  useRouter: () => ({ push: vi.fn() }),
}));

const SEVEN = [
  'dumplings',
  'california-roll',
  'sushi-pizza',
  'poporopos-cangrejo',
  'cayibel-roll',
  'dynamita-roll',
  'loco-ribs',
];
const DETAIL = /^\/v1\/store\/products\/[^/]+$/;

function Probe() {
  const cart = useCart();
  const live = useBranchLive({ branchId: cart.branchId, lines: cart.lines, enabled: true });
  return <output data-testid="status">{live.status}</output>;
}

afterEach(() => vi.unstubAllGlobals());

describe('revalidación: concurrencia y caché de fichas (P2)', () => {
  it(`pide como mucho ${DETAIL_CONCURRENCY} fichas a la vez y habilita la siguiente al terminar una`, async () => {
    const spy = createSpyClient();
    const gates = SEVEN.map(() => spy.hold('GET', DETAIL));
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await act(async () => {
      view.api().cart.add(SEVEN.map((id) => cartInput(id, 1)));
    });
    const started = () => spy.count('GET', DETAIL);
    await waitFor(() => expect(started()).toBe(DETAIL_CONCURRENCY));
    // Mientras ninguna termine no se piden más (se deja pasar un ciclo de render para comprobarlo).
    await act(async () => {});
    expect(started()).toBe(DETAIL_CONCURRENCY);
    expect(screen.getByTestId('status')).toHaveTextContent('pending');

    await act(async () => gates[0]!.release());
    await waitFor(() => expect(started()).toBe(DETAIL_CONCURRENCY + 1));
    for (const gate of gates) await act(async () => gate.release());
    await waitFor(() => expect(started()).toBe(SEVEN.length));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    // UNA ficha por producto único y UN menú (no una consulta por línea).
    expect(spy.count('GET', /^\/v1\/store\/menu$/)).toBe(1);
    await act(async () => view.api().cart.clear()); // el carrito es un singleton de módulo: no contamina el caso siguiente
  });

  it('las fichas NO se refrescan al volver al foco (solo el menú)', async () => {
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1' });
    await act(async () => {
      view.api().cart.add([cartInput('dumplings', 1)]);
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    const detail = view.queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.products.storeDetail('dumplings', 'sucursal-1') });
    expect(detail?.observers[0]?.options.refetchOnWindowFocus).toBe(false);
    const menu = view.queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.store.menu('sucursal-1', { page: 'all' }) });
    expect(menu?.observers[0]?.options.refetchOnWindowFocus).toBe(true);
    await act(async () => view.api().cart.clear());
  });
});

function stubScreen(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('resumen del menú: solo se monta (y consulta) en pantallas lg (P2)', () => {
  it('en móvil/tablet con productos en el carrito NO pide menú ni fichas', async () => {
    stubScreen(false);
    const spy = createSpyClient();
    const view = await renderStore(<MenuCartAside />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => {
      view.api().cart.add(SEVEN.slice(0, 3).map((id) => cartInput(id, 1)));
    });
    await act(async () => {});
    expect(spy.count('GET', /store\/(menu|products)/)).toBe(0);
    await act(async () => view.api().cart.clear());
  });

  it('en lg sí revalida (misma consulta de menú) y comparte la caché de fichas', async () => {
    stubScreen(true);
    const spy = createSpyClient();
    const view = await renderStore(<MenuCartAside />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => {
      view.api().cart.add(SEVEN.slice(0, 3).map((id) => cartInput(id, 1)));
    });
    await waitFor(() => expect(spy.count('GET', DETAIL)).toBe(3));
    expect(spy.calls.map((c) => `${c.method} ${c.path}`).filter((c) => /menu/.test(c))).toEqual([
      'GET /v1/store/menu',
    ]);
  });
});

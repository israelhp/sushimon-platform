import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { useProducts } from '../catalog/hooks';
import { queryKeys } from '../query-keys';
import { invalidateStoreAggregates } from './invalidate';
import { sameSearchScope, useStoreBootstrap, useStoreConfig, useStoreSearch } from './hooks';

function BootstrapProbe({ branchId }: { branchId: string | null }) {
  const q = useStoreBootstrap(branchId);
  return (
    <p data-testid="out">
      {q.isPending ? 'cargando' : q.isError ? 'error' : `${q.data.branchId ?? 'none'}`}
    </p>
  );
}

describe('useStoreBootstrap (F17)', () => {
  it('una sola solicitud al agregado; la clave lleva la sucursal (otra clave = otra respuesta)', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<BootstrapProbe branchId="sucursal-1" />, {
      wrapClient: spy.wrap,
    });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('sucursal-1'));
    expect(spy.count('GET', /^\/v1\/store\/bootstrap$/)).toBe(1);
    // Sin pedir por separado lo que el agregado ya trae.
    for (const rx of [
      /store\/banners/,
      /store\/categories/,
      /store\/promotions/,
      /store\/products/,
    ]) {
      expect(spy.count('GET', rx)).toBe(0);
    }
    expect(view.queryClient.getQueryData(queryKeys.store.bootstrap('sucursal-1'))).toBeDefined();
    expect(view.queryClient.getQueryData(queryKeys.store.bootstrap(null))).toBeUndefined();
  });

  it('no envía idioma: el agregado no tiene parámetro `locale` (ADR-0033)', async () => {
    const spy = createSpyClient();
    await renderStore(<BootstrapProbe branchId={null} />, { wrapClient: spy.wrap });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('none'));
    expect(spy.calls.at(-1)?.query?.locale).toBeUndefined();
  });

  it('si la sucursal guardada ya no existe (404 BRANCH_NOT_FOUND) reintenta SIN sucursal', async () => {
    const spy = createSpyClient();
    await renderStore(<BootstrapProbe branchId="sucursal-inexistente" />, {
      wrapClient: spy.wrap,
    });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('none'));
    expect(spy.count('GET', /bootstrap/)).toBe(2);
  });

  it('un error 503 STORE_BUSY llega como error (la pantalla ofrece reintentar)', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /bootstrap/);
    await renderStore(<BootstrapProbe branchId="sucursal-1" />, {
      wrapClient: spy.wrap,
    });
    await act(async () => gate.fail(new ApiError(503, 'unavailable', 'busy')));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('error'));
  });
});

describe('useStoreConfig (F17)', () => {
  function ConfigProbe() {
    const q = useStoreConfig();
    return <p data-testid="out">{q.isError ? 'error' : q.isPending ? 'cargando' : 'ok'}</p>;
  }
  it('con el adaptador http NO emite la solicitud a /store/config (no existe en la API) y muestra el estado de error', async () => {
    const seen: string[] = [];
    await renderStore(<ConfigProbe />, {
      wrapClient: (base) =>
        withShortcuts('http', async <T,>(path: string, options: RequestOptions = {}) => {
          seen.push(path);
          return base.request<T>(path, options);
        }),
    });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('error'));
    expect(seen.filter((p) => p.includes('/store/config'))).toEqual([]);
  });
  it('con el mock sigue funcionando (comportamiento simulado conservado)', async () => {
    await renderStore(<ConfigProbe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('ok'));
  });
});

function SearchProbe({ initial = '' }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const q = useStoreSearch(text, { branchId: 'sucursal-1' });
  const first = q.data?.pages[0];
  return (
    <div>
      <input aria-label="texto" value={text} onChange={(e) => setText(e.target.value)} />
      <p data-testid="status">
        {q.fetchStatus === 'idle' && !q.data ? 'inactiva' : q.isFetching ? 'buscando' : 'lista'}
      </p>
      <p data-testid="stale">{q.isPlaceholderData ? 'placeholder' : 'fresco'}</p>
      <p data-testid="total">{first ? String(first.total) : '-'}</p>
      <p data-testid="names">
        {q.data?.pages.flatMap((p) => p.items.map((i) => i.name)).join(',')}
      </p>
    </div>
  );
}

describe('useStoreSearch (F17)', () => {
  const type = (value: string) =>
    fireEvent.change(screen.getByLabelText('texto'), { target: { value } });

  it('no consulta con menos de 2 caracteres (tras recortar) y sí con 2 o más', async () => {
    const spy = createSpyClient();
    await renderStore(<SearchProbe />, { wrapClient: spy.wrap });
    type('a');
    type('  a  ');
    await act(async () => {});
    expect(spy.count('GET', /store\/search/)).toBe(0);
    expect(screen.getByTestId('status')).toHaveTextContent('inactiva');
    type(' Dy ');
    await waitFor(() => expect(spy.count('GET', /store\/search/)).toBe(1));
    // `q` canónica (recortada y en minúsculas) y sucursal en la solicitud.
    expect(spy.calls.at(-1)?.query).toMatchObject({ q: 'dy', branchId: 'sucursal-1' });
  });

  it('la clave lleva texto canónico + sucursal + filtros (mayúsculas distintas = misma entrada)', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<SearchProbe initial="DYNAMITA" />, { wrapClient: spy.wrap });
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('1'));
    expect(
      view.queryClient.getQueryData(queryKeys.store.search('sucursal-1', 'dynamita', {})),
    ).toBeDefined();
    type('dynamita');
    await act(async () => {});
    expect(spy.count('GET', /store\/search/)).toBe(1); // misma clave: sin nueva solicitud
  });

  it('cancela la solicitud vigente al cambiar el texto (AbortSignal) y una respuesta tardía NO pisa la vigente', async () => {
    const signals: AbortSignal[] = [];
    const releases: (() => void)[] = [];
    const view = await renderStore(<SearchProbe />, {
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (path === '/v1/store/search' && String(options.query?.q) === 'roll') {
            if (options.signal) signals.push(options.signal);
            // La primera búsqueda queda retenida hasta que la liberemos (respuesta TARDÍA).
            await new Promise<void>((resolve) => releases.push(resolve));
          }
          return base.request<T>(path, options);
        }),
    });
    type('roll');
    await waitFor(() => expect(signals).toHaveLength(1));
    type('dynamita');
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Dynamita Roll'));
    expect(signals[0]?.aborted).toBe(true);
    // Llega la respuesta tardía de «roll»: no cambia lo que se ve.
    await act(async () => releases.forEach((r) => r()));
    expect(screen.getByTestId('names')).toHaveTextContent('Dynamita Roll');
    expect(screen.getByTestId('total')).toHaveTextContent('1');
    void view;
  });

  it('conserva los resultados previos (placeholder) mientras llegan los nuevos', async () => {
    const spy = createSpyClient();
    await renderStore(<SearchProbe initial="dynamita" />, { wrapClient: spy.wrap });
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Dynamita Roll'));
    const gate = spy.hold('GET', /store\/search/);
    type('cangreburger');
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(screen.getByTestId('names')).toHaveTextContent('Dynamita Roll');
    expect(screen.getByTestId('stale')).toHaveTextContent('placeholder');
    await act(async () => gate.release());
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Cangreburger'));
    expect(screen.getByTestId('stale')).toHaveTextContent('fresco');
  });

  it('sin resultados = respuesta vacía (no es un error)', async () => {
    await renderStore(<SearchProbe initial="zzzz-nada" />);
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('0'));
  });
});

describe('useProducts / useStoreMenu (F17)', () => {
  function Probe({ branchId, enabled }: { branchId?: string | null; enabled?: boolean }) {
    const p = useProducts({ branchId, enabled });
    return (
      <p data-testid="out">
        {p.isPending ? 'pendiente' : p.isError ? 'error' : String(p.data?.length)}
      </p>
    );
  }

  it('carga perezosa: con enabled=false no consulta nada', async () => {
    const spy = createSpyClient();
    await renderStore(<Probe enabled={false} />, { wrapClient: spy.wrap });
    await act(async () => {});
    expect(spy.count('GET', /store\/menu/)).toBe(0);
    expect(screen.getByTestId('out')).toHaveTextContent('pendiente');
  });

  it('cambio de sucursal: otra clave, otra solicitud, sin reutilizar precios de la anterior', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('29'));
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() => expect(spy.count('GET', /store\/menu/)).toBe(2));
    const calls = spy.calls.filter((c) => c.path === '/v1/store/menu');
    expect(calls.map((c) => c.query?.branchId)).toEqual(['sucursal-1', 'sucursal-2']);
  });

  it('dos consumidores de la misma sucursal comparten UNA solicitud (deduplicación)', async () => {
    const spy = createSpyClient();
    await renderStore(
      <>
        <Probe />
        <Probe />
      </>,
      { branchId: 'sucursal-1', wrapClient: spy.wrap },
    );
    await waitFor(() => expect(screen.getAllByTestId('out')[1]).toHaveTextContent('29'));
    expect(spy.count('GET', /store\/menu/)).toBe(1);
  });
});

describe('invalidateStoreAggregates (F17)', () => {
  it('invalida los prefijos de bootstrap, menú, búsqueda y fichas (y nada más)', async () => {
    const qc = new QueryClient();
    const calls: unknown[] = [];
    qc.invalidateQueries = ((filters: { queryKey: unknown }) => {
      calls.push(filters.queryKey);
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;
    await invalidateStoreAggregates(qc);
    expect(calls).toEqual([
      ['store', 'bootstrap'],
      ['store', 'menu'],
      ['store', 'search'],
      ['products', 'store', 'detail'],
    ]);
  });

  it('las claves concretas cuelgan de esos prefijos', () => {
    const starts = (key: readonly unknown[], prefix: readonly unknown[]) =>
      prefix.every((p, i) => key[i] === p);
    expect(starts(queryKeys.store.bootstrap('b'), queryKeys.store.bootstrapAll)).toBe(true);
    expect(starts(queryKeys.store.menu('b', { page: 'all' }), queryKeys.store.menuAll)).toBe(true);
    expect(starts(queryKeys.store.search('b', 'q', {}), queryKeys.store.searchAll)).toBe(true);
    expect(starts(queryKeys.products.storeDetail('s', 'b'), queryKeys.products.storeDetails)).toBe(
      true,
    );
    // Sin sucursal se distingue de cualquier sucursal.
    expect(queryKeys.store.bootstrap(null)).not.toEqual(queryKeys.store.bootstrap('b'));
  });
});

describe('sameSearchScope (A2: nunca se conservan resultados de otra sucursal)', () => {
  const key = (branch: string | null, q: string, f = {}) => queryKeys.store.search(branch, q, f);
  it('mismo alcance si solo cambia el texto', () => {
    expect(sameSearchScope(key('a', 'ro'), key('a', 'roll'))).toBe(true);
  });
  it('distinta sucursal (incluida «sin sucursal») o distintos filtros = otro alcance', () => {
    expect(sameSearchScope(key('a', 'ro'), key('b', 'ro'))).toBe(false);
    expect(sameSearchScope(key('a', 'ro'), key(null, 'ro'))).toBe(false);
    expect(sameSearchScope(key('a', 'ro'), key('a', 'ro', { categorySlug: 'rolls' }))).toBe(false);
  });
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { MenuScreen } from './menu-screen';

let search = '';
vi.mock('next/navigation', () => ({
  usePathname: () => '/menu',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  search = '';
});

const sectionTitles = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.firstChild?.textContent ?? '');

describe('MenuScreen · categorías y URL', () => {
  it('muestra todas las secciones con su contador y los chips de categoría', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(sectionTitles()).toEqual(expect.arrayContaining(['Entradas', 'Monchis', 'Sushi Rolls']));
    const nav = screen.getByRole('navigation', { name: 'Categorías' });
    const chips = within(nav).getAllByRole('link');
    expect(chips[0]).toHaveAccessibleName('Todo');
    expect(chips[0]).toHaveAttribute('href', '/menu');
    expect(chips[0]).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: 'Sushi Rolls' })).toHaveAttribute(
      'href',
      '/menu?cat=rolls',
    );
    // Contador de Entradas = 3 productos.
    const entradas = screen.getByRole('region', { name: /^Entradas/ });
    expect(within(entradas).getByText('3')).toBeInTheDocument();
  });

  it('?cat=rolls filtra por categoría, marca el chip activo y oculta el banner de Happy Hour', async () => {
    search = 'cat=rolls';
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Sushi Rolls/ });
    expect(screen.queryByRole('heading', { name: /^Entradas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Happy Hour/ })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Categorías' });
    expect(within(nav).getByRole('link', { name: 'Sushi Rolls' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('link', { name: 'Todo' })).not.toHaveAttribute('aria-current');
  });

  it('una categoría desconocida equivale a "Todo"', async () => {
    search = 'cat=no-existe';
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.getByRole('heading', { name: /^Sushi Rolls/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todo' })).toHaveAttribute('aria-current', 'true');
  });

  it('sin sucursal elegida no hay Happy Hour que mostrar (la API lo informa por sucursal)', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.queryByRole('link', { name: /Happy Hour/ })).not.toBeInTheDocument();
  });

  it('en "Todo" muestra el acceso a Happy Hour con los días y las horas', async () => {
    await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    const banner = await screen.findByRole('link', { name: /Happy Hour/ });
    expect(banner).toHaveAttribute('href', '/promociones');
    expect(banner).toHaveTextContent(
      'Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante',
    );
  });

  it('en inglés traduce nombres, descripciones y textos', async () => {
    await renderStore(<MenuScreen />, { locale: 'en', branchId: 'sucursal-1' });
    await screen.findByRole('heading', { name: /^Starters/ });
    expect(await screen.findByRole('link', { name: /Happy Hour/ })).toHaveTextContent(
      'Monday to Thursday · 3:00 p.m. – 6:00 p.m. · Dine-in only',
    );
  });
});

describe('MenuScreen · pedido', () => {
  it('agrega con "Agregar" y cambia a control de cantidad que suma y quita', async () => {
    const view = await renderStore(<MenuScreen />);
    const add = (
      await screen.findAllByRole('button', { name: 'Agregar Dumplings a tu pedido' })
    )[0]!;
    fireEvent.click(add);
    expect(view.api().cart.quantityOf('dumplings')).toBe(1);

    const plus = (await screen.findAllByRole('button', { name: 'Agregar uno de Dumplings' }))[0]!;
    fireEvent.click(plus);
    expect(view.api().cart.quantityOf('dumplings')).toBe(2);

    const minus = screen.getAllByRole('button', { name: 'Quitar uno de Dumplings' })[0]!;
    fireEvent.click(minus);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar uno de Dumplings' })[0]!);
    expect(view.api().cart.quantityOf('dumplings')).toBe(0);
    expect(
      (await screen.findAllByRole('button', { name: 'Agregar Dumplings a tu pedido' })).length,
    ).toBeGreaterThan(0);
  });

  it('con productos en el pedido aparece la barra "Ver pedido" y el total estimado', async () => {
    const view = await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.queryByRole('button', { name: /Ver pedido/ })).not.toBeInTheDocument();
    await act(async () => view.api().cart.add('dumplings', 2));
    const bar = await screen.findByRole('button', { name: /Ver pedido/ });
    expect(bar).toHaveTextContent('2 productos · Q106');
    fireEvent.click(bar);
    expect(view.api().shell.cartOpen).toBe(true);
  });
});

describe('MenuScreen · disponibilidad', () => {
  it('product-unavailable: rotula y no permite agregar los productos no disponibles', async () => {
    await renderStore(<MenuScreen />, { scenario: 'product-unavailable', branchId: 'sucursal-1' });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(
      screen.queryByRole('button', { name: /Agregar Calientito Roll a tu pedido/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Agregar Platanito Roll a tu pedido/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Agotado').length).toBeGreaterThanOrEqual(2);
    // Los demás siguen disponibles.
    expect(
      screen.getAllByRole('button', { name: 'Agregar Dumplings a tu pedido' })[0],
    ).toBeEnabled();
  });
});

describe('MenuScreen · estados', () => {
  it('empty: estado vacío del menú', async () => {
    await renderStore(<MenuScreen />, { scenario: 'empty' });
    expect(await screen.findByText('El menú no está disponible por ahora')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Entradas/ })).not.toBeInTheDocument();
  });

  it('error: aviso con "Reintentar"', async () => {
    await renderStore(<MenuScreen />, { scenario: 'error' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('MenuScreen · categorías reales (F10)', () => {
  const navLinks = () =>
    within(screen.getByRole('navigation', { name: 'Categorías' }))
      .getAllByRole('link')
      .map((a) => a.textContent);

  it('consume GET /v1/store/categories (no el listado legado) y publica solo raíces activas, en orden', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(spy.count('GET', /^\/v1\/store\/categories$/)).toBe(1);
    expect(spy.count('GET', /^\/v1\/catalog\/categories$/)).toBe(0);
    // "Temporada" (inactiva, con un hijo activo) no existe para el público.
    expect(navLinks()).toEqual([
      'Todo',
      'Entradas',
      'Monchis',
      'Sushi Rolls',
      'Bebidas espirituosas',
      'Bebidas relax',
      'Postres',
    ]);
    expect(screen.queryByText(/Temporada|Edición limitada/)).not.toBeInTheDocument();
  });

  it('una categoría con subcategorías las muestra en una segunda navegación con "Todo en …"', async () => {
    search = 'cat=rolls';
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Sushi Rolls/ });
    const sub = screen.getByRole('navigation', { name: 'Subcategorías de Sushi Rolls' });
    const links = within(sub).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([
      'Todo en Sushi Rolls',
      'Rolls fríos',
      'Rolls tempura',
    ]);
    expect(links[0]).toHaveAttribute('aria-current', 'true');
    expect(links[1]).toHaveAttribute('href', '/menu?cat=rolls-frios');
    // La raíz queda marcada como activa en la cabecera.
    const nav = screen.getByRole('navigation', { name: 'Categorías' });
    expect(within(nav).getByRole('link', { name: 'Sushi Rolls' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('una subcategoría sin productos (F11 pendiente) muestra aviso en lugar de romper; la raíz sigue marcada', async () => {
    search = 'cat=rolls-frios';
    await renderStore(<MenuScreen />);
    expect(
      await screen.findByText('Todavía no hay productos en esta categoría.'),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Categorías' });
    expect(within(nav).getByRole('link', { name: 'Sushi Rolls' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Subcategorías de Sushi Rolls' })).getByRole(
        'link',
        {
          name: 'Rolls fríos',
        },
      ),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('categoría inactiva oculta: ni chip ni sección, y su ?cat= equivale a "Todo"', async () => {
    search = 'cat=postres';
    await renderStore(<MenuScreen />, {
      prepareStore: (store) => {
        store.menuCategories.find((c) => c.slug === 'postres')!.active = false;
      },
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(navLinks()).not.toContain('Postres');
    expect(screen.queryByRole('heading', { name: /^Postres/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todo' })).toHaveAttribute('aria-current', 'true');
  });

  it('desactivar un padre oculta también a sus hijas activas', async () => {
    search = 'cat=rolls-frios';
    await renderStore(<MenuScreen />, {
      prepareStore: (store) => {
        store.menuCategories.find((c) => c.slug === 'rolls')!.active = false;
      },
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(navLinks()).not.toContain('Sushi Rolls');
    expect(screen.queryByRole('navigation', { name: /Subcategorías/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Sushi Rolls/ })).not.toBeInTheDocument();
  });

  it('en inglés usa la traducción puente por slug y, sin ella, el nombre del restaurante', async () => {
    search = 'cat=rolls';
    await renderStore(<MenuScreen />, { locale: 'en' });
    await screen.findByRole('heading', { name: /^Sushi Rolls/ });
    expect(screen.getByRole('link', { name: 'Starters' })).toBeInTheDocument();
    const sub = screen.getByRole('navigation', { name: 'Subcategories of Sushi Rolls' });
    expect(within(sub).getByRole('link', { name: 'Cold rolls' })).toBeInTheDocument();
    expect(within(sub).getByRole('link', { name: 'All of Sushi Rolls' })).toBeInTheDocument();
  });

  it('carga: esqueleto mientras llegan las categorías', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /^\/v1\/store\/categories$/);
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    expect(screen.getByLabelText('Cargando…')).toHaveAttribute('aria-busy', 'true');
    expect(navLinks()).toEqual(['Todo']);
    await act(async () => gate.release());
    expect(await screen.findByRole('heading', { name: /^Entradas/ })).toBeInTheDocument();
  });

  it('error en las categorías: aviso con "Reintentar" que vuelve a pedirlas', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /^\/v1\/store\/categories$/);
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await act(async () => gate.fail(new ApiError(500, 'server_error', 'boom')));
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: /^Entradas/ })).toBeInTheDocument();
    expect(spy.count('GET', /^\/v1\/store\/categories$/)).toBe(2);
  });

  it('error solo en productos: las categorías siguen visibles y se ofrece reintentar', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /^\/v1\/store\/products$/);
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await act(async () => gate.fail(new ApiError(500, 'server_error', 'boom')));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(navLinks()).toContain('Sushi Rolls');
  });

  it('sin categorías visibles (empty) muestra el estado vacío', async () => {
    await renderStore(<MenuScreen />, {
      prepareStore: (store) => {
        store.menuCategories.forEach((c) => (c.active = false));
      },
    });
    expect(await screen.findByText('El menú no está disponible por ahora')).toBeInTheDocument();
  });
});

describe('MenuScreen · búsqueda en el servidor (F11)', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Buscar en el menú' });
  const productCalls = (
    spy: ReturnType<typeof createSpyClient>,
    pred: (q: Record<string, unknown>) => boolean,
  ) =>
    spy.calls.filter(
      (c) => c.method === 'GET' && /^\/v1\/store\/products$/.test(c.path) && pred(c.query ?? {}),
    ).length;

  it('busca con debounce: una sola consulta `q` tras dejar de escribir y muestra los resultados', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'dum' } });
    fireEvent.change(searchbox(), { target: { value: 'dump' } });
    expect(productCalls(spy, (q) => Boolean(q.q))).toBe(0);
    const results = await screen.findByRole('heading', { name: 'Resultados para «dump»' });
    expect(results).toBeInTheDocument();
    expect(screen.getByText(/Mostrando 2 de 2/)).toBeInTheDocument();
    expect(productCalls(spy, (q) => q.q === 'dump')).toBe(1);
    expect(productCalls(spy, (q) => q.q === 'dum')).toBe(0);
    // Al borrar el texto vuelve el menú por secciones.
    fireEvent.change(searchbox(), { target: { value: '' } });
    expect(await screen.findByRole('heading', { name: /^Entradas/ })).toBeInTheDocument();
  });

  it('sin coincidencias: estado vacío; la búsqueda ignora acentos y mayúsculas', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'zzzz' } });
    expect(await screen.findByText('Sin resultados para «zzzz»')).toBeInTheDocument();
    fireEvent.change(searchbox(), { target: { value: 'CANGREBÚRGER' } });
    expect(
      await screen.findByRole('heading', { name: 'Resultados para «CANGREBÚRGER»' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Cangreburger').length).toBeGreaterThan(0);
  });

  it('paginación «Ver más»: pide la página siguiente y acumula', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'a' } });
    await screen.findByRole('heading', { name: 'Resultados para «a»' });
    expect(screen.getByText(/Mostrando 20 de /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    await waitFor(() => expect(productCalls(spy, (q) => q.q === 'a' && q.page === 2)).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull());
  });

  it('error en la búsqueda: aviso con reintento', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    const gate = spy.hold('GET', /^\/v1\/store\/products$/);
    fireEvent.change(searchbox(), { target: { value: 'roll' } });
    await waitFor(() => expect(gate.held()).toBe(true));
    await act(async () => gate.fail(new ApiError(500, 'server_error', 'boom')));
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('heading', { name: 'Resultados para «roll»' }),
    ).toBeInTheDocument();
  });

  it('productos del menú salen del contrato: precio base en GTQ y sin los no publicados', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.queryByText('Gyoza Vegetal')).toBeNull();
    expect(screen.queryByText('Roll Edición Limitada')).toBeNull();
    expect(screen.getAllByText('Q53').length).toBeGreaterThan(0);
  });
});

/** Texto de cada tarjeta/fila del menú que muestra el producto (puede aparecer en varias secciones). */
const cardsOf = (name: string) =>
  screen
    .getAllByText(name)
    .map((el) => (el.closest('article') ?? el.closest('button'))?.textContent ?? '');

describe('MenuScreen · F13 precio y disponibilidad por sucursal', () => {
  it('muestra el precio EFECTIVO de la sucursal elegida y lo cambia al cambiar de sucursal', async () => {
    const view = await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    await screen.findByRole('region', { name: /^Sushi Rolls/ });
    expect(cardsOf('Dynamita Roll').every((text) => text.includes('Q82'))).toBe(true);
    // Sucursal 2 tiene precio especial Q86 para el mismo producto.
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() =>
      expect(cardsOf('Dynamita Roll').every((text) => text.includes('Q86'))).toBe(true),
    );
    expect(cardsOf('Dynamita Roll').some((text) => text.includes('Q82'))).toBe(false);
  });

  it('un producto agotado en la sucursal se rotula «Agotado» y su botón de agregar se deshabilita', async () => {
    const view = await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(
      screen.getAllByRole('button', { name: 'Agregar Gaseosas a tu pedido' })[0],
    ).toBeEnabled();
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    const soldOut = await screen.findAllByRole('button', {
      name: 'Gaseosas: agotado, no se puede agregar',
    });
    expect(soldOut[0]).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Agregar Gaseosas a tu pedido' }),
    ).not.toBeInTheDocument();
    expect(view.api().cart.lines).toEqual([]);
  });

  it('consulta el overlay de la sucursal elegida (GET /v1/store/menu?branchId=)', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { branchId: 'sucursal-3', wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    const call = spy.calls.find((c) => c.path === '/v1/store/menu');
    expect(call?.query).toMatchObject({ branchId: 'sucursal-3' });
  });

  it('sin sucursal elegida no pide el overlay y muestra el precio base', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(spy.calls.some((c) => c.path === '/v1/store/menu')).toBe(false);
  });

  it('si el overlay falla muestra los precios base con aviso (el menú no se rompe) y permite reintentar', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /\/v1\/store\/menu/);
    await renderStore(<MenuScreen />, { branchId: 'sucursal-2', wrapClient: spy.wrap });
    await waitFor(() => expect(gate.held()).toBe(true));
    await act(async () => gate.fail(new ApiError(0, 'offline', 'sin conexión')));
    expect(await screen.findByText(/No pudimos cargar los precios/)).toBeVisible();
    await screen.findByRole('region', { name: /^Sushi Rolls/ });
    expect(cardsOf('Dynamita Roll').every((text) => text.includes('Q82'))).toBe(true);
  });
});

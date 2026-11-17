import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { createSpyClient } from '@/test/spy-client';
import { cartInput } from '@/test/cart';
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
    const view = await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    const add = (
      await screen.findAllByRole('button', { name: 'Agregar Dumplings a tu pedido' })
    )[0]!;
    fireEvent.click(add);
    // F18: la tarjeta consulta la ficha (¿tiene extras?) antes de agregar.
    await waitFor(() => expect(view.api().cart.quantityOf('dumplings')).toBe(1));

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
    const view = await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.queryByRole('button', { name: /Ver pedido/ })).not.toBeInTheDocument();
    await act(async () => view.api().cart.add(cartInput('dumplings', 2)));
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
    expect(screen.getByText('Cargando…').closest('[aria-busy="true"]')).not.toBeNull();
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
    const gate = spy.hold('GET', /^\/v1\/store\/menu$/);
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
      (c) => c.method === 'GET' && /^\/v1\/store\/search$/.test(c.path) && pred(c.query ?? {}),
    ).length;

  it('busca con debounce: una sola consulta `q` tras dejar de escribir y muestra los resultados', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'dum' } });
    fireEvent.change(searchbox(), { target: { value: 'dump' } });
    // El debounce retrasa la PETICIÓN (no hubo ninguna por tecla).
    expect(productCalls(spy, (q) => Boolean(q.q))).toBe(0);
    const results = await screen.findByRole('heading', { name: 'Resultados para «dump»' });
    expect(results).toBeInTheDocument();
    expect(screen.getAllByText(/Mostrando 2 de 2/).length).toBeGreaterThan(0);
    // Un solo `role=status` permanente anuncia el resultado (no se montan regiones con contenido).
    const announcers = screen
      .getAllByRole('status')
      .filter((el) => /Mostrando/.test(el.textContent ?? ''));
    expect(announcers).toHaveLength(1);
    expect(productCalls(spy, (q) => q.q === 'dump')).toBe(1);
    expect(productCalls(spy, (q) => q.q === 'dum')).toBe(0);
    // Al borrar el texto vuelve el menú por secciones.
    fireEvent.change(searchbox(), { target: { value: '' } });
    expect(await screen.findByRole('heading', { name: /^Entradas/ })).toBeInTheDocument();
  });

  it('con 1 solo carácter no se consulta al servidor: aviso «escribe al menos 2» y el menú sigue visible', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'a' } });
    expect(screen.getByText('Escribe al menos 2 caracteres para buscar.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Entradas/ })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(productCalls(spy, () => true)).toBe(0);
  });

  it('sin coincidencias: estado vacío; la búsqueda ignora acentos y mayúsculas', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    fireEvent.change(searchbox(), { target: { value: 'zzzz' } });
    expect((await screen.findAllByText('Sin resultados para «zzzz»')).length).toBeGreaterThan(0);
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
    fireEvent.change(searchbox(), { target: { value: 'de' } });
    await screen.findByRole('heading', { name: 'Resultados para «de»' });
    expect(screen.getAllByText(/Mostrando 20 de /).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    await waitFor(() => expect(productCalls(spy, (q) => q.q === 'de' && q.page === 2)).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull());
  });

  it('error en la búsqueda: aviso con reintento', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    const gate = spy.hold('GET', /^\/v1\/store\/search$/);
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

  it('sin sucursal elegida pide el menú SIN branchId (precio base, available=null)', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    const menuCalls = spy.calls.filter((c) => c.path === '/v1/store/menu');
    expect(menuCalls).toHaveLength(1);
    expect(menuCalls[0]?.query?.branchId).toBeUndefined();
  });

  it('F17: el menú ya NO carga el catálogo completo ni pide el overlay aparte (una solicitud de menú)', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(spy.count('GET', /^\/v1\/store\/products$/)).toBe(0);
    expect(spy.count('GET', /^\/v1\/store\/menu$/)).toBe(1);
  });

  it('si el menú de la sucursal falla NO se mezclan precios base: error con reintento y, al reintentar, los precios de ESA sucursal', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /\/v1\/store\/menu/);
    await renderStore(<MenuScreen />, { branchId: 'sucursal-2', wrapClient: spy.wrap });
    await waitFor(() => expect(gate.held()).toBe(true));
    await act(async () => gate.fail(new ApiError(0, 'offline', 'sin conexión')));
    const alert = await screen.findByRole('alert');
    expect(screen.queryByText('Q82')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('region', { name: /^Sushi Rolls/ });
    expect(cardsOf('Dynamita Roll').every((text) => text.includes('Q86'))).toBe(true);
  });
});

describe('MenuScreen · búsqueda: sucursal, accesibilidad y errores (F17, revisión UX)', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Buscar en el menú' });
  const type = (value: string) => fireEvent.change(searchbox(), { target: { value } });

  it('región role=status PERMANENTE (una sola, montada desde el inicio) y campo dentro de role=search', async () => {
    await renderStore(<MenuScreen />, { branchId: 'sucursal-1' });
    const status = screen.getAllByRole('status').filter((el) => el.className.includes('sr-only'));
    expect(status).toHaveLength(1);
    const region = status[0]!;
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(region).toHaveTextContent('Menú de Sucursal 1');
    expect(screen.getByRole('search')).toContainElement(searchbox());
  });

  it('el aviso de mínimo 2 caracteres se asocia al campo con aria-describedby', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(searchbox()).not.toHaveAttribute('aria-describedby');
    type('a');
    const hint = screen.getByText('Escribe al menos 2 caracteres para buscar.');
    expect(searchbox().getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('cambiar el TEXTO conserva los resultados previos de la misma sucursal pero INERT, con «Actualizando…» y sin atenuar el texto', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('dynamita');
    await screen.findByRole('heading', { name: 'Resultados para «dynamita»' });
    expect(screen.getByText('Resultados en Sucursal 1')).toBeVisible();
    const gate = spy.hold('GET', /^\/v1\/store\/search$/);
    type('cangreburger');
    await waitFor(() => expect(gate.held()).toBe(true));
    const section = screen.getByRole('region', { name: /Resultados para/ });
    const card = within(section).getByText('Dynamita Roll');
    expect(card.closest('[inert]')).not.toBeNull();
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).getByText('Actualizando resultados…')).toBeVisible();
    // El texto NO se atenúa (nada de opacity sobre el contenido).
    expect(section.className).not.toMatch(/opacity/);
    await act(async () => gate.release());
    await within(await screen.findByRole('region', { name: /Resultados para/ })).findByText(
      'Cangreburger',
    );
  });

  it('A2: cambiar de SUCURSAL descarta los resultados de la anterior (ninguna tarjeta ni precio de A, ni «Ver más») hasta que llegan los de B', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<MenuScreen />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('dynamita');
    await screen.findByRole('heading', { name: 'Resultados para «dynamita»' });
    expect(screen.getAllByText('Q82').length).toBeGreaterThan(0);
    const gate = spy.hold('GET', /^\/v1\/store\/search$/);
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() => expect(gate.held()).toBe(true));
    // Mientras llega la búsqueda de B: esqueleto; nada de A (ni Q82, ni la tarjeta, ni «Ver más»).
    expect(screen.queryByText('Q82')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Resultados para «dynamita»' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dynamita Roll')).not.toBeInTheDocument();
    await act(async () => gate.release());
    await screen.findByRole('heading', { name: 'Resultados para «dynamita»' });
    expect(screen.getByText('Resultados en Sucursal 2')).toBeVisible();
    expect(screen.getAllByText('Q86').length).toBeGreaterThan(0);
    expect(screen.queryByText('Q82')).not.toBeInTheDocument();
  });

  it('M1: al cambiar de sucursal el campo de búsqueda sigue MONTADO (mismo nodo, conserva texto y foco) y se anuncia «Menú de …»', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<MenuScreen />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    const input = searchbox();
    input.focus();
    type('a');
    const gate = spy.hold('GET', /^\/v1\/store\/menu$/);
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(screen.getByRole('searchbox', { name: 'Buscar en el menú' })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue('a');
    await act(async () => gate.release());
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.getAllByText('Menú de Sucursal 2').length).toBeGreaterThan(0);
  });

  it('el menú y la ficha tampoco mezclan sucursales: al cambiar no queda ningún precio de la anterior', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<MenuScreen />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await screen.findByRole('region', { name: /^Sushi Rolls/ });
    expect(screen.getAllByText(/Q82/).length).toBeGreaterThan(0);
    const gate = spy.hold('GET', /^\/v1\/store\/menu$/);
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(screen.queryByText(/Q82/)).not.toBeInTheDocument();
    await act(async () => gate.release());
    await screen.findByRole('region', { name: /^Sushi Rolls/ });
    expect(screen.queryByText(/Q82/)).not.toBeInTheDocument();
  });

  it('M3: «Ver más» usa aria-disabled (no disabled) mientras carga y al llegar la página el foco va al contador', async () => {
    const spy = createSpyClient();
    await renderStore(<MenuScreen />, { wrapClient: spy.wrap });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('de');
    await screen.findByRole('heading', { name: 'Resultados para «de»' });
    const more = screen.getByRole('button', { name: 'Ver más' });
    const gate = spy.hold('GET', /^\/v1\/store\/search$/);
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(gate.held()).toBe(true));
    const busy = screen.getByRole('button', { name: 'Cargando…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    await act(async () => gate.release());
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/Mostrando \d+ de/));
  });

  it('M3: si falla la página siguiente, los resultados cargados se conservan y aparece el aviso bajo la lista con reintento', async () => {
    let calls = 0;
    await renderStore(<MenuScreen />, {
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (
            path === '/v1/store/search' &&
            Number(options.query?.page ?? 1) === 2 &&
            calls++ === 0
          ) {
            throw new ApiError(500, 'server_error', 'boom');
          }
          return base.request<T>(path, options);
        }),
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('de');
    await screen.findByRole('heading', { name: 'Resultados para «de»' });
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar más resultados.');
    expect(screen.getAllByText(/Mostrando 20 de/).length).toBeGreaterThan(0);
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getAllByText(/Mostrando 2\d de/).length).toBeGreaterThan(0);
  });

  it('B1: 429 → mensaje propio y «Reintentar» inactivo (aria-disabled) los segundos de Retry-After; luego se habilita', async () => {
    let limited = true;
    let searches = 0;
    await renderStore(<MenuScreen />, {
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (path === '/v1/store/search') {
            searches++;
            if (limited)
              throw new ApiError(
                429,
                'too_many_requests',
                'límite',
                undefined,
                undefined,
                undefined,
                undefined,
                1,
              );
          }
          return base.request<T>(path, options);
        }),
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('roll');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Hiciste muchas búsquedas seguidas');
    const retry = within(alert).getByRole('button');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(retry);
    expect(searches).toBe(1);
    limited = false;
    await waitFor(
      () =>
        expect(within(screen.getByRole('alert')).getByRole('button')).not.toHaveAttribute(
          'aria-disabled',
        ),
      { timeout: 4000 },
    );
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: 'Resultados para «roll»' });
  });

  it('B1: sin conexión y servicio no disponible tienen mensajes distintos', async () => {
    let status = 0;
    await renderStore(<MenuScreen />, {
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (path === '/v1/store/search')
            throw new ApiError(status, status === 0 ? 'offline' : 'server_error', 'x');
          return base.request<T>(path, options);
        }),
    });
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('roll');
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay conexión');
    status = 503;
    type('rollo');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('no está disponible por un momento'),
    );
  });

  it('M8: el botón de limpiar mide ≥ 44 px y devuelve el foco al campo', async () => {
    await renderStore(<MenuScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    type('roll');
    const clear = screen.getByRole('button', { name: 'Limpiar búsqueda' });
    expect(clear.className).toMatch(/h-11/);
    expect(clear.className).toMatch(/w-11/);
    fireEvent.click(clear);
    expect(document.activeElement).toBe(searchbox());
    expect(searchbox()).toHaveValue('');
  });
});

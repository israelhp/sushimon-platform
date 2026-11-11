import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('en "Todo" muestra el acceso a Happy Hour con los días y las horas', async () => {
    await renderStore(<MenuScreen />);
    const banner = await screen.findByRole('link', { name: /Happy Hour/ });
    expect(banner).toHaveAttribute('href', '/promociones');
    expect(banner).toHaveTextContent(
      'Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante',
    );
  });

  it('en inglés traduce nombres, descripciones y textos', async () => {
    await renderStore(<MenuScreen />, { locale: 'en' });
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
    await renderStore(<MenuScreen />, { scenario: 'product-unavailable' });
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(
      screen.queryByRole('button', { name: /Agregar Calientito Roll a tu pedido/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Agregar Platanito Roll a tu pedido/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('No disponible por ahora').length).toBeGreaterThanOrEqual(2);
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

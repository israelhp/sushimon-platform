import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartInput } from '@/test/cart';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { MobileNav } from './MobileNav';
import { StoreHeader } from './StoreHeader';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
// Cambiar idioma/tema usa Server Actions y ThemeProvider: no son parte de esta prueba.
vi.mock('@/i18n/LocaleToggle', () => ({
  LocaleToggle: () => <div role="group" aria-label="Idioma" />,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">tema</button>,
}));

beforeEach(() => {
  pathname = '/';
});

describe('StoreHeader', () => {
  it('marca la ruta activa con aria-current y enlaza a las rutas reales', async () => {
    pathname = '/menu';
    await renderStore(<StoreHeader />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Menú' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Menú' })).toHaveAttribute('href', '/menu');
    expect(within(nav).getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Promos' })).toHaveAttribute(
      'href',
      '/promociones',
    );
    expect(within(nav).getByRole('link', { name: 'Más' })).toHaveAttribute('href', '/mas');
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/cuenta');
  });

  it('Más se resalta en cuenta y pedidos; Pedido abre el carrito y toma el resaltado', async () => {
    const user = userEvent.setup();
    pathname = '/cuenta/direcciones';
    const view = await renderStore(<StoreHeader />);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Más' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(nav).getByRole('button', { name: /Ver tu pedido/ }));
    expect(view.api().shell.cartOpen).toBe(true);
    expect(within(nav).getByRole('link', { name: 'Más' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('button', { name: /Ver tu pedido/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('muestra la cantidad del carrito y "Iniciar pedido" abre la hoja de modo de pedido', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<StoreHeader />);
    await act(async () => {
      view.api().cart.add(cartInput('california-roll', 2));
      view.api().cart.add(cartInput('dumplings', 1));
    });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav).getByRole('button', { name: 'Ver tu pedido, 3 productos' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Iniciar pedido/ }));
    expect(view.api().shell.orderSheet).toBe(true);
  });

  it('con el modo elegido muestra «A domicilio» y la dirección elegida', async () => {
    const view = await renderStore(<StoreHeader />);
    await act(async () => {
      view.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-1',
        address: {
          department: 'Guatemala',
          municipality: 'Guatemala',
          zone: '10',
          line: '6a avenida 10-50',
          references: '',
        },
      });
    });
    expect(
      screen.getByRole('button', {
        name: 'Cambiar la dirección de entrega: A domicilio 6a avenida 10-50, Guatemala',
      }),
    ).toBeInTheDocument();
  });
});

describe('MobileNav', () => {
  it('resalta la ruta activa y no marca nada cuando el carrito está abierto', async () => {
    pathname = '/promociones';
    const view = await renderStore(<MobileNav />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: /Promos/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: /Inicio/ })).not.toHaveAttribute('aria-current');
    await act(async () => view.api().shell.openCart());
    expect(within(nav).getByRole('link', { name: /Promos/ })).not.toHaveAttribute('aria-current');
  });
});

describe('contadores del carrito en UNIDADES (#27)', () => {
  it('el encabezado y la barra móvil cuentan unidades (no líneas), sin llamadas HTTP', async () => {
    const spy = createSpyClient();
    const view = await renderStore(
      <>
        <StoreHeader />
        <MobileNav />
      </>,
      { wrapClient: spy.wrap },
    );
    await act(async () => {
      view
        .api()
        .cart.add([
          cartInput('california-roll', 5),
          cartInput('dumplings', 2),
          cartInput('dumplings', 1, 'x'),
        ]);
    });
    const header = within(screen.getByRole('navigation', { name: 'Principal' }));
    const mobile = within(screen.getByRole('navigation', { name: 'Navegación principal' }));
    expect(header.getByRole('button', { name: 'Ver tu pedido, 8 productos' })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: 'Ver tu pedido, 8 productos' })).toBeInTheDocument();
    expect(view.api().cart.lines).toHaveLength(3);
    // Actualizar el contador no pide nada a la red.
    expect(spy.calls.filter((c) => /store\/(menu|products)/.test(c.path))).toHaveLength(0);
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { PromosScreen } from './promos-screen';

vi.mock('next/navigation', () => ({
  usePathname: () => '/promociones',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('PromosScreen · promociones por sucursal', () => {
  it('Happy Hour: días, horas, condición, aviso legal y precios indicativos agrupados por categoría', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1' });
    const section = await screen.findByRole('region', { name: 'Happy Hour' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Promociones y Happy Hour');
    const chips = within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(chips).toEqual(
      expect.arrayContaining([
        'Lunes a jueves',
        '3:00 p. m. – 6:00 p. m.',
        '25 % de descuento',
        'Válido solo en restaurante',
      ]),
    );
    // El reloj de la demo (miércoles 14:25) está antes de las 15:00: lo dice el servidor.
    expect(within(section).getByText('Hoy a partir de las 3:00 p. m.')).toHaveAttribute(
      'data-phase',
      'upcoming',
    );
    // Dumplings Q53.00 − 25 % = Q39.75 (la API calculó el indicativo; la UI solo lo muestra).
    const dumplings = (await within(section).findByRole('heading', { name: 'Dumplings' })).closest(
      'article',
    )!;
    const headings = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(['Entradas', 'Sushi Rolls']));
    expect(within(dumplings).getByText('Q39.75')).toBeInTheDocument();
    expect(within(dumplings).getByText('Q53.00')).toBeInTheDocument();
    expect(screen.getByText(/precios promocionales son indicativos/i)).toBeInTheDocument();
    expect(screen.getByText(/no a extras ni modificadores/)).toBeInTheDocument();
  });

  it('cupón: «Requiere código», sin código ni descuento en la página', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1' });
    const coupons = await screen.findByRole('region', { name: 'Cupones' });
    const card = within(coupons).getByText('Cupón de bienvenida').closest('li')!;
    expect(within(card).getByText('Requiere código')).toBeInTheDocument();
    expect(within(card).queryByText(/% de descuento/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('BIENVENIDO10');
  });

  it('promociones por sucursal: la 2 ve «Fin de mes»; la 3 no; las próximas traen su fecha de inicio', async () => {
    const view = await renderStore(<PromosScreen />, { branchId: 'sucursal-2' });
    const live = await screen.findByRole('region', { name: 'Vigentes ahora' });
    expect(within(live).getByText('Fin de mes: bebidas')).toBeInTheDocument();
    expect(within(live).getByText('Vigente hasta el 30 de noviembre')).toBeInTheDocument();
    const soon = screen.getByRole('region', { name: 'Próximamente' });
    expect(within(soon).getByText('Navidad en rolls')).toBeInTheDocument();
    expect(within(soon).getByText('Empieza el 20 de noviembre')).toBeInTheDocument();
    view.unmount();

    await renderStore(<PromosScreen />, { branchId: 'sucursal-3' });
    await screen.findByRole('region', { name: 'Happy Hour' });
    expect(screen.queryByText('Fin de mes: bebidas')).not.toBeInTheDocument();
  });

  it('no muestra promociones vencidas ni inactivas', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1' });
    await screen.findByRole('region', { name: 'Happy Hour' });
    expect(screen.queryByText('Semana del cliente')).not.toBeInTheDocument();
    expect(screen.queryByText('Combo Mon para 2')).not.toBeInTheDocument();
  });

  it('escenario promotion-expired: estado vacío con enlace al menú', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1', scenario: 'promotion-expired' });
    expect(await screen.findByText('No hay promociones vigentes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir del menú regular' })).toHaveAttribute(
      'href',
      '/menu',
    );
  });

  it('cambiar de sucursal vuelve a pedir las promociones de la nueva', async () => {
    const spy = createSpyClient();
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await screen.findByRole('region', { name: 'Happy Hour' });
    fireEvent.change(screen.getByLabelText('Sucursal'), { target: { value: 'sucursal-2' } });
    await screen.findByRole('region', { name: 'Vigentes ahora' });
    const calls = spy.calls.filter((c) => c.path === '/v1/store/promotions');
    expect(new Set(calls.map((c) => c.query?.branchId))).toEqual(
      new Set(['sucursal-1', 'sucursal-2']),
    );
  });

  it('error de carga: aviso con reintento', async () => {
    let failing = true;
    await renderStore(<PromosScreen />, {
      branchId: 'sucursal-1',
      wrapClient: (client) =>
        withShortcuts('mock', async <T,>(path: string, options?: RequestOptions) => {
          if (failing && path === '/v1/store/promotions') {
            throw new ApiError(500, 'server_error', 'Falla');
          }
          return client.request<T>(path, options);
        }),
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('region', { name: 'Happy Hour' })).toBeInTheDocument();
  });

  it('en inglés traduce los textos', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1', locale: 'en' });
    const section = await screen.findByRole('region', { name: 'Happy Hour' });
    expect(within(section).getByText('Monday to Thursday')).toBeInTheDocument();
    expect(within(section).getByText('25% off')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Coupons' })).toBeInTheDocument();
  });

  it('ofrece cómo llegar y volver al menú regular', async () => {
    await renderStore(<PromosScreen />, { branchId: 'sucursal-1' });
    expect(await screen.findByRole('link', { name: 'Cómo llegar · Google Maps' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getByRole('link', { name: 'Abrir en Waze' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir del menú regular' })).toHaveAttribute(
      'href',
      '/menu',
    );
  });
});

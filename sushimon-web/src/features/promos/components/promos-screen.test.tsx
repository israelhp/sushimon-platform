import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { PromosScreen } from './promos-screen';

vi.mock('next/navigation', () => ({
  usePathname: () => '/promociones',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('PromosScreen · Happy Hour', () => {
  it('muestra días, horas, condición, aviso legal y los grupos con sus ítems', async () => {
    await renderStore(<PromosScreen />);
    await screen.findByRole('heading', { name: /^Entradas/ });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Happy Hour');
    expect(
      screen.getByText('Tu monchis favorito, a un precio que te encanta.'),
    ).toBeInTheDocument();
    const chips = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual(
      expect.arrayContaining([
        'Lunes a jueves',
        '3:00 p. m. – 6:00 p. m.',
        'Válido solo en restaurante',
      ]),
    );
    expect(
      screen.getByText(/Promoción vigente de lunes a jueves de 3:00 a 6:00 p\. m\./),
    ).toHaveTextContent('Válida solo para consumo en restaurante; no aplica a pedidos en línea.');

    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(['Entradas', 'Rolls', 'Cervezas']);
    const entradas = screen.getByRole('region', { name: 'Entradas' });
    expect(within(entradas).getAllByRole('article')).toHaveLength(2);
    expect(within(entradas).getByText('Papas Mon Locas')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Rolls' })).getAllByRole('article'),
    ).toHaveLength(5);
    const cervezas = screen.getByRole('region', { name: 'Cervezas' });
    expect(within(cervezas).getByText('2 x Q50')).toBeInTheDocument();
    expect(within(cervezas).getByText('Solo en restaurante')).toBeInTheDocument();
  });

  it('con el reloj de la demo (miércoles 14:25) está "próxima hoy" a las 3:00 p. m.', async () => {
    await renderStore(<PromosScreen />);
    const status = await screen.findByText('Hoy a partir de las 3:00 p. m.');
    expect(status).toHaveAttribute('data-phase', 'today');
  });

  it('ofrece cómo llegar y volver al menú regular', async () => {
    await renderStore(<PromosScreen />);
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

  it('en inglés traduce días, grupos y nombres', async () => {
    await renderStore(<PromosScreen />, { locale: 'en' });
    await screen.findByRole('heading', { name: 'Starters' });
    expect(screen.getByText('Monday to Thursday')).toBeInTheDocument();
    expect(screen.getByText('Local beers')).toBeInTheDocument();
    expect(screen.getByText('Today from 3:00 p.m.')).toBeInTheDocument();
  });
});

describe('PromosScreen · estados', () => {
  it('promotion-expired: avisa que finalizó y atenúa los precios', async () => {
    await renderStore(<PromosScreen />, { scenario: 'promotion-expired' });
    const status = await screen.findByText(/^Finalizó el /);
    expect(status).toHaveAttribute('data-phase', 'expired');
    expect(
      screen.getByText(
        'Esta promoción ya finalizó. Mirá el menú regular para ver los precios vigentes.',
      ),
    ).toHaveClass('notice-warn');
    expect(screen.queryByText('Hoy a partir de las 3:00 p. m.')).not.toBeInTheDocument();
  });

  it('empty: sin promociones ofrece ir al menú regular', async () => {
    await renderStore(<PromosScreen />, { scenario: 'empty' });
    expect(await screen.findByText('No hay promociones vigentes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir del menú regular' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('error: aviso con "Reintentar"', async () => {
    await renderStore(<PromosScreen />, { scenario: 'error' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

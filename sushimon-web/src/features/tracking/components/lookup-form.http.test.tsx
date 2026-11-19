import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { createHarness } from '@/mocks/testing';
import { renderStore } from '@/test/store-providers';
import { LookupForm } from './lookup-form';

vi.mock('next/navigation', () => ({
  usePathname: () => '/consultar',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

/** F21 (P62) · `/consultar` con la API real: aviso honesto, sin formulario ni solicitudes; en mock se conserva el formulario. */
describe('LookupForm según la fuente de datos', () => {
  it('http: aviso honesto, sin formulario de número + teléfono y sin llamar a lookup', async () => {
    const h = createHarness();
    const paths: string[] = [];
    const client: DataClient = withShortcuts(
      'http',
      async <T,>(path: string, o?: RequestOptions) => {
        paths.push(path);
        return h.client.request<T>(path, o);
      },
    );
    await renderStore(<LookupForm />, { wrapClient: () => client });
    expect(screen.getByTestId('lookup-deferred')).toBeInTheDocument();
    expect(
      screen.getByText(/no podemos buscar un pedido con su número y teléfono/i),
    ).toBeInTheDocument();
    // M6: sin sesión ni la pestaña original, se orienta a contactar a la sucursal; no hay enlaces a pantallas sin API real.
    expect(screen.getByText(/contacta a la sucursal/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /pedidos|sesión/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Número de pedido')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Teléfono')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar' })).not.toBeInTheDocument();
    expect(paths.some((p) => p.includes('lookup'))).toBe(false);
  });

  it('mock: se conserva el formulario simulado', async () => {
    await renderStore(<LookupForm />);
    expect(screen.getByLabelText('Número de pedido')).toBeInTheDocument();
    expect(screen.queryByTestId('lookup-deferred')).not.toBeInTheDocument();
  });
});

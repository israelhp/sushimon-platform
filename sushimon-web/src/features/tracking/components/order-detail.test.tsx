import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { OrderDetail } from './order-detail';

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/pedidos/MON-490217',
  useRouter: () => router,
}));

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

/** Renderiza el seguimiento con la cuenta de demostración (dueña de los 3 pedidos sembrados). */
async function renderOrder(orderId: string, { signedIn = true } = {}) {
  const view = await renderStore(<div />);
  if (signedIn) await act(async () => view.api().session.signInCustomer(DEMO));
  view.rerender(<OrderDetail orderId={orderId} />);
  return view;
}

const stepsOf = () =>
  within(screen.getByRole('list', { name: 'Progreso del pedido' })).getAllByRole('listitem');

describe('OrderDetail (seguimiento)', () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
  });

  it('a domicilio muestra 6 pasos como lista ordenada con el paso actual marcado', async () => {
    await renderOrder('MON-490217');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'MON-490217' }),
    ).toBeInTheDocument();
    const steps = stepsOf();
    expect(steps).toHaveLength(6);
    expect(screen.getByRole('list', { name: 'Progreso del pedido' }).tagName).toBe('OL');
    const current = steps.filter((s) => s.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(steps[0]).toHaveTextContent('Pedido recibido');
    expect(steps[5]).toHaveTextContent('Entregado');
  });

  it('para recoger muestra 5 pasos y, entregado, ninguno queda como actual', async () => {
    await renderOrder('MON-482193');
    await screen.findByRole('heading', { level: 1, name: 'MON-482193' });
    const steps = stepsOf();
    expect(steps).toHaveLength(5);
    expect(steps[3]).toHaveTextContent('Listo para recoger');
    expect(steps[4]).toHaveTextContent('Recogido');
    expect(steps.some((s) => s.hasAttribute('aria-current'))).toBe(false);
    // Pedido terminado: sin botón de demostración.
    expect(screen.queryByRole('button', { name: /siguiente estado/i })).not.toBeInTheDocument();
  });

  it('muestra datos de entrega, productos, totales y el reclamo prellenado por WhatsApp', async () => {
    await renderOrder('MON-490217');
    await screen.findByRole('heading', { level: 1, name: 'MON-490217' });
    expect(screen.getByText('Dirección de entrega')).toBeInTheDocument();
    expect(
      screen.getByText(/6a avenida 10-50, Edificio Demo, apto\. 3, zona 10/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tarjeta de crédito o débito — NeoNet \(Demo\)/)).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    const wa = await screen.findByRole('link', { name: /Reportar por WhatsApp/ });
    const href = wa.getAttribute('href') ?? '';
    expect(href).toMatch(/^https:\/\/wa\.me\/50239999431\?text=/);
    expect(decodeURIComponent(href)).toContain('Pedido: MON-490217');
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Reportar el problema en la app' })).toHaveAttribute(
      'href',
      '/incidencias/nuevo?pedido=MON-490217',
    );
  });

  it('el botón de demostración está rotulado como simulación y avanza el progreso un paso', async () => {
    const user = userEvent.setup();
    await renderOrder('MON-490217');
    await screen.findByRole('heading', { level: 1, name: 'MON-490217' });
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
    const indexOfCurrent = () =>
      stepsOf().findIndex((s) => s.getAttribute('aria-current') === 'step');
    const before = indexOfCurrent();
    // recibido → aceptado → en preparación → listo: el 3.er avance cambia de paso visible.
    for (let i = 0; i < 3; i++) {
      const button = screen.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
      await waitFor(() => expect(button).toBeEnabled());
    }
    await waitFor(() => expect(indexOfCurrent()).toBe(before + 1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un pedido que la sesión no puede ver lleva a la consulta de invitado (sin revelar si existe)', async () => {
    await renderOrder('MON-490217', { signedIn: false });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/consultar?pedido=MON-490217&notfound=1'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos mostrar este pedido/);
  });

  it('un pedido inexistente da exactamente la misma respuesta que uno ajeno', async () => {
    await renderOrder('MON-000000');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/consultar?pedido=MON-000000&notfound=1'),
    );
  });

  it('error de red: aviso accesible con reintento y sin redirigir', async () => {
    const view = await renderStore(<div />, { scenario: 'offline' });
    view.rerender(<OrderDetail orderId="MON-490217" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { IncidentForm } from './incident-form';
import { IncidentsHub } from './incidents-hub';

vi.mock('next/navigation', () => ({
  usePathname: () => '/incidencias/nuevo',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

async function renderSignedIn(ui: React.ReactElement) {
  const view = await renderStore(<div />);
  await act(async () => view.api().session.signInCustomer(DEMO));
  view.rerender(ui);
  return view;
}

describe('IncidentForm (reclamo en la app)', () => {
  it('enviar vacío muestra todos los errores, enfoca el primer grupo inválido y no envía', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<IncidentForm orderId="MON-490217" />);
    await user.click(await screen.findByRole('button', { name: 'Enviar incidencia' }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([
        'Elegí qué pasó',
        'Contanos un poco más (mínimo 10 caracteres)',
        'Elegí una opción',
      ]),
    );
    expect(screen.getByRole('radio', { name: 'Faltó un producto' })).toHaveFocus();
    expect(screen.queryByText('¡Recibimos tu reporte!')).not.toBeInTheDocument();
  });

  it('"faltó un producto" exige marcar al menos un producto y la descripción enlaza su error', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<IncidentForm orderId="MON-490217" />);
    await user.click(await screen.findByRole('radio', { name: 'Faltó un producto' }));
    await user.type(screen.getByLabelText('Describí el problema'), 'Faltó la salsa del roll');
    await user.click(screen.getByRole('radio', { name: 'Reembolso' }));
    await user.click(screen.getByRole('button', { name: 'Enviar incidencia' }));
    expect(screen.getByText('Marcá al menos un producto')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Calientito Roll' })).toHaveFocus();
  });

  it('un reclamo válido se envía y confirma con el número de incidencia', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<IncidentForm orderId="MON-490217" />);
    await user.click(await screen.findByRole('radio', { name: 'Faltó un producto' }));
    await user.click(screen.getByRole('checkbox', { name: 'Calientito Roll' }));
    const description = screen.getByLabelText('Describí el problema');
    await user.type(description, 'Faltó la salsa del roll');
    expect(screen.getByText('23/500')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Reposición del producto' }));
    await user.click(screen.getByRole('button', { name: 'Enviar incidencia' }));
    const title = await screen.findByText('¡Recibimos tu reporte!');
    const done = title.closest<HTMLElement>('[role="status"]')!;
    expect(done).not.toBeNull();
    expect(within(done).getByText('¡Recibimos tu reporte!')).toBeInTheDocument();
    expect(within(done).getByText(/^INC-\d+$/)).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: 'Ver pedido' })).toHaveAttribute(
      'href',
      '/pedidos/MON-490217',
    );
  });

  it('avisa si el pedido ya tiene una incidencia abierta tras enviar una', async () => {
    const user = userEvent.setup();
    const view = await renderSignedIn(<IncidentForm orderId="MON-490217" />);
    await user.click(await screen.findByRole('radio', { name: 'Demora o no llegó' }));
    await user.type(screen.getByLabelText('Describí el problema'), 'Llegó muy tarde el pedido');
    await user.click(screen.getByRole('radio', { name: 'Solo quiero informar' }));
    await user.click(screen.getByRole('button', { name: 'Enviar incidencia' }));
    await screen.findByText('¡Recibimos tu reporte!');
    // Un segundo reclamo del mismo pedido: el formulario avisa de la abierta.
    view.rerender(<IncidentForm orderId="MON-490217" key="again" />);
    expect(
      await screen.findByText(/ya tiene una incidencia abierta \(INC-\d+\)/),
    ).toBeInTheDocument();
  });

  it('un pedido que la sesión no puede ver ofrece consultarlo (sin revelar si existe)', async () => {
    await renderStore(<IncidentForm orderId="MON-490217" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos abrir este pedido con tu sesión.');
    expect(within(alert).getByRole('link')).toHaveAttribute(
      'href',
      '/consultar?pedido=MON-490217&notfound=1',
    );
  });

  it('sin pedido elegido ofrece los pedidos de la cuenta y "es otro pedido"', async () => {
    await renderSignedIn(<IncidentForm orderId={null} />);
    expect(await screen.findByRole('link', { name: /MON-490217/ })).toHaveAttribute(
      'href',
      '/incidencias/nuevo?pedido=MON-490217',
    );
    expect(screen.getByRole('link', { name: 'Es otro pedido' })).toHaveAttribute(
      'href',
      '/consultar?next=incidencia',
    );
  });
});

describe('IncidentsHub (reclamo por WhatsApp)', () => {
  it('invitado sin pedidos en el dispositivo: estado vacío y alternativas', async () => {
    await renderStore(<IncidentsHub />);
    expect(
      await screen.findByText('No encontramos pedidos en este dispositivo.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Iniciá sesión para ver tus pedidos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Buscar mi pedido con número y teléfono' }),
    ).toHaveAttribute('href', '/consultar?next=incidencia');
    const generic = await screen.findByRole('link', { name: /Escribinos por WhatsApp/ });
    expect(generic.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/50239999431\?text=/);
  });

  it('con sesión lista los pedidos con su botón de WhatsApp prellenado y destaca el elegido', async () => {
    await renderSignedIn(<IncidentsHub highlightId="MON-479850" />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('MON-479850');
    const wa = await within(items[0]!).findByRole('link', { name: /Reportar por WhatsApp/ });
    const text = decodeURIComponent(wa.getAttribute('href') ?? '');
    expect(text).toContain('Pedido: MON-479850');
    expect(text).toContain('Salsa aparte');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Iniciá sesión para ver/ })).toBeNull(),
    );
  });
});

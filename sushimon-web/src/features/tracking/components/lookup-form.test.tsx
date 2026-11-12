import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { forgetVerifiedOrders, readVerifiedOrderIds } from '../verified-orders';
import { LookupForm } from './lookup-form';

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/consultar',
  useRouter: () => router,
}));

const NOT_FOUND = 'No encontramos un pedido con esos datos. Revisá el número y el teléfono.';

describe('LookupForm (consulta de invitado)', () => {
  beforeEach(() => {
    router.push.mockClear();
    forgetVerifiedOrders();
  });

  it('sin datos muestra errores junto al campo, enlazados con aria-describedby, y enfoca el primero', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />);
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    const id = screen.getByLabelText('Número de pedido');
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveFocus();
    expect(id).toHaveAccessibleDescription('Ingresá el número de pedido');
    expect(screen.getByLabelText('Teléfono')).toHaveAccessibleDescription(
      'Ingresá el teléfono (8 dígitos)',
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('con número válido y teléfono corto enfoca el teléfono', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />);
    await user.type(screen.getByLabelText('Número de pedido'), 'MON-490217');
    await user.type(screen.getByLabelText('Teléfono'), '555');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(screen.getByLabelText('Teléfono')).toHaveFocus();
    expect(screen.getByLabelText('Número de pedido')).toHaveAttribute('aria-invalid', 'false');
  });

  it('número y teléfono correctos llevan al seguimiento y recuerdan la verificación en la pestaña', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />);
    await user.type(screen.getByLabelText('Número de pedido'), 'MON-490217');
    await user.type(screen.getByLabelText('Teléfono'), '5555-1234');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/pedidos/MON-490217'));
    expect(readVerifiedOrderIds()).toEqual(['MON-490217']);
  });

  it('acepta el número sin prefijo y con teléfono formateado distinto', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />);
    await user.type(screen.getByLabelText('Número de pedido'), '490217');
    await user.type(screen.getByLabelText('Teléfono'), '55551234');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/pedidos/MON-490217'));
  });

  it('con ?next=incidencia continúa al reclamo del pedido', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm next="incidencia" />);
    await user.click(screen.getByRole('button', { name: 'Usar datos de prueba' }));
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/incidencias?pedido=MON-490217'));
  });

  it('teléfono incorrecto y pedido inexistente muestran el MISMO aviso genérico (no revela si existe)', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />);
    await user.type(screen.getByLabelText('Número de pedido'), 'MON-490217');
    await user.type(screen.getByLabelText('Teléfono'), '5555-9999');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    const wrongPhone = await screen.findByText(NOT_FOUND);
    expect(wrongPhone.closest('[aria-live="polite"]')).not.toBeNull();

    await user.clear(screen.getByLabelText('Número de pedido'));
    await user.type(screen.getByLabelText('Número de pedido'), 'MON-111111');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(readVerifiedOrderIds()).toEqual([]);
  });

  it('llegar desde un seguimiento sin acceso precarga el número y muestra el aviso genérico', async () => {
    await renderStore(<LookupForm initialOrderNumber="MON-490217" notFound />);
    expect(screen.getByLabelText('Número de pedido')).toHaveValue('MON-490217');
    expect(screen.getByText(NOT_FOUND)).toBeInTheDocument();
  });

  it('ofrece iniciar sesión como alternativa y rotula los datos de prueba como demostración', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<LookupForm />);
    expect(screen.getByText('Datos de prueba: MON-490217 · 5555-1234')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /¿Tenés cuenta\?/ }));
    expect(view.api().shell.authOpen).toBe(true);
  });

  it('error de red: aviso genérico de error, distinto del "no encontrado"', async () => {
    const user = userEvent.setup();
    await renderStore(<LookupForm />, { scenario: 'offline' });
    await user.click(screen.getByRole('button', { name: 'Usar datos de prueba' }));
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(await screen.findByText('Algo salió mal')).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
  });
});

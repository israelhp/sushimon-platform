import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersScreen } from '@/features/bo-orders/components/OrdersScreen';
import { renderBackoffice } from '@/test/backoffice-providers';
import { nav, resetNavigationMock, router } from '@/test/next-navigation-mock';
import { BackofficeShell } from './BackofficeShell';
import { LoginScreen } from './LoginScreen';
import { ScreenGuard } from './ScreenGuard';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/panel'));

const menu = () => within(screen.getByRole('navigation', { name: 'Menú principal' }));

describe('shell autenticado', () => {
  it('administrador ve las 13 pantallas del menú', async () => {
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'admin' });
    const names = [
      'Panel',
      'Pedidos',
      'Entregas',
      'Motoristas',
      'Productos',
      'Categorías',
      'Extras',
      'Promociones',
      'Banners',
      'Sucursales',
      'Usuarios',
      'Roles y permisos',
      'Reportes',
    ];
    for (const name of names) {
      expect(await menu().findByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    expect(menu().getAllByRole('link')).toHaveLength(13);
  });

  it('el encargado ve su operación, Productos, Categorías y Extras (solo lectura), Sucursales (solo lectura), Usuarios, Roles y Reportes; no Promociones', async () => {
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'manager' });
    await menu().findByRole('link', { name: /Entregas/ });
    expect(menu().getAllByRole('link')).toHaveLength(11);
    expect(menu().getByRole('link', { name: /Motoristas/ })).toBeVisible();
    expect(menu().getByRole('link', { name: /Categorías/ })).toBeVisible();
    expect(menu().getByRole('link', { name: /Extras/ })).toBeVisible();
    expect(menu().queryByRole('link', { name: /Promociones/ })).toBeNull();
    expect(menu().getByRole('link', { name: /Usuarios/ })).toBeVisible();
  });

  it('cocina solo ve Pedidos: sin Entregas ni Panel', async () => {
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'kitchen' });
    await menu().findByRole('link', { name: /Pedidos/ });
    expect(menu().getAllByRole('link')).toHaveLength(1);
    expect(menu().queryByRole('link', { name: /Entregas/ })).toBeNull();
  });

  it('marca la pantalla activa y muestra el badge de pedidos nuevos', async () => {
    nav.pathname = '/backoffice/pedidos';
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'manager' });
    const link = await menu().findByRole('link', { name: /Pedidos/ });
    expect(link).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(within(link).getByText(/^\d+$/)).toBeVisible());
  });

  it('sin sesión de demostración redirige al acceso (la API decide el acceso real)', async () => {
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: null });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice/login'));
    expect(screen.queryByText('contenido')).toBeNull();
  });

  it('una pantalla fuera del menú del rol muestra "sin permiso"', async () => {
    await renderBackoffice(
      <BackofficeShell>
        <ScreenGuard screen="entregas">secreto</ScreenGuard>
      </BackofficeShell>,
      { role: 'kitchen' },
    );
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByText('secreto')).toBeNull();
  });

  it('el escenario forbidden (403 del servidor) muestra "sin permiso" en Pedidos', async () => {
    await renderBackoffice(
      <BackofficeShell>
        <OrdersScreen />
      </BackofficeShell>,
      { role: 'manager', scenario: 'forbidden' },
    );
    expect(
      await screen.findByText('El servidor rechazó la consulta por permisos insuficientes.'),
    ).toBeVisible();
  });

  it('el administrador elige sucursal; el encargado ve la suya fija', async () => {
    const admin = await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, {
      role: 'admin',
    });
    const selector = await screen.findByRole('button', { name: /Cambiar de sucursal/ });
    await userEvent.click(selector);
    await userEvent.click(await screen.findByRole('button', { name: /Sucursal 2/ }));
    expect(screen.getByRole('button', { name: /Cambiar de sucursal: Sucursal 2/ })).toBeVisible();
    admin.unmount();

    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'manager' });
    expect(await screen.findByTitle('Sucursal asignada a tu usuario')).toHaveTextContent(
      'Sucursal 1',
    );
    expect(screen.queryByRole('button', { name: /Cambiar de sucursal/ })).toBeNull();
  });

  it('el menú de usuario cambia de rol (demo) y cierra sesión', async () => {
    const view = await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, {
      role: 'admin',
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Menú de la cuenta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cocina' }));
    expect(router.push).toHaveBeenCalledWith('/backoffice/pedidos');
    await waitFor(() => expect(view.api().session.staff?.role).toBe('kitchen'));
    expect(await screen.findByText('Ahora ves el panel como Cocina')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Menú de la cuenta' }));
    // El primero es el ícono del pie del menú lateral; el último, la opción del menú de usuario.
    await userEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' }).at(-1)!);
    expect(router.replace).toHaveBeenCalledWith('/backoffice/login');
    await waitFor(() => expect(view.api().session.staff).toBeNull());
  });

  it('"Demo: llega un pedido" crea un pedido nuevo simulado y avisa', async () => {
    await renderBackoffice(<BackofficeShell>contenido</BackofficeShell>, { role: 'manager' });
    await userEvent.click(await screen.findByRole('button', { name: /Demo: llega un pedido/ }));
    expect(await screen.findByText(/Nuevo pedido #/)).toBeVisible();
  });
});

describe('acceso de demostración', () => {
  it('entra como cada rol y va a su pantalla de inicio', async () => {
    const view = await renderBackoffice(<LoginScreen />, { role: null });
    await userEvent.click(await screen.findByRole('button', { name: /Cocina Zona 4/ }));
    expect(screen.getByLabelText('Correo')).toHaveValue('cocina.z4@sushimon.gt');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(router.replace).toHaveBeenCalledWith('/backoffice/pedidos');
    await waitFor(() => expect(view.api().session.staff?.role).toBe('kitchen'));
  });

  it('el administrador entra al panel', async () => {
    await renderBackoffice(<LoginScreen />, { role: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Ingresar' }));
    expect(router.replace).toHaveBeenCalledWith('/backoffice/panel');
  });

  it('rechaza un correo que no es de un usuario interno activo', async () => {
    await renderBackoffice(<LoginScreen />, { role: null });
    const email = await screen.findByLabelText('Correo');
    await userEvent.clear(email);
    await userEvent.type(email, 'otra@persona.com');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No encontramos un usuario interno activo',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('se rotula como demostración', async () => {
    await renderBackoffice(<LoginScreen />, { role: null });
    expect(await screen.findByText('Demostración')).toBeVisible();
  });
});

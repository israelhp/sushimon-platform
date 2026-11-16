import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { RolesScreen } from './components/RolesScreen';
import { UsersScreen } from './components/UsersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/usuarios'));

const renderUsers = (role: StaffRole = 'admin', scenario: MockScenario = 'default') =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="usuarios">
        <UsersScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );

const renderRoles = (role: StaffRole = 'admin', scenario: MockScenario = 'default') =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="roles">
        <RolesScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );

const table = () => screen.getByRole('table', { name: 'Usuarios internos' });
const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = screen.getByRole('searchbox', { name: 'Buscar usuarios' });
  await user.clear(box);
  await user.type(box, text);
};
const rowOf = async (name: string) =>
  (await within(table()).findByText(name)).closest('[role="row"]') as HTMLElement;

describe('Usuarios · lista', () => {
  it('lista paginada con rol y sucursal, estado y vinculación', async () => {
    await renderUsers();
    expect(await screen.findByText('11 usuarios')).toBeVisible();
    // 10 por página + encabezado
    expect(within(table()).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText('Página 1 de 2')).toBeVisible();
    const ana = await rowOf('Ana Lucía Pérez');
    expect(within(ana).getByText(/Administrador general · Todas las sucursales/)).toBeVisible();
    expect(within(ana).getByText('Vinculada')).toBeVisible();
    expect(within(ana).getByText('Activo')).toBeVisible();
    // La API no expone MFA por persona: no se muestra como dato.
    expect(screen.queryByText(/MFA pendiente/i)).toBeNull();
  });

  it('muestra las asignaciones múltiples y el estado Desactivada', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'sofia.morales');
    const sofia = await rowOf('Sofía Morales');
    expect(within(sofia).getByText('Encargado de sucursal · Sucursal 2')).toBeVisible();
    expect(within(sofia).getByText('Encargado de sucursal · Sucursal 3')).toBeVisible();
    await search(user, 'pedro');
    const pedro = await rowOf('Pedro Xicará');
    expect(within(pedro).getByText('Desactivado')).toBeVisible();
  });

  it('filtra por vinculación: Pendiente de vincular Google', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await user.selectOptions(screen.getByLabelText('Vinculación'), 'PENDING_LINK');
    const valeria = await rowOf('Valeria Ixcoy');
    expect(within(valeria).getByText('Pendiente de vincular Google')).toBeVisible();
    expect(await screen.findByText('1 usuario')).toBeVisible();
  });

  it('filtra por rol, sucursal y estado y limpia los filtros', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await waitFor(() => expect(screen.getByLabelText('Rol')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Rol'), 'Cocina');
    expect(await screen.findByText('4 usuarios')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Sucursal'), 'Sucursal 2');
    expect(await screen.findByText('2 usuarios')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Estado'), 'inactive');
    expect(await screen.findByText('Sin resultados')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(await screen.findByText('11 usuarios')).toBeVisible();
  });

  it('busca con retardo y muestra el estado sin resultados', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'cocina');
    expect(await screen.findByText('3 usuarios')).toBeVisible();
    await search(user, 'zzz');
    expect(
      await screen.findByText('Ningún usuario coincide con la búsqueda o los filtros.'),
    ).toBeVisible();
  });

  it('ordena y pagina', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2')).toBeVisible();
    expect(await within(table()).findByText('Valeria Ixcoy')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /cambiar el orden/i }));
    expect(await screen.findByText('Página 1 de 2')).toBeVisible();
    expect(await within(table()).findByText('Valeria Ixcoy')).toBeVisible();
  });

  it('estados de carga, error con reintento, vacío y 403', async () => {
    const loading = await renderUsers('admin', 'loading');
    expect(table()).toHaveAttribute('aria-busy', 'true');
    loading.unmount();

    const failing = await renderUsers('admin', 'error');
    expect(await screen.findByText(/No pudimos cargar los usuarios/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    failing.unmount();

    await renderUsers('admin', 'forbidden');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });

  it('cocina no accede a Usuarios', async () => {
    await renderUsers('kitchen');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Nuevo usuario/ })).toBeNull();
  });
});

describe('Usuarios · alcance del encargado', () => {
  it('ve solo al personal de su sucursal y no a quien opera fuera de ella', async () => {
    await renderUsers('manager');
    expect(await screen.findByText('4 usuarios')).toBeVisible();
    expect(await rowOf('Marco Antonio Gómez')).toBeVisible();
    expect(within(table()).queryByText('Karla Rodríguez')).toBeNull();
    expect(within(table()).queryByText('Ana Lucía Pérez')).toBeNull();
    // Cuenta propia: solo el nombre; el resto del personal de su sucursal es gestionable.
    const own = await rowOf('Marco Antonio Gómez');
    expect(within(own).queryByRole('button', { name: /Desactivar/ })).toBeNull();
    const kitchen = await rowOf('Cocina Zona 4');
    expect(
      within(kitchen).getByRole('button', { name: 'Desactivar a Cocina Zona 4' }),
    ).toBeVisible();
  });

  it('el selector de sucursal del formulario solo ofrece las autorizadas y nunca el rol administrador', async () => {
    const user = userEvent.setup();
    await renderUsers('manager');
    await user.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Rol de la asignación 1')).toBeVisible(),
    );
    const roles = within(within(dialog).getByLabelText('Rol de la asignación 1')).getAllByRole(
      'option',
    );
    expect(roles.map((o) => o.textContent)).not.toContain('Administrador general');
    expect(roles.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Encargado de sucursal', 'Cocina', 'Empleado']),
    );
    const branches = within(
      within(dialog).getByLabelText('Sucursal de la asignación 1'),
    ).getAllByRole('option');
    expect(branches.map((o) => o.textContent)).toEqual(['Elige una sucursal', 'Sucursal 1']);
  });
});

describe('Usuarios · crear', () => {
  const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await waitFor(() =>
      expect(
        within(within(dialog).getByLabelText('Rol de la asignación 1')).getAllByRole('option')
          .length,
      ).toBeGreaterThan(1),
    );
    return dialog;
  };

  it('valida nombre, correo y asignación, enfoca el primer error y no envía', async () => {
    const user = userEvent.setup();
    await renderUsers();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    const name = within(dialog).getByLabelText('Nombre completo');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Escribe el nombre completo.');
    expect(within(dialog).getByText('Escribe el correo.')).toBeVisible();
    expect(within(dialog).getByText('Elige un rol.')).toBeVisible();

    await user.type(name, 'Lucía Prueba');
    await user.type(within(dialog).getByLabelText('Correo'), 'sin-arroba');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    expect(within(dialog).getByLabelText('Correo')).toHaveFocus();
    expect(within(dialog).getByText('Escribe un correo válido.')).toBeVisible();
  });

  it('preautoriza con varias asignaciones (rol + sucursal) y aparece Pendiente de vincular', async () => {
    const user = userEvent.setup();
    await renderUsers();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Lucía Prueba');
    await user.type(within(dialog).getByLabelText('Correo'), '  Lucia.Prueba@Sushimon.gt ');
    await user.selectOptions(within(dialog).getByLabelText('Rol de la asignación 1'), 'Cocina');
    await user.selectOptions(
      within(dialog).getByLabelText('Sucursal de la asignación 1'),
      'Sucursal 2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Agregar asignación' }));
    await user.selectOptions(within(dialog).getByLabelText('Rol de la asignación 2'), 'Empleado');
    await user.selectOptions(
      within(dialog).getByLabelText('Sucursal de la asignación 2'),
      'Sucursal 3',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Lucía Prueba quedó preautorizado/)).toBeVisible();
    expect(await screen.findByText('12 usuarios')).toBeVisible();
    await search(user, 'lucia.prueba@sushimon.gt');
    const row = await rowOf('Lucía Prueba');
    expect(within(row).getByText('Cocina · Sucursal 2')).toBeVisible();
    expect(within(row).getByText('Empleado · Sucursal 3')).toBeVisible();
    expect(within(row).getByText('Pendiente de vincular Google')).toBeVisible();
    expect(within(row).getByText('lucia.prueba@sushimon.gt')).toBeVisible();
  });

  it('elegir el rol administrador fija el alcance global', async () => {
    const user = userEvent.setup();
    await renderUsers();
    const dialog = await openCreate(user);
    await user.selectOptions(
      within(dialog).getByLabelText('Rol de la asignación 1'),
      'Administrador general',
    );
    expect(within(dialog).getByText('Todas las sucursales (solo administrador)')).toBeVisible();
    expect(within(dialog).queryByLabelText('Sucursal de la asignación 1')).toBeNull();
  });

  it('409: el correo duplicado se muestra en el campo y en el aviso', async () => {
    const user = userEvent.setup();
    await renderUsers();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Otra Ana');
    await user.type(within(dialog).getByLabelText('Correo'), 'ANA.PEREZ@sushimon.gt');
    await user.selectOptions(within(dialog).getByLabelText('Rol de la asignación 1'), 'Cocina');
    await user.selectOptions(
      within(dialog).getByLabelText('Sucursal de la asignación 1'),
      'Sucursal 1',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    expect(
      (await within(dialog).findAllByText('Ya existe un empleado con ese correo')).length,
    ).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText('Correo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Nuevo usuario' })).toBeVisible();
  });
});

describe('Usuarios · editar', () => {
  it('cuenta vinculada: el correo no se puede cambiar; se guarda el nombre', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'karla');
    await user.click(await screen.findByRole('button', { name: 'Editar a Karla Rodríguez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuario' });
    expect(within(dialog).getByLabelText('Correo')).toHaveAttribute('readonly');
    expect(within(dialog).getByText(/ya está vinculada con Google/)).toBeVisible();
    // Solo nombre y correo: las asignaciones no se editan aquí.
    expect(within(dialog).queryByText('Rol y sucursal')).toBeNull();
    const name = within(dialog).getByLabelText('Nombre completo');
    await user.clear(name);
    await user.type(name, 'Karla R. de León');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(table()).findByText('Karla R. de León')).toBeVisible();
  });

  it('pendiente de vincular: el correo sí se edita y se normaliza', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'valeria');
    await user.click(await screen.findByRole('button', { name: 'Editar a Valeria Ixcoy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuario' });
    const email = within(dialog).getByLabelText('Correo');
    expect(email).not.toHaveAttribute('readonly');
    await user.clear(email);
    await user.type(email, 'Valeria.Nueva@Sushimon.gt');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(table()).findByText('valeria.nueva@sushimon.gt')).toBeVisible();
  });

  it('la cuenta propia solo permite cambiar el nombre', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    const ana = await rowOf('Ana Lucía Pérez');
    expect(within(ana).queryByRole('button', { name: /Desactivar/ })).toBeNull();
    expect(within(ana).queryByRole('button', { name: /asignaciones/ })).toBeNull();
    await user.click(within(ana).getByRole('button', { name: 'Editar a Ana Lucía Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuario' });
    expect(within(dialog).getByText(/Es tu propia cuenta/)).toBeVisible();
    expect(within(dialog).getByLabelText('Correo')).toHaveAttribute('readonly');
  });
});

describe('Usuarios · estado y asignaciones', () => {
  it('desactivar pide confirmación y motivo, y luego muestra Desactivado', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'marco');
    await user.click(
      await screen.findByRole('button', { name: 'Desactivar a Marco Antonio Gómez' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar usuario' });
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialog).findByText('Escribe el motivo de la desactivación.')).toBeVisible();
    expect(within(dialog).getByLabelText('Motivo de la desactivación')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Motivo de la desactivación'), 'Renuncia');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Marco Antonio Gómez desactivado')).toBeVisible();
    const row = await rowOf('Marco Antonio Gómez');
    expect(within(row).getByText('Desactivado')).toBeVisible();
    expect(
      within(row).getByRole('button', { name: 'Activar a Marco Antonio Gómez' }),
    ).toBeVisible();
  });

  it('activar no exige motivo', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'pedro');
    await user.click(await screen.findByRole('button', { name: 'Activar a Pedro Xicará' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activar usuario' });
    await user.click(within(dialog).getByRole('button', { name: 'Activar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Pedro Xicará activado')).toBeVisible();
  });

  it('403: si el servidor revoca el permiso, el modal muestra el error y no cierra', async () => {
    const user = userEvent.setup();
    const view = await renderUsers('manager');
    await screen.findByText('4 usuarios');
    await user.click(await screen.findByRole('button', { name: 'Desactivar a Cocina Zona 4' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar usuario' });
    // "El servidor" retira staff.disable al rol mientras el modal está abierto.
    const manager = view.api().store.roles.find((r) => r.code === 'manager')!;
    manager.permissions = manager.permissions.filter((p) => p !== 'staff.disable');
    await user.type(within(dialog).getByLabelText('Motivo de la desactivación'), 'Prueba');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/No tienes permiso/);
    expect(screen.getByRole('dialog', { name: 'Desactivar usuario' })).toBeVisible();
  });

  it('edita asignaciones (PUT): agrega una sucursal y aparece en la fila', async () => {
    const user = userEvent.setup();
    await renderUsers();
    await screen.findByText('11 usuarios');
    await search(user, 'cocina.z4');
    await user.click(
      await screen.findByRole('button', { name: 'Editar las asignaciones de Cocina Zona 4' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Asignaciones de Cocina Zona 4' });
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Rol de la asignación 1')).toHaveValue('role-kitchen'),
    );
    // Sin cambios no se envía.
    await user.click(within(dialog).getByRole('button', { name: 'Guardar asignaciones' }));
    expect(await within(dialog).findByText('No hay cambios que guardar.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Agregar asignación' }));
    await user.selectOptions(within(dialog).getByLabelText('Rol de la asignación 2'), 'Cocina');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar asignaciones' }));
    expect(
      await within(dialog).findByText(
        'Elige una sucursal (el alcance global es solo del administrador).',
      ),
    ).toBeVisible();
    await user.selectOptions(
      within(dialog).getByLabelText('Sucursal de la asignación 2'),
      'Sucursal 2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Guardar asignaciones' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = await rowOf('Cocina Zona 4');
    expect(within(row).getByText('Cocina · Sucursal 2')).toBeVisible();
  });
});

describe('Roles y permisos', () => {
  it('lista los roles con empleados asignados; admin es de solo lectura', async () => {
    const user = userEvent.setup();
    await renderRoles();
    expect(await screen.findByText('4 roles · 46 permisos')).toBeVisible();
    expect(screen.getByText('Sistema · solo lectura')).toBeVisible();
    // Admin: todo el catálogo y sin edición.
    expect(screen.getByText(/46 de 46 permisos/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Permisos de Administrador general' }));
    expect(screen.getByText(/rol del sistema/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Editar permisos' })).toBeNull();
    // Permisos agrupados por módulo.
    expect(screen.getByRole('group', { name: 'Empleados' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Pedidos' })).toBeVisible();
  });

  it('edita los permisos de un rol, avisa a cuántos empleados afecta y guarda', async () => {
    const user = userEvent.setup();
    await renderRoles();
    await screen.findByText('4 roles · 46 permisos');
    await user.click(screen.getByRole('button', { name: 'Permisos de Cocina' }));
    await user.click(screen.getByRole('button', { name: 'Editar permisos' }));
    // Cocina: 3 empleados activos con el rol (u5, u6, u7; u10 está pendiente pero activo → 4).
    const checkbox = screen.getByRole('checkbox', { name: /Cancelar pedidos/ });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/afecta a 4 empleados activos con el rol Cocina/)).toBeVisible();
    expect(screen.getByText(/1 por añadir · 0 por quitar/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Guardar permisos' }));
    expect(await screen.findByText('Permisos de Cocina actualizados')).toBeVisible();
    // Vuelve a modo lectura y el cambio persiste.
    expect(await screen.findByRole('button', { name: 'Editar permisos' })).toBeVisible();
    expect(screen.getByText(/\b6 de 46 permisos/)).toBeVisible();
  });

  it('no deja guardar sin cambios y exige al menos un permiso', async () => {
    const user = userEvent.setup();
    await renderRoles();
    await screen.findByText('4 roles · 46 permisos');
    await user.click(screen.getByRole('button', { name: 'Permisos de Empleado' }));
    await user.click(screen.getByRole('button', { name: 'Editar permisos' }));
    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled();
    for (const name of [
      /Ver pedidos/,
      /Aceptar pedidos/,
      /Pasar pedidos a preparación/,
      /Ver entregas/,
    ]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await user.click(screen.getByRole('button', { name: 'Guardar permisos' }));
    expect(await screen.findByText('Deja al menos un permiso.')).toBeVisible();
  });

  it('el encargado ve los permisos pero no puede editarlos', async () => {
    const user = userEvent.setup();
    await renderRoles('manager');
    await screen.findByText('4 roles · 46 permisos');
    await user.click(screen.getByRole('button', { name: 'Permisos de Cocina' }));
    expect(screen.getByText(/puede ver los permisos, pero no editarlos/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Editar permisos' })).toBeNull();
  });

  it('cocina no accede a Roles; estados de error y 403', async () => {
    const kitchen = await renderRoles('kitchen');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    kitchen.unmount();
    const failing = await renderRoles('admin', 'error');
    expect(await screen.findByText(/No pudimos cargar los roles/)).toBeVisible();
    failing.unmount();
    await renderRoles('admin', 'forbidden');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });
});

describe('Usuarios · restablecer MFA (F02)', () => {
  const openMfa = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const row = await rowOf(name);
    await user.click(within(row).getByRole('button', { name: `Restablecer MFA de ${name}` }));
    return screen.findByRole('dialog', { name: 'Restablecer MFA' });
  };

  it('solo el administrador global lo ve; nunca en la fila propia ni en pendientes de vincular', async () => {
    const user = userEvent.setup();
    const view = await renderUsers('admin');
    await screen.findByText('11 usuarios');
    const ana = await rowOf('Ana Lucía Pérez');
    expect(within(ana).queryByRole('button', { name: /Restablecer MFA/ })).toBeNull();
    const cocina = await rowOf('Cocina Zona 4');
    expect(
      within(cocina).getByRole('button', { name: 'Restablecer MFA de Cocina Zona 4' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    const valeria = await rowOf('Valeria Ixcoy');
    expect(within(valeria).queryByRole('button', { name: /Restablecer MFA/ })).toBeNull();
    view.unmount();

    await renderUsers('manager');
    await screen.findByText('4 usuarios');
    expect(screen.queryByRole('button', { name: /Restablecer MFA/ })).toBeNull();
  });

  it('confirma con el texto del procedimiento, restablece (204), avisa con toast y no invalida nada', async () => {
    const user = userEvent.setup();
    await renderUsers('admin');
    await screen.findByText('11 usuarios');
    const dialog = await openMfa(user, 'Cocina Zona 4');
    expect(within(dialog).getByText(/volver a enrolar su autenticador/)).toBeVisible();
    expect(within(dialog).getByText(/único administrador general/)).toBeVisible();
    expect(within(dialog).getByText('Simulación')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Restablecer MFA' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText(/MFA de Cocina Zona 4 restablecido \(simulación\)/),
    ).toBeVisible();
  });

  it('Cancelar cierra sin llamar a la API', async () => {
    const user = userEvent.setup();
    const view = await renderUsers('admin');
    await screen.findByText('11 usuarios');
    const spy = vi.spyOn(view.api().client, 'request');
    const dialog = await openMfa(user, 'Cocina Zona 4');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(spy.mock.calls.some(([path]) => String(path).includes('mfa-reset'))).toBe(false);
  });

  it.each([
    [
      '503',
      (s: MockStoreLike) => void (s.mfaResetUnavailable = true),
      /no está disponible por ahora/,
    ],
    [
      '409',
      (s: MockStoreLike) => void (s.staff.find((u) => u.id === 'u5')!.linked = false),
      /aún no vinculó/,
    ],
    [
      '404',
      (s: MockStoreLike) =>
        void s.staff.splice(
          s.staff.findIndex((u) => u.id === 'u5'),
          1,
        ),
      /ya no existe/,
    ],
  ])('error %s: mensaje de negocio en el modal, que sigue abierto', async (_name, mutate, text) => {
    const user = userEvent.setup();
    const view = await renderUsers('admin');
    await screen.findByText('11 usuarios');
    const dialog = await openMfa(user, 'Cocina Zona 4');
    mutate(view.api().store);
    await user.click(within(dialog).getByRole('button', { name: 'Restablecer MFA' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(screen.getByRole('dialog', { name: 'Restablecer MFA' })).toBeVisible();
    // Sigue pudiendo cancelar.
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

type MockStoreLike = import('@/mocks/store').MockStore;

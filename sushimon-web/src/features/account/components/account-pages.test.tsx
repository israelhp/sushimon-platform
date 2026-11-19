import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { AddressesPage } from './AddressesPage';
import { AccountHub } from './AccountHub';
import { FavoritesPage } from './FavoritesPage';
import { OrdersPage } from './OrdersPage';
import { ProfileForm } from './ProfileForm';

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
const NEW_USER = { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' };

type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View, account = DEMO) =>
  act(async () => view.api().session.signInCustomer(account));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('hub de la cuenta', () => {
  it('sin sesión invita a continuar con Google (simulado) y ofrece consultar como invitado', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AccountHub />);
    expect(screen.getByRole('heading', { level: 1, name: /Mi cuenta/ })).toBeInTheDocument();
    expect(screen.getByText('Tus pedidos en un solo lugar')).toBeInTheDocument();
    expect(screen.getByText('Simulación')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Consultá tu orden con el número/ })).toHaveAttribute(
      'href',
      '/consultar',
    );
    await user.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(view.api().shell.authOpen).toBe(true);
  });

  it('con sesión muestra el perfil y los resúmenes con plural', async () => {
    const view = await renderStore(<AccountHub />);
    await signIn(view);
    expect(await screen.findByText('cliente@ejemplo.com')).toBeInTheDocument();
    expect(await screen.findByText(/2 direcciones guardadas · Predeterminada: Casa/)).toBeVisible();
    expect(screen.getByText('2 productos')).toBeInTheDocument();
    // F23: el hub no consulta pedidos (la API real no entrega conteo); la tarjeta es un acceso a la sección.
    expect(screen.getByText(/Historial, seguimiento, recibos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('cerrar sesión vuelve a la invitación', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AccountHub />);
    await signIn(view);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByText('Tus pedidos en un solo lugar')).toBeInTheDocument();
    expect(view.api().session.customer).toBeNull();
  });
});

describe('autorización de la UI', () => {
  it('localStorage no abre secciones de la cuenta: sin sesión se pide iniciar sesión', async () => {
    for (const key of ['customer', 'monsushi-customer', 'monsushi-session', 'monsushi-auth']) {
      window.localStorage.setItem(
        key,
        JSON.stringify({ customer: DEMO, email: DEMO.email, role: 'admin', signedIn: true }),
      );
    }
    const view = await renderStore(<AddressesPage />);
    expect(view.api().session.customer).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).toBeVisible();
    expect(screen.queryByText('Casa')).not.toBeInTheDocument();
  });

  it('cada sección de la cuenta exige sesión (datos, pedidos)', async () => {
    const view = await renderStore(<ProfileForm />);
    expect(
      screen.getByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).toBeVisible();
    view.unmount();
    await renderStore(<OrdersPage />);
    expect(
      screen.getByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).toBeVisible();
  });
});

describe('datos personales', () => {
  it('valida con mensajes asociados y enfoca el primer error; guarda cambios válidos', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<ProfileForm />);
    await signIn(view);
    const name = await screen.findByLabelText('Nombre completo');
    const save = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(save).toBeDisabled();

    await user.clear(name);
    await user.type(name, 'Ab');
    await user.click(save);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Escribí tu nombre completo.');
    await waitFor(() => expect(name).toHaveFocus());

    await user.clear(name);
    await user.type(name, 'Cliente Demo Actualizado');
    await user.click(save);
    expect(await screen.findByLabelText('Nombre completo')).toHaveValue('Cliente Demo Actualizado');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled(),
    );
  });
});

describe('direcciones', () => {
  it('lista con la predeterminada y permite cambiarla', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Predeterminada')).toBeInTheDocument();
    expect(screen.getByText('2 de 10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Usar como predeterminada: Trabajo' }));
    await waitFor(() => {
      const rows = screen.getAllByRole('listitem');
      const work = rows.find((r) => within(r).queryByText('Trabajo'));
      expect(within(work!).getByText('Predeterminada')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Predeterminada')).toHaveLength(1);
  });

  it('agrega una dirección: valida y enfoca, luego guarda como predeterminada', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    await screen.findAllByRole('listitem');

    await user.click(screen.getAllByRole('button', { name: 'Agregar dirección' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Nueva dirección' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));

    const zone = within(dialog).getByLabelText('Zona');
    expect(zone).toHaveAccessibleDescription('Indicá la zona.');
    expect(within(dialog).getByLabelText('Dirección exacta')).toHaveAccessibleDescription(
      'Escribí la dirección exacta de entrega.',
    );
    await waitFor(() => expect(zone).toHaveFocus());

    await user.selectOptions(zone, '15');
    await user.type(
      within(dialog).getByLabelText('Dirección exacta'),
      '2a calle 23-80, Vista Hermosa',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Otra' }));
    await user.type(within(dialog).getByLabelText(/Nombre de la dirección/), 'Casa de mamá');
    await user.click(within(dialog).getByLabelText('Usar como predeterminada'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const created = (await screen.findAllByRole('listitem')).find((r) =>
      within(r).queryByText('Casa de mamá'),
    );
    expect(created).toBeDefined();
    expect(within(created!).getByText('Predeterminada')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('rechaza una dirección duplicada con un aviso', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    const [first] = await screen.findAllByRole('listitem');
    await user.click(within(first!).getByRole('button', { name: /Editar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar dirección' });
    // Misma calle y zona que "Trabajo" (otra dirección ya guardada).
    const lineInput = within(dialog).getByLabelText('Dirección exacta');
    await user.clear(lineInput);
    await user.type(lineInput, 'Vía 5 4-50, Cuatro Grados Norte, oficina 2');
    await user.selectOptions(within(dialog).getByLabelText('Zona'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ya tenés esta dirección guardada.',
    );
  });

  it('elimina con confirmación; cancelar conserva la dirección', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    await screen.findAllByRole('listitem');

    await user.click(screen.getByRole('button', { name: 'Eliminar: Trabajo' }));
    const confirm = screen.getByRole('alert');
    expect(confirm).toHaveTextContent('¿Eliminar esta dirección?');
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Eliminar: Trabajo' }));
    await user.click(
      within(screen.getByRole('alert')).getByRole('button', { name: /Sí, eliminar/ }),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('cuenta nueva: estado vacío con acción para agregar', async () => {
    const view = await renderStore(<AddressesPage />);
    await signIn(view, NEW_USER);
    expect(await screen.findByText('Todavía no tenés direcciones guardadas')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Agregar dirección' })).toHaveLength(2);
  });
});

describe('favoritos', () => {
  it('sin sesión: aviso para iniciar sesión y estado vacío', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />);
    expect(screen.getByText('Todavía no tenés favoritos')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: /Iniciá sesión con Google para guardar tus favoritos/ }),
    );
    expect(view.api().shell.authOpen).toBe(true);
  });

  it('con sesión lista los favoritos y permite quitar uno', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />);
    await signIn(view);
    const remove = await screen.findByRole('button', {
      name: /Quitar Platanito Roll de favoritos/,
    });
    await user.click(remove);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Quitar Platanito Roll de favoritos/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('un favorito que ya no está disponible se marca y se puede quitar', async () => {
    const view = await renderStore(<FavoritesPage />, { scenario: 'product-unavailable' });
    await signIn(view);
    expect(await screen.findAllByText('No disponible por ahora')).not.toHaveLength(0);
    expect(
      screen.getByRole('button', { name: /Quitar Platanito Roll de favoritos/ }),
    ).toBeVisible();
  });
});

describe('pedidos (F23)', () => {
  it('lista los pedidos reales con estado, enlaces al detalle, recibo y seguimiento, y pestañas', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    // El enlace nombra el pedido (sr-only) y apunta al UUID real, no al borrador simulado.
    expect(await screen.findAllByTestId('history-row')).toHaveLength(1);
    const detail = screen.getByRole('link', { name: /Ver detalle: MON-490217/ });
    expect(detail).toHaveAttribute('href', '/pedidos/00000000-0000-4000-8000-000000490217');
    expect(screen.getByRole('link', { name: /Seguimiento: MON-490217/ })).toHaveAttribute(
      'href',
      '/pedidos/00000000-0000-4000-8000-000000490217/seguimiento',
    );
    expect(screen.getByRole('link', { name: /Ver recibo: MON-490217/ })).toHaveAttribute(
      'href',
      '/pedidos/00000000-0000-4000-8000-000000490217/recibo',
    );
    expect(screen.getByRole('tab', { name: /En curso/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Historial/ }));
    expect(screen.getByRole('tab', { name: /Historial/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));
    expect(screen.getByRole('link', { name: /Ver detalle: MON-482193/ })).toBeVisible();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });
});

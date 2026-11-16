import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { DataClient } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { AddressesPage } from './AddressesPage';

/** F05 · zona de la dirección: obligatoria «Zona N» (1–25) en la ciudad de Guatemala, libre ≤ 60 en el resto. */

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View) => act(async () => view.api().session.signInCustomer(DEMO));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const openNew = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findAllByRole('listitem');
  await user.click(screen.getAllByRole('button', { name: 'Agregar dirección' })[0]!);
  return screen.findByRole('dialog', { name: 'Nueva dirección' });
};

describe('formulario de dirección · zona', () => {
  it('ciudad de Guatemala: select de «Zona 1» a «Zona 25» (sin excluir 20, 22 ni 23) y obligatorio', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    const dialog = await openNew(user);
    const zone = within(dialog).getByLabelText('Zona');
    expect(zone.tagName).toBe('SELECT');
    const options = within(zone)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toHaveLength(26); // «Elegí…» + 25 zonas
    expect(options[1]).toBe('Zona 1');
    expect(options[25]).toBe('Zona 25');
    expect(options).toEqual(expect.arrayContaining(['Zona 20', 'Zona 22', 'Zona 23']));
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 12-34');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    expect(zone).toHaveAttribute('aria-invalid', 'true');
    expect(zone).toHaveAccessibleDescription('Indicá la zona.');
    await waitFor(() => expect(zone).toHaveFocus());
  });

  it('otro municipio: campo de texto opcional con tope de 60 y se guarda como texto libre', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />);
    await signIn(view);
    const dialog = await openNew(user);
    const municipality = within(dialog).getByLabelText('Municipio');
    await waitFor(() =>
      expect(within(municipality).getAllByRole('option').length).toBeGreaterThan(2),
    );
    await user.selectOptions(municipality, 'Mixco');
    const zone = within(dialog).getByLabelText('Zona (opcional)');
    expect(zone.tagName).toBe('INPUT');
    expect(zone).toHaveAttribute('maxlength', '60');
    await user.type(zone, 'Colonia Lomas del Norte');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calzada San Juan 1-1');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/Calzada San Juan 1-1.*Colonia Lomas del Norte/)).toBeVisible();
  });

  it('una dirección antigua de la ciudad sin zona pide la zona al editarla', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AddressesPage />, {
      prepareStore: (store) => {
        store.accounts['cliente@ejemplo.com']!.addresses.find(
          (a) => a.id === 'demo-trabajo',
        )!.zone = '';
      },
    });
    await signIn(view);
    const rows = await screen.findAllByRole('listitem');
    const work = rows.find((r) => within(r).queryByText('Trabajo'))!;
    await user.click(within(work).getByRole('button', { name: /Editar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar dirección' });
    const zone = within(dialog).getByLabelText('Zona');
    expect(zone).toHaveValue('');
    expect(zone).toHaveAccessibleDescription(/Esta dirección se guardó sin zona/);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    expect(zone).toHaveAttribute('aria-invalid', 'true');
    expect(zone).toHaveAccessibleDescription(/Indicá la zona\./);
    await user.selectOptions(zone, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['ZONE_REQUIRED', 'Indicá la zona.'],
    ['ZONE_INVALID', 'Elegí una zona de la lista: de Zona 1 a Zona 25.'],
  ])('si la API responde 400 %s se muestra en el campo de zona y se enfoca', async (code, text) => {
    const user = userEvent.setup();
    const reject = (client: DataClient): DataClient => ({
      ...client,
      request: (path, options) =>
        options?.method === 'POST' && path === '/v1/me/addresses'
          ? Promise.reject(new ApiError(400, 'bad_request', 'x', undefined, undefined, code))
          : client.request(path, options),
      post: (path, body, options) =>
        path === '/v1/me/addresses'
          ? Promise.reject(new ApiError(400, 'bad_request', 'x', undefined, undefined, code))
          : client.post(path, body, options),
    });
    const view = await renderStore(<AddressesPage />, { wrapClient: reject });
    await signIn(view);
    const dialog = await openNew(user);
    const zone = within(dialog).getByLabelText('Zona');
    await user.selectOptions(zone, '10');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 12-34');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(zone).toHaveAttribute('aria-invalid', 'true'));
    expect(zone).toHaveAccessibleDescription(text);
    await waitFor(() => expect(zone).toHaveFocus());
    // Al corregir la zona se limpia el error del servidor.
    await user.selectOptions(zone, '11');
    expect(zone).not.toHaveAttribute('aria-invalid', 'true');
  });
});

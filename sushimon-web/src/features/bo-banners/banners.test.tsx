import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { MediaToolsProvider } from '@/features/media/tools';
import type { StaffRole } from '@/lib/data-access/models';
import type { ImageProcessor } from '@/lib/media-optimize';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { BannersScreen } from './components/BannersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/banners'));

const processor: ImageProcessor = {
  measure: async () => ({ width: 3000, height: 1200 }),
  encodeWebp: async () => new Blob([new Uint8Array(900).fill(7)], { type: 'image/webp' }),
};
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name = 'portada.png') =>
  new File([Uint8Array.from([...PNG_HEAD, ...new Array(40).fill(3)])], name, { type: 'image/png' });

function renderScreen(
  ui: ReactElement = <BannersScreen />,
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
  prepareStore?: (store: MockStore) => void,
) {
  return renderBackoffice(
    <MediaToolsProvider value={{ processor }}>
      <BackofficeShell>{ui}</BackofficeShell>
    </MediaToolsProvider>,
    { role, scenario, prepareStore },
  );
}

const rowIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="banner-row"]')).map(
    (el) => el.dataset.id,
  );
const row = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="banner-row"][data-id="${id}"]`)!;
const setValue = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

const FAV = 'Selección de rolls favoritos de Sushi Mon';

async function openCreate() {
  await userEvent.click(screen.getByRole('button', { name: 'Agregar banner' }));
  return await screen.findByRole('dialog', { name: 'Agregar banner' });
}

async function pickFromLibrary(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir de la biblioteca' }));
  const lib = await screen.findByRole('dialog', { name: 'Imágenes de banner' });
  await userEvent.click(await within(lib).findByRole('button', { name: 'Usar la imagen 1' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Imágenes de banner' })).toBeNull(),
  );
}

describe('Banners: lista', () => {
  it('muestra el contador n/5 y los banners en el orden de creación con imagen, texto alternativo y estado', async () => {
    await renderScreen();
    expect(await screen.findByText('4/5 banners')).toBeVisible();
    expect(rowIds()).toEqual([
      'banner-favoritos',
      'banner-happy-hour',
      'banner-calientito',
      'banner-navidad',
    ]);
    expect(within(row('banner-favoritos')).getByText(FAV)).toBeVisible();
    expect(
      within(row('banner-favoritos')).getByText('Activo', { selector: '.pill' }),
    ).toBeVisible();
    expect(
      within(row('banner-navidad')).getByText('Inactivo', { selector: '.pill' }),
    ).toBeVisible();
    expect(within(row('banner-navidad')).getByText('Orden de creación 4')).toBeVisible();
    // Sin controles de reordenar, filtros ni búsqueda (se quitaron).
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('button', { name: /Subir|Bajar/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Agregar banner' })).toBeEnabled();
  });

  it('estado vacío (banners-empty)', async () => {
    await renderScreen(<BannersScreen />, 'admin', 'banners-empty');
    expect(await screen.findByText('Sin banners')).toBeVisible();
    expect(screen.getByText('0/5 banners')).toBeVisible();
  });

  it('error de carga con reintento', async () => {
    await renderScreen(<BannersScreen />, 'admin', 'default', (s) => {
      s.bannersBusy = 1;
    });
    expect(await screen.findByText('No se pudieron cargar los banners.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('4/5 banners')).toBeVisible();
  });

  it('sin banners.read (cocina) no se muestra la pantalla: la API responde 403', async () => {
    await renderScreen(<BannersScreen />, 'kitchen');
    await waitFor(() => expect(screen.queryByText(/\/5 banners/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Agregar banner' })).toBeNull();
  });

  it('activa y desactiva con aviso (PATCH con expectedVersion)', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const sw = () =>
      screen.getByRole('switch', { name: 'Activar banner: Rolls con decoración navideña' });
    await userEvent.click(sw());
    expect(await screen.findByText('Banner activado')).toBeVisible();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    expect(api().store.banners.find((b) => b.id === 'banner-navidad')).toMatchObject({
      active: true,
      version: 2,
    });
    await userEvent.click(sw());
    expect(await screen.findByText('Banner desactivado')).toBeVisible();
  });

  it('un error persistente al activar (503 BANNERS_BUSY) se muestra con role=alert además del aviso', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    api().store.bannersBusy = 1;
    await userEvent.click(
      screen.getByRole('switch', { name: 'Activar banner: Rolls con decoración navideña' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Hay otra edición en curso/);
    await userEvent.click(within(alert).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('un cambio ajeno al activar (409 BANNER_VERSION_CONFLICT) refresca la lista y avisa', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    api().store.banners.find((b) => b.id === 'banner-navidad')!.version = 2;
    await userEvent.click(
      screen.getByRole('switch', { name: 'Activar banner: Rolls con decoración navideña' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Otra persona modificó este banner/);
  });
});

describe('Banners: tope de 5', () => {
  it('con 5 banners «Agregar banner» queda deshabilitado con aviso; al eliminar uno se habilita', async () => {
    const { api } = await renderScreen(<BannersScreen />, 'admin', 'default', (s) => {
      s.banners.push({
        ...s.banners[0]!,
        id: 'banner-quinto',
        code: 'quinto',
        createdAt: '2026-10-30T18:00:00.000Z',
      });
    });
    expect(await screen.findByText('5/5 banners')).toBeVisible();
    const add = screen.getByRole('button', { name: 'Agregar banner' });
    expect(add).toBeDisabled();
    expect(screen.getByText(/Ya hay 5 banners \(el máximo\)/)).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Eliminar banner: Rolls con decoración navideña' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar banner' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar banner' }));
    expect(await screen.findByText('4/5 banners')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Agregar banner' })).toBeEnabled();
    expect(api().store.banners.some((b) => b.id === 'banner-navidad')).toBe(false);
  });

  it('409 BANNER_LIMIT_REACHED (otra persona creó el 5.º): explica el tope, conserva el formulario y recarga la lista', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await pickFromLibrary(dialog);
    await userEvent.type(within(dialog).getByLabelText(/^Texto alternativo/), 'Mi banner');
    api().store.banners.push({
      ...api().store.banners[0]!,
      id: 'banner-ajeno',
      code: 'ajeno',
      createdAt: '2026-10-30T18:00:00.000Z',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await within(dialog).findByText(/Ya hay 5 banners/)).toBeVisible();
    expect(within(dialog).getByLabelText(/^Texto alternativo/)).toHaveValue('Mi banner');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('5/5 banners')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Agregar banner' })).toBeDisabled();
  });
});

describe('Banner: alta', () => {
  it('el formulario solo pide imagen, texto alternativo y activo, con su ayuda; sin títulos, destino ni fechas', async () => {
    await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    expect(within(dialog).getByLabelText(/^Texto alternativo/)).toBeVisible();
    expect(within(dialog).getByText(/Describe lo que se ve/)).toBeVisible();
    expect(within(dialog).getByRole('switch', { name: 'Activo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    for (const label of [
      /Título/,
      /Subtítulo/,
      /Destino/,
      /Vigencia|Inicio/,
      /Código/,
      /Prioridad/,
    ]) {
      expect(within(dialog).queryByLabelText(label)).toBeNull();
    }
    expect(within(dialog).queryByText(/inglés/i)).toBeNull();
  });

  it('valida antes de enviar y enfoca el primer campo con error (la imagen)', async () => {
    await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(within(dialog).getByText('Elige o sube una imagen.')).toBeVisible();
    expect(within(dialog).getByText('Escribe el texto alternativo de la imagen.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Subir imagen' })).toHaveFocus();
    setValue(within(dialog).getByLabelText(/^Texto alternativo/), 'a'.repeat(125));
    await pickFromLibrary(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(within(dialog).getByText(/admite hasta 120 caracteres/)).toBeVisible();
    expect(within(dialog).getByLabelText(/^Texto alternativo/)).toHaveFocus();
  });

  it('crea un banner con una imagen de la biblioteca; aparece al final con la vista previa recortada', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    expect(within(dialog).getByText(/Elige una imagen para ver la vista previa/)).toBeVisible();
    await pickFromLibrary(dialog);
    expect(await within(dialog).findByTestId('banner-preview')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText(/^Texto alternativo/), '  Nuevo banner  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await screen.findByText('Banner creado')).toBeVisible();
    expect(await screen.findByText('5/5 banners')).toBeVisible();
    const created = api().store.banners.at(-1)!;
    expect(created).toMatchObject({ imageAlt: 'Nuevo banner', active: true, version: 1 });
    expect(rowIds().at(-1)).toBe(created.id);
  });

  it('sube una imagen nueva: optimiza (3:1), muestra el resultado, pide el intent BANNER_IMAGE y la usa', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await userEvent.upload(
      within(dialog).getByLabelText('Seleccionar la imagen del banner'),
      png(),
    );
    expect(await within(dialog).findByText(/Imagen lista · de .+ a 1 KiB/)).toBeVisible();
    const asset = api()
      .store.mediaAssets.filter((a) => a.kind === 'BANNER_IMAGE')
      .at(-1)!;
    expect(asset).toMatchObject({ status: 'READY', mimeType: 'image/webp', sizeBytes: 900 });
    expect(asset.objectKey).toMatch(/^banners\/2026\//);
    expect(within(dialog).getByText('Almacén simulado')).toBeVisible();
  });

  it('un archivo que no es imagen muestra el error sin borrar el texto alternativo', async () => {
    await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Texto alternativo/), 'Sigue aquí');
    await userEvent.upload(
      within(dialog).getByLabelText('Seleccionar la imagen del banner'),
      new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
      { applyAccept: false },
    );
    expect(await within(dialog).findByText(/Formato no admitido/)).toBeVisible();
    expect(within(dialog).getByLabelText(/^Texto alternativo/)).toHaveValue('Sigue aquí');
  });

  it('503 BANNERS_BUSY: mensaje reintentable y conserva los datos', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await pickFromLibrary(dialog);
    await userEvent.type(within(dialog).getByLabelText(/^Texto alternativo/), 'Ocupado');
    api().store.bannersBusy = 1;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await within(dialog).findByText(/Hay otra edición en curso/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await screen.findByText('Banner creado')).toBeVisible();
  });

  it('422 BANNER_ALT_INVALID del servidor queda en el campo', async () => {
    await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openCreate();
    await pickFromLibrary(dialog);
    // El cliente deja pasar caracteres que el servidor rechaza (p. ej. una regla futura): se simula con un invisible.
    setValue(within(dialog).getByLabelText(/^Texto alternativo/), 'ok​ok');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await within(dialog).findByText(/no admite caracteres de control/)).toBeVisible();
  });
});

describe('Banner: edición', () => {
  const openEdit = async () => {
    await userEvent.click(screen.getByRole('button', { name: `Editar banner: ${FAV}` }));
    return await screen.findByRole('dialog', { name: 'Editar banner' });
  };

  it('carga el detalle, cambia el texto alternativo y solo envía lo que cambió con expectedVersion', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openEdit();
    const alt = await within(dialog).findByLabelText(/^Texto alternativo/);
    expect(alt).toHaveValue(FAV);
    await userEvent.clear(alt);
    await userEvent.type(alt, 'Favoritos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Banner actualizado')).toBeVisible();
    const b = api().store.banners.find((x) => x.id === 'banner-favoritos')!;
    expect(b).toMatchObject({ version: 2, imageAlt: 'Favoritos', active: true });
    expect(b.imageAssetId).toBe('media-seed-banner-favoritos');
  });

  it('cambia la imagen y el estado desde el formulario', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openEdit();
    await within(dialog).findByLabelText(/^Texto alternativo/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir de la biblioteca' }));
    const lib = await screen.findByRole('dialog', { name: 'Imágenes de banner' });
    await within(lib).findByRole('button', { name: 'Usar la imagen 1' });
    const other = within(lib)
      .getAllByRole('button', { name: /^Usar la imagen/ })
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    await userEvent.click(other);
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Activo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Banner actualizado')).toBeVisible();
    const b = api().store.banners.find((x) => x.id === 'banner-favoritos')!;
    expect(b.active).toBe(false);
    expect(b.imageAssetId).not.toBe('media-seed-banner-favoritos');
  });

  it('sin cambios no envía nada', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openEdit();
    await within(dialog).findByLabelText(/^Texto alternativo/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Sin cambios que guardar')).toBeVisible();
    expect(api().store.banners.find((x) => x.id === 'banner-favoritos')!.version).toBe(1);
  });

  it('409 BANNER_VERSION_CONFLICT: ofrece cargar la versión actual y no pisa los cambios ajenos', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openEdit();
    const alt = await within(dialog).findByLabelText(/^Texto alternativo/);
    const stored = api().store.banners.find((x) => x.id === 'banner-favoritos')!;
    stored.imageAlt = 'Cambio ajeno';
    stored.version = 2;
    await userEvent.clear(alt);
    await userEvent.type(alt, 'Mi texto');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialog).findByText(/Otra persona modificó este banner/)).toBeVisible();
    expect(stored.imageAlt).toBe('Cambio ajeno');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar la versión actual' }));
    expect(await screen.findByDisplayValue('Cambio ajeno')).toBeVisible();
  });

  it('404: si el banner ya no existe al abrirlo lo dice', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    api().store.banners = api().store.banners.filter((b) => b.id !== 'banner-favoritos');
    await userEvent.click(screen.getByRole('button', { name: `Editar banner: ${FAV}` }));
    expect(await screen.findByText('El banner ya no existe.')).toBeVisible();
  });
});

describe('Banner: eliminar', () => {
  const openDelete = async () => {
    await userEvent.click(screen.getByRole('button', { name: `Eliminar banner: ${FAV}` }));
    return await screen.findByRole('dialog', { name: 'Eliminar banner' });
  };

  it('pide confirmación y no borra si se cancela', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openDelete();
    expect(within(dialog).getByText(/no se puede deshacer/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Eliminar banner' })).toBeNull();
    expect(api().store.banners).toHaveLength(4);
  });

  it('elimina con expectedVersion, avisa y actualiza el contador', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openDelete();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar banner' }));
    expect(await screen.findByText('Banner eliminado')).toBeVisible();
    expect(await screen.findByText('3/5 banners')).toBeVisible();
    expect(rowIds()).not.toContain('banner-favoritos');
    expect(api().store.banners.some((b) => b.id === 'banner-favoritos')).toBe(false);
  });

  it('409 BANNER_VERSION_CONFLICT: el diálogo sigue abierto con el aviso y la lista se refresca', async () => {
    const { api } = await renderScreen();
    await screen.findByText('4/5 banners');
    const dialog = await openDelete();
    api().store.banners.find((b) => b.id === 'banner-favoritos')!.version = 2;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar banner' }));
    expect(await within(dialog).findByText(/Otra persona modificó este banner/)).toBeVisible();
    expect(api().store.banners).toHaveLength(4);
    // Con la versión nueva, reintentar funciona.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar banner' }));
    expect(await screen.findByText('Banner eliminado')).toBeVisible();
  });
});

describe('Banners: permisos', () => {
  it('con alcance acotado (una sola sucursal) la API responde 403 y la pantalla lo dice', async () => {
    await renderScreen(<BannersScreen />, 'manager', 'default', (s) => {
      s.roles
        .find((r) => r.code === 'manager')
        ?.permissions.push('banners.read', 'banners.create', 'banners.update');
    });
    await waitFor(() => expect(screen.queryByText(/\/5 banners/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Agregar banner' })).toBeNull();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { MediaToolsProvider } from '@/features/media/tools';
import type { StaffRole } from '@/lib/data-access/models';
import { MediaClientError, sha256HexOfBlob, type ImageProcessor } from '@/lib/media-optimize';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice, type BackofficeTestApi } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import * as media from '@/services/media';
import * as products from '@/services/products';
import type { MediaUploader, UploadRequest } from '@/services/media-uploader';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/**
 * Alta de producto CON imágenes (F11 + F14): se eligen como archivos en el alta, no se llama a la API de medios hasta que el
 * producto existe, y luego se suben con la cola de F14. Cubre 0/1/varias, falla parcial (modo edición sin duplicar), sin permiso
 * de medios, almacenamiento no disponible y doble clic.
 */

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, fill = 1) =>
  new File([Uint8Array.from([...PNG_HEAD, ...new Array(40).fill(fill)])], name, {
    type: 'image/png',
  });

function fakeProcessor(): ImageProcessor {
  let n = 0;
  return {
    measure: async () => ({ width: 1000, height: 800 }),
    encodeWebp: async () => new Blob([new Uint8Array(600).fill(++n % 250)], { type: 'image/webp' }),
  };
}

interface PendingUpload {
  req: UploadRequest;
  finish: () => Promise<void>;
  fail: (error: Error) => void;
}

const holder: { api: () => BackofficeTestApi } = { api: () => null as never };

/** Uploader controlado: la prueba decide cuándo termina o falla cada PUT. */
function controlledUploader() {
  const pending: PendingUpload[] = [];
  const uploader: MediaUploader = {
    kind: 'http',
    upload: (req) =>
      new Promise<void>((resolve, reject) => {
        pending.push({
          req,
          fail: reject,
          finish: async () => {
            await media.putSimulatedMediaObject(holder.api().client, req.assetId, {
              sizeBytes: req.body.size,
              contentType: 'image/webp',
              checksumSha256: await sha256HexOfBlob(req.body),
            });
            resolve();
          },
        });
      }),
  };
  return { uploader, pending };
}

let tools: { processor?: ImageProcessor; uploader?: MediaUploader } = {};

async function renderScreen(role: StaffRole = 'admin', prepareStore?: (s: MockStore) => void) {
  const ui = (): ReactElement => (
    <BackofficeShell>
      <MediaToolsProvider value={tools}>
        <ProductsScreen />
      </MediaToolsProvider>
    </BackofficeShell>
  );
  const result = await renderBackoffice(ui(), { role, prepareStore });
  holder.api = result.api;
  return result;
}

const created = vi.fn();
const revoked = vi.fn();
let blobSeq = 0;

beforeEach(() => {
  resetNavigationMock('/backoffice/productos');
  tools = { processor: fakeProcessor() };
  blobSeq = 0;
  created.mockReset();
  revoked.mockReset();
  URL.createObjectURL = ((blob: Blob) => {
    created(blob);
    return `blob:test/${++blobSeq}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => revoked(url)) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  // @ts-expect-error — jsdom no define estas funciones; se restauran como estaban.
  delete URL.createObjectURL;
  // @ts-expect-error — idem.
  delete URL.revokeObjectURL;
});

async function openNew() {
  await screen.findByText('Dumplings');
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
  return screen.findByRole('dialog', { name: 'Nuevo producto' });
}

async function fillBasics(dialog: HTMLElement, name = 'Roll Mon') {
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), name);
  await userEvent.selectOptions(
    within(dialog).getByRole('combobox', { name: /^Categoría/ }),
    'Sushi Rolls',
  );
  await userEvent.type(within(dialog).getByLabelText(/^Precio/), '48.50');
}

const chooser = (dialog: HTMLElement) =>
  within(dialog).getByLabelText('Seleccionar imágenes para subir');
const save = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Guardar producto' });
const productsNamed = (api: BackofficeTestApi, name: string) =>
  api.store.products.filter((p) => p.name === name);

describe('Alta con imágenes: selección local', () => {
  it('al crear ofrece «Imágenes» (selector y zona de soltar) y ya no el aviso «Guarda el producto…»', async () => {
    await renderScreen();
    const dialog = await openNew();
    expect(within(dialog).getByRole('heading', { name: 'Imágenes' })).toBeVisible();
    expect(within(dialog).getByRole('group', { name: 'Zona para soltar imágenes' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Elegir imágenes' })).toBeEnabled();
    expect(within(dialog).queryByText(/Guarda el producto para poder añadir/)).toBeNull();
    expect(within(dialog).getAllByText('Simulación').length).toBeGreaterThan(0);
  });

  it('elegir y soltar archivos: vista previa local, principal = la primera, quitar revoca la vista previa; no hay llamadas de medios', async () => {
    const { api } = await renderScreen();
    const assetsBefore = api().store.mediaAssets.length;
    const dialog = await openNew();
    await userEvent.upload(chooser(dialog), [png('uno.png', 1), png('dos.png', 2)]);
    const list = within(dialog).getByRole('list', {
      name: 'Imágenes elegidas para el nuevo producto',
    });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Principal')).toBeVisible();
    expect(rows[0]!.querySelector('img')).toHaveAttribute('src', 'blob:test/1');
    expect(within(dialog).getByText('2/8')).toBeVisible();

    // Arrastrar y soltar.
    const zone = within(dialog).getByRole('group', { name: 'Zona para soltar imágenes' });
    fireEvent.drop(zone, { dataTransfer: { files: [png('tres.png', 3)] } });
    expect(await within(dialog).findByText('3/8')).toBeVisible();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Quitar uno.png de la selección' }),
    );
    expect(revoked).toHaveBeenCalledWith('blob:test/1');
    expect(within(dialog).getByText('2/8')).toBeVisible();
    expect(api().store.mediaAssets).toHaveLength(assetsBefore); // nada se pidió a la API de medios
  });

  it('reordena con subir/bajar y respeta el tope de 8; omite tipos no admitidos', async () => {
    await renderScreen();
    const dialog = await openNew();
    await userEvent.upload(chooser(dialog), [png('a.png', 1), png('b.png', 2)]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir la imagen 2' }));
    const rows = within(dialog)
      .getByRole('list', { name: 'Imágenes elegidas para el nuevo producto' })
      .querySelectorAll('li');
    expect(within(rows[0] as HTMLElement).getByText('b.png')).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText('Principal')).toBeVisible();

    const many = Array.from({ length: 8 }, (_, i) => png(`m${i}.png`, i + 10));
    await userEvent.upload(chooser(dialog), many);
    expect(within(dialog).getByText('8/8')).toBeVisible();
    expect(within(dialog).getByText(/2 archivos no cupieron/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Elegir imágenes' })).toBeDisabled();

    const gif = new File(['GIF89a.......'], 'animada.gif', { type: 'image/gif' });
    fireEvent.drop(within(dialog).getByRole('group', { name: 'Zona para soltar imágenes' }), {
      dataTransfer: { files: [gif] },
    });
    // Con el cupo lleno el GIF se rechaza por tipo antes que por cupo.
    expect(await within(dialog).findByText(/no es JPEG, PNG, WebP ni AVIF/)).toBeVisible();
  });
});

describe('Alta con imágenes: guardar', () => {
  it('0 imágenes: crea y cierra como antes (sin cola ni llamadas de medios)', async () => {
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Roll Mon» creado')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api().store.mediaAssets.filter((a) => a.id.startsWith('media-asset'))).toHaveLength(0);
  });

  it('1 imagen: crea el producto, sube con el id devuelto (con alt), cierra con aviso y la imagen llega a la tienda y a la lista', async () => {
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), png('foto.png'));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Texto alternativo de la imagen 1' }),
      'Roll con salsa',
    );
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Roll Mon» creado con 1 imagen')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const [product] = productsNamed(api(), 'Roll Mon');
    expect(product!.media).toHaveLength(1);
    expect(product!.media[0]).toMatchObject({ altText: 'Roll con salsa', sortOrder: 0 });
    // La tienda (consulta pública) ve la imagen sin recargar la página.
    const pub = await products.getStoreProduct(api().client, product!.slug);
    expect(pub.media).toHaveLength(1);
    // La lista del backoffice se refrescó: la tarjeta muestra la miniatura.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'roll mon');
    const card = (await screen.findByText('Roll Mon')).closest('.pcard') as HTMLElement;
    await waitFor(() => expect(card.querySelector('img, [role="img"]')).not.toBeNull());
  });

  it('varias imágenes: se suben en el orden elegido (la primera es la principal) mostrando progreso por archivo', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), [png('a.png', 1), png('b.png', 2), png('c.png', 3)]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bajar la imagen 1' })); // b, a, c
    await userEvent.click(save(dialog));

    // El producto existe y el modal pasó a edición; el progreso se anuncia y la lista de cola muestra cada archivo.
    expect(await screen.findByRole('dialog', { name: 'Editar producto' })).toBeVisible();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(within(dialog).getByText(/Producto creado\. Subiendo imágenes: 0 de 3/)).toBeVisible();
    const row = (n: string) => within(dialog).getByRole('listitem', { name: `Archivo ${n}` });
    expect(within(row('a.png')).getByText('En espera')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await pending[0]!.finish();
    await waitFor(() => expect(pending).toHaveLength(2));
    await pending[1]!.finish();
    await waitFor(() => expect(pending).toHaveLength(3));
    await pending[2]!.finish();

    expect(await screen.findByText('Producto «Roll Mon» creado con 3 imágenes')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [product] = productsNamed(api(), 'Roll Mon');
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
    expect(product!.media.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
    expect(product!.media).toHaveLength(3);
  });

  it('falla parcial: el producto queda creado, el modal pasa a EDICIÓN con aviso, y «Reintentar» no duplica el producto', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), [png('a.png', 1), png('b.png', 2)]);
    await userEvent.click(save(dialog));
    await waitFor(() => expect(pending).toHaveLength(1));
    await pending[0]!.finish();
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.fail(new MediaClientError('network', 'sin red'));

    const alert = await within(dialog).findByText('Producto creado; falta 1 imagen.');
    expect(alert).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeVisible();
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
    const failed = within(dialog).getByRole('listitem', { name: 'Archivo b.png' });
    expect(
      within(failed).getByText('Sin conexión con el almacenamiento. Reintenta.'),
    ).toBeVisible();
    // Los datos del formulario son los del producto creado (slug generado) y guardar de nuevo NO crea otro.
    expect(within(dialog).getByRole('textbox', { name: /^Slug/ })).toHaveValue('roll-mon');
    await userEvent.click(save(dialog));
    expect(await screen.findByText('No hay cambios que guardar')).toBeVisible();
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
  });

  it('falla parcial: reintentar termina, cierra con aviso y quedan las dos imágenes; «Quitar» descarta el archivo', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), [png('a.png', 1), png('b.png', 2)]);
    await userEvent.click(save(dialog));
    await waitFor(() => expect(pending).toHaveLength(1));
    await pending[0]!.finish();
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.fail(new MediaClientError('network', 'sin red'));
    await within(dialog).findByText('Producto creado; falta 1 imagen.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reintentar b.png' }));
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2]!.req.assetId).not.toBe(pending[1]!.req.assetId);
    await pending[2]!.finish();
    await waitFor(() => expect(within(dialog).queryByText(/faltan?/)).toBeNull());
    expect(productsNamed(api(), 'Roll Mon')[0]!.media).toHaveLength(2);
    // Con un fallo previo NO se cierra solo: la persona decide (cierra con «Cancelar»).
    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeVisible();
  });

  it('falla parcial: quitar el archivo fallido deja el producto con las demás y sin aviso', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), [png('a.png', 1)]);
    await userEvent.click(save(dialog));
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.fail(new MediaClientError('uploadRejected', 'rechazado', 403));
    await within(dialog).findByText('Producto creado; falta 1 imagen.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar a.png de la cola' }));
    expect(within(dialog).queryByText(/Producto creado; falta/)).toBeNull();
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
    expect(productsNamed(api(), 'Roll Mon')[0]!.media).toHaveLength(0);
  });

  it('doble clic en «Guardar producto» crea un solo producto', async () => {
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), png('a.png'));
    const button = save(dialog);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(document.getElementById(button.getAttribute('form')!)!);
    await screen.findByText('Producto «Roll Mon» creado con 1 imagen');
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
    expect(productsNamed(api(), 'Roll Mon')[0]!.media).toHaveLength(1);
  });

  it('error del alta (409 slug): no sube nada, conserva la selección y permite reintentar', async () => {
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog, 'Otro');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'dumplings');
    await userEvent.upload(chooser(dialog), png('a.png'));
    await userEvent.click(save(dialog));
    expect(await within(dialog).findByText('Este slug ya está en uso.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Nuevo producto' })).toBeVisible();
    expect(within(dialog).getByText('1/8')).toBeVisible();
    expect(api().store.mediaAssets.filter((a) => a.id.startsWith('media-asset'))).toHaveLength(0);
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /^Slug/ }));
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Otro» creado con 1 imagen')).toBeVisible();
    expect(productsNamed(api(), 'Otro')).toHaveLength(1);
  });

  it('sin permiso para adjuntar medios (crea pero no `catalog.update`): aviso en el alta, el producto se crea sin imágenes', async () => {
    const { api } = await renderScreen('admin', (store) => {
      const role = store.roles.find((r) => r.code === 'admin')!;
      role.permissions = role.permissions.filter((p) => p !== 'catalog.update');
    });
    const dialog = await openNew();
    expect(within(dialog).getByText(/adjuntar imágenes requiere editar el catálogo/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Elegir imágenes' })).toBeNull();
    await fillBasics(dialog);
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Roll Mon» creado')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
  });

  it('permiso de medios revocado tras abrir el alta (403 al subir): el producto queda creado y el archivo falla sin «Reintentar»', async () => {
    const { api } = await renderScreen();
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), png('a.png'));
    const role = api().store.roles.find((r) => r.code === 'admin')!;
    // Se conserva `catalog.create` (el alta funciona) y se revoca `catalog.update` (la API de medios responde 403).
    role.permissions = role.permissions.filter((p) => p !== 'catalog.update');
    await userEvent.click(save(dialog));
    expect(await within(dialog).findByText('Producto creado; falta 1 imagen.')).toBeVisible();
    const row = within(dialog).getByRole('listitem', { name: 'Archivo a.png' });
    expect(within(row).getByText('No tienes permiso para gestionar imágenes.')).toBeVisible();
    expect(within(row).queryByRole('button', { name: 'Reintentar a.png' })).toBeNull();
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
  });

  it('almacenamiento no disponible (503): el producto se crea igual; el modal avisa y ofrece añadirlas luego', async () => {
    const { api } = await renderScreen('admin', (store) => {
      store.mediaStorageUnavailable = true;
    });
    const dialog = await openNew();
    await fillBasics(dialog);
    await userEvent.upload(chooser(dialog), png('a.png'));
    await userEvent.click(save(dialog));
    expect(await within(dialog).findByText('Producto creado; falta 1 imagen.')).toBeVisible();
    expect(
      within(dialog).getByText(/añádelas más tarde editando el producto/, { exact: false }),
    ).toBeVisible();
    expect(
      await within(dialog).findByText('Almacenamiento de imágenes no configurado'),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeVisible();
    expect(productsNamed(api(), 'Roll Mon')).toHaveLength(1);
  });
});

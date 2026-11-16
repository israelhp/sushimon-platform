import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { MediaToolsProvider } from '@/features/media/tools';
import type { AdminProduct, StaffRole } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { MediaClientError, sha256HexOfBlob, type ImageProcessor } from '@/lib/media-optimize';
import { MEDIA_MAX_BYTES } from '@/lib/media-rules';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice, type BackofficeTestApi } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import * as media from '@/services/media';
import * as products from '@/services/products';
import type { MediaUploader, UploadRequest } from '@/services/media-uploader';
import { ProductMediaSection } from './components/ProductMediaSection';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

// ── Dobles: canvas y uploader ────────────────────────────────────────────────────────────────
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name: string, fill = 1) =>
  new File([Uint8Array.from([...PNG_HEAD, ...new Array(40).fill(fill)])], name, {
    type: 'image/png',
  });
const gif = (name: string) => new File(['GIF89a.......'], name, { type: 'image/gif' });

/** Canvas falso: «codifica» a WebP con bytes únicos por llamada (checksums distintos). */
function fakeProcessor(encodedBytes = 600): ImageProcessor {
  let n = 0;
  return {
    measure: async () => ({ width: 1000, height: 800 }),
    encodeWebp: async () =>
      new Blob([new Uint8Array(encodedBytes).fill(++n % 250)], { type: 'image/webp' }),
  };
}

interface PendingUpload {
  req: UploadRequest;
  progress: (f: number) => void;
  /** Termina el PUT y registra el objeto en el almacén simulado (lo normal). */
  finish: () => Promise<void>;
  /** Termina el PUT SIN registrar nada (el archivo «no llegó»). */
  resolveOnly: () => void;
  fail: (error: Error) => void;
}

/** Uploader controlado desde la prueba (progreso, éxito, fallo). */
function controlledUploader() {
  const pending: PendingUpload[] = [];
  const uploader: MediaUploader = {
    kind: 'http',
    upload: (req, opts) =>
      new Promise<void>((resolve, reject) => {
        pending.push({
          req,
          progress: (f) => opts?.onProgress?.(f),
          resolveOnly: () => resolve(),
          finish: async () => {
            await media.putSimulatedMediaObject(holder.api().client, req.assetId, {
              sizeBytes: req.body.size,
              contentType: 'image/webp',
              checksumSha256: await sha256HexOfBlob(req.body),
            });
            resolve();
          },
          fail: reject,
        });
      }),
  };
  return { uploader, pending };
}

// ── Montaje ──────────────────────────────────────────────────────────────────────────────────
type Prepare = (store: MockStore) => void;
const holder: { api: () => BackofficeTestApi } = { api: () => null as never };
let tools: { processor?: ImageProcessor; uploader?: MediaUploader } = {};

async function renderScreen(role: StaffRole = 'admin', prepareStore?: Prepare) {
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

async function openEditor(name = 'Dumplings') {
  await screen.findByText(name);
  await userEvent.click(screen.getByRole('button', { name: `Editar ${name}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
  await within(dialog).findByRole('heading', { name: 'Imágenes' });
  return dialog;
}

const chooser = (dialog: HTMLElement) =>
  within(dialog).getByLabelText('Seleccionar imágenes para subir');
const queueRow = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole('listitem', { name: `Archivo ${name}` });

beforeEach(() => {
  tools = { processor: fakeProcessor() };
});

describe('F14 · sección de imágenes del editor', () => {
  it('muestra las imágenes del producto con la principal, la rotulación de simulación y sin campo de URL', async () => {
    await renderScreen();
    const dialog = await openEditor();
    expect(within(dialog).getByText('1/8')).toBeVisible();
    const list = within(dialog).getByRole('list', { name: 'Imágenes del producto' });
    const row = within(list).getByRole('listitem', { name: 'Imagen 1 de 1' });
    expect(within(row).getByText('Principal')).toBeVisible();
    expect(within(dialog).getAllByText('Simulación').length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('textbox', { name: /URL de la imagen/ })).toBeNull();
    // La URL simulada sin bytes no se pide por red: se rotula «Sin vista previa».
    expect(within(row).getByRole('img', { name: 'Dumplings (imagen de ejemplo)' })).toBeVisible();
  });

  it('un producto sin imágenes muestra el estado vacío', async () => {
    await renderScreen();
    const dialog = await openEditor('Gaseosas');
    expect(within(dialog).getByText(/aún no tiene imágenes/)).toBeVisible();
    expect(within(dialog).getByText('0/8')).toBeVisible();
  });

  it('guardar el producto NO envía media (las imágenes se aplican al instante)', async () => {
    const { api } = await renderScreen();
    const before = structuredClone(api().store.products.find((p) => p.id === 'dumplings')!.media);
    const dialog = await openEditor();
    const price = within(dialog).getByLabelText(/^Precio/);
    await userEvent.clear(price);
    await userEvent.type(price, '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api().store.products.find((p) => p.id === 'dumplings')!.media).toEqual(before);
  });
});

describe('F14 · cola de subida', () => {
  it('varios archivos: se procesan en orden con estado y barra de progreso, y se añaden al producto', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen();
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), [png('uno.png', 1), png('dos.png', 2)]);

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(within(queueRow(dialog, 'dos.png')).getByText('En espera')).toBeVisible();
    pending[0]!.progress(0.4);
    expect(await within(queueRow(dialog, 'uno.png')).findByText('Subiendo… 40%')).toBeVisible();
    const bar = within(queueRow(dialog, 'uno.png')).getByRole('progressbar', {
      name: 'Progreso de uno.png',
    });
    expect(bar).toHaveAttribute('value', '40');

    await pending[0]!.finish();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(await within(queueRow(dialog, 'uno.png')).findByText('Listo')).toBeVisible();
    await pending[1]!.finish();
    expect(await within(queueRow(dialog, 'dos.png')).findByText('Listo')).toBeVisible();

    expect(await within(dialog).findByRole('listitem', { name: 'Imagen 2 de 2' })).toBeVisible();
    expect(within(dialog).getByText('2/8')).toBeVisible();
    // Se subió lo OPTIMIZADO (WebP) con los headers firmados que devolvió el intent, sin añadir ninguno.
    expect(pending[0]!.req.body.type).toBe('image/webp');
    expect(Object.keys(pending[0]!.req.headers).sort()).toEqual([
      'Cache-Control',
      'Content-Type',
      'x-amz-checksum-sha256',
    ]);
    expect(api().store.products.find((p) => p.id === 'gaseosas')!.media).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar las listas' }));
    expect(within(dialog).queryByRole('list', { name: 'Cola de subida' })).toBeNull();
  });

  it('con el almacén simulado por defecto (sin inyectar uploader) el flujo completo termina en «Listo»', async () => {
    const { api } = await renderScreen();
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), png('foto.png'));
    expect(await within(dialog).findByText('Listo')).toBeVisible();
    expect(await within(dialog).findByRole('listitem', { name: 'Imagen 1 de 1' })).toBeVisible();
    const asset = api().store.mediaAssets.find(
      (a) => a.status === 'READY' && a.id.startsWith('media-asset'),
    );
    expect(asset?.mimeType).toBe('image/webp');
    // Se invalidó la ficha pública: la tienda ve la nueva imagen en su lista.
    const pub = await products.getStoreProduct(api().client, 'gaseosas');
    expect(pub.media).toHaveLength(1);
  });

  it('un archivo repetido (mismo contenido) se deduplica y solo se vincula', async () => {
    const body = new Uint8Array(600).fill(9);
    tools = {
      processor: {
        measure: async () => ({ width: 10, height: 10 }),
        encodeWebp: async () => new Blob([body], { type: 'image/webp' }),
      },
    };
    const { api } = await renderScreen();
    // El «canvas» produce justo el contenido del asset sembrado.
    const seed = api().store.mediaAssets.find((a) => a.id === 'media-seed-2')!;
    seed.checksumSha256 = await sha256HexOfBlob(new Blob([body]));
    seed.sizeBytes = 600;
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), png('repetida.png'));
    expect(await within(dialog).findByText('Listo')).toBeVisible();
    expect(api().store.products.find((p) => p.id === 'gaseosas')!.media[0]?.assetId).toBe(
      'media-seed-2',
    );
    expect(api().store.mediaAssets.filter((a) => a.status === 'PENDING')).toHaveLength(0);
  });

  it('formato no admitido (GIF): error local y se puede quitar de la cola', async () => {
    await renderScreen();
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), gif('animada.gif'), { applyAccept: false });
    const row = queueRow(dialog, 'animada.gif');
    expect(
      await within(row).findByText('Formato no admitido. Usa JPEG, PNG, WebP o AVIF.'),
    ).toBeVisible();
    await userEvent.click(
      within(row).getByRole('button', { name: 'Quitar animada.gif de la cola' }),
    );
    expect(within(dialog).queryByRole('listitem', { name: 'Archivo animada.gif' })).toBeNull();
  });

  it('MEDIA_TOO_LARGE local: más de 5 MiB tras optimizar', async () => {
    tools = { processor: fakeProcessor(MEDIA_MAX_BYTES + 1) };
    await renderScreen();
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), png('enorme.png'));
    expect(
      await within(dialog).findByText(
        'La imagen supera 5 MiB incluso optimizada. Usa una más pequeña.',
      ),
    ).toBeVisible();
  });

  it('error de red del PUT: «Reintentar» pide un intent NUEVO y termina', async () => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    await renderScreen();
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), png('a.png'));
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.fail(new MediaClientError('network', 'sin red'));
    const row = queueRow(dialog, 'a.png');
    expect(
      await within(row).findByText('Sin conexión con el almacenamiento. Reintenta.'),
    ).toBeVisible();
    await userEvent.click(within(row).getByRole('button', { name: 'Reintentar a.png' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.req.assetId).not.toBe(pending[0]!.req.assetId);
    await pending[1]!.finish();
    expect(await within(row).findByText('Listo')).toBeVisible();
  });

  /** Monta con un uploader controlado y sube `a.png`; `prepare` ajusta el store antes. */
  const scenario = async (prepare?: Prepare) => {
    const { uploader, pending } = controlledUploader();
    tools = { processor: fakeProcessor(), uploader };
    const { api } = await renderScreen('admin', prepare);
    const dialog = await openEditor('Gaseosas');
    await userEvent.upload(chooser(dialog), png('a.png'));
    return { dialog, row: () => queueRow(dialog, 'a.png'), pending, api: api() };
  };

  it('MEDIA_UPLOAD_EXPIRED (410): mensaje y «Reintentar» genera un intent nuevo', async () => {
    const { row, pending, api } = await scenario();
    await waitFor(() => expect(pending).toHaveLength(1));
    // El objeto llega a tiempo…
    await media.putSimulatedMediaObject(api.client, pending[0]!.req.assetId, {
      sizeBytes: pending[0]!.req.body.size,
      contentType: 'image/webp',
      checksumSha256: await sha256HexOfBlob(pending[0]!.req.body),
    });
    api.clock.advance(301_000); // …pero el intent caduca antes de confirmar
    pending[0]!.resolveOnly();
    expect(
      await within(row()).findByText('La carga caducó. Reintenta para generar una nueva.'),
    ).toBeVisible();
    await userEvent.click(within(row()).getByRole('button', { name: 'Reintentar a.png' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await pending[1]!.finish();
    expect(await within(row()).findByText('Listo')).toBeVisible();
    expect(api.store.products.find((p) => p.id === 'gaseosas')!.media).toHaveLength(1);
  });

  it('MEDIA_OBJECT_MISSING (422): el archivo no llegó al almacenamiento', async () => {
    const { row, pending } = await scenario();
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolveOnly(); // el PUT «termina» pero no se registró ningún objeto
    expect(
      await within(row()).findByText('El archivo no llegó al almacenamiento. Reintenta.'),
    ).toBeVisible();
  });

  it('MEDIA_CONTENT_MISMATCH (422): lo subido no coincide con lo declarado', async () => {
    const { row, pending, api } = await scenario();
    await waitFor(() => expect(pending).toHaveLength(1));
    await media.putSimulatedMediaObject(api.client, pending[0]!.req.assetId, {
      sizeBytes: 1,
      contentType: 'image/webp',
      checksumSha256: '0'.repeat(64),
    });
    pending[0]!.resolveOnly();
    expect(
      await within(row()).findByText(
        'El archivo subido no coincide con lo declarado. Prueba con otro archivo.',
      ),
    ).toBeVisible();
    expect(api.store.mediaAssets.some((a) => a.id === pending[0]!.req.assetId)).toBe(false);
  });

  it('MEDIA_PENDING_LIMIT_REACHED (422)', async () => {
    const { row } = await scenario((store) => {
      for (let i = 0; i < 50; i++) {
        store.mediaAssets.push({
          id: `p-${i}`,
          kind: 'PRODUCT_IMAGE',
          status: 'PENDING',
          mimeType: 'image/webp',
          sizeBytes: 10,
          checksumSha256: String(i).padStart(64, '0'),
          objectKey: `products/2026/p-${i}.webp`,
          createdAt: '2026-11-11T20:25:00.000Z',
          confirmedAt: null,
          expiresAt: '2026-11-11T21:25:00.000Z',
          createdById: 'u1',
        });
      }
    });
    expect(
      await within(row()).findByText(
        'Hay demasiadas cargas pendientes. Espera unos minutos y reintenta.',
      ),
    ).toBeVisible();
  });

  it('MEDIA_BUSY (503): mensaje reintentable y el segundo intento funciona', async () => {
    const { row, pending } = await scenario((s) => {
      s.mediaBusy = 1;
    });
    expect(
      await within(row()).findByText('Hay otra edición en curso. Espera un momento y reintenta.'),
    ).toBeVisible();
    await userEvent.click(within(row()).getByRole('button', { name: 'Reintentar a.png' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await pending[0]!.finish();
    expect(await within(row()).findByText('Listo')).toBeVisible();
  });

  it('MEDIA_STORAGE_UNAVAILABLE (503): indicador «Almacenamiento de imágenes no configurado» y se puede seguir editando textos', async () => {
    await renderScreen('admin', (s) => {
      s.mediaStorageUnavailable = true;
    });
    const dialog = await openEditor();
    await userEvent.upload(chooser(dialog), png('a.png'));
    expect(
      await within(dialog).findByText('Almacenamiento de imágenes no configurado'),
    ).toBeVisible();
    expect(
      within(queueRow(dialog, 'a.png')).getByText(
        'Almacenamiento de imágenes no disponible. Inténtalo más tarde.',
      ),
    ).toBeVisible();
    // Los textos alternativos y el orden siguen disponibles.
    const alt = within(dialog).getByRole('textbox', { name: 'Texto alternativo de la imagen 1' });
    await userEvent.clear(alt);
    await userEvent.type(alt, 'Nuevo texto');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Guardar texto de la imagen 1' }),
    );
    expect(await screen.findByText('Texto alternativo guardado')).toBeVisible();
  });

  it('tope de 8 por producto: lo que no cabe queda como error y no se sube', async () => {
    await renderScreen();
    const dialog = await openEditor(); // Dumplings ya tiene 1
    const files = Array.from({ length: 8 }, (_, i) => png(`f${i}.png`, i + 1));
    await userEvent.upload(chooser(dialog), files);
    const last = queueRow(dialog, 'f7.png');
    expect(
      await within(last).findByText(
        'Revisa las imágenes: máximo 8 por producto y texto alternativo de hasta 200 caracteres.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(within(dialog).getByText('8/8')).toBeVisible());
    expect(within(dialog).getByText('El producto ya tiene el máximo de imágenes.')).toBeVisible();
  });

  it('arrastrar y soltar archivos en la zona los encola', async () => {
    await renderScreen();
    const dialog = await openEditor('Gaseosas');
    const zone = within(dialog).getByRole('group', { name: 'Zona para soltar imágenes' });
    const file = png('soltada.png');
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(
      await within(dialog).findByRole('listitem', { name: 'Archivo soltada.png' }),
    ).toBeVisible();
    expect(await within(dialog).findByText('Listo')).toBeVisible();
  });
});

describe('F14 · orden, texto alternativo y desvincular', () => {
  const withThree: Prepare = (store) => {
    const p = store.products.find((x) => x.id === 'dumplings')!;
    for (const [i, id] of ['media-seed-2', 'media-seed-3'].entries()) {
      p.media.push({
        id: `pm-${id}`,
        url: `https://media-simulado.invalid/products/2026/${id}.webp`,
        altText: null,
        sortOrder: i + 1,
        assetId: id,
      });
    }
  };

  it('subir/bajar reordena, conserva el foco y anuncia la posición (aria-live)', async () => {
    const { api } = await renderScreen('admin', withThree);
    const dialog = await openEditor();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bajar la imagen 1' }));
    // La imagen movida ahora es la 2: el foco sigue en su botón «Bajar».
    const down2 = await within(dialog).findByRole('button', { name: 'Bajar la imagen 2' });
    await waitFor(() => expect(down2).toHaveFocus());
    expect(within(dialog).getByText('Imagen movida a la posición 2 de 3')).toBeInTheDocument();
    expect(
      api()
        .store.products.find((p) => p.id === 'dumplings')!
        .media.map((m) => m.id),
    ).toEqual(['pm-media-seed-2', 'media-seed-pm-1', 'pm-media-seed-3']);
    // Al llegar al extremo el botón queda deshabilitado y el foco pasa al opuesto.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bajar la imagen 2' }));
    const up3 = await within(dialog).findByRole('button', { name: 'Subir la imagen 3' });
    await waitFor(() => expect(up3).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Bajar la imagen 3' })).toBeDisabled();
    // La primera sigue marcada como principal.
    const first = within(dialog).getByRole('listitem', { name: 'Imagen 1 de 3' });
    expect(within(first).getByText('Principal')).toBeVisible();
  });

  it('el reorden con la lista desfasada (422 MEDIA_REORDER_MISMATCH) avisa y recarga', async () => {
    const { api } = await renderScreen('admin', withThree);
    const dialog = await openEditor();
    // «Otra sesión» desvincula una imagen: el cliente aún no lo sabe.
    api()
      .store.products.find((p) => p.id === 'dumplings')!
      .media.pop();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bajar la imagen 1' }));
    expect(
      await within(dialog).findByText(
        'El orden no coincide con las imágenes actuales. Se recargó la lista.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(within(dialog).getByText('2/8')).toBeVisible());
  });

  it('edita el texto alternativo (borrador, guardar, vacío lo borra)', async () => {
    const { api } = await renderScreen();
    const dialog = await openEditor();
    const alt = within(dialog).getByRole('textbox', { name: 'Texto alternativo de la imagen 1' });
    const save = within(dialog).getByRole('button', {
      name: 'Guardar texto de la imagen 1',
    });
    expect(save).toBeDisabled();
    await userEvent.clear(alt);
    await userEvent.type(alt, '  Gyozas  ');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(await screen.findByText('Texto alternativo guardado')).toBeVisible();
    expect(api().store.products.find((p) => p.id === 'dumplings')!.media[0]!.altText).toBe(
      'Gyozas',
    );
    await userEvent.clear(alt);
    await userEvent.click(save);
    await waitFor(() =>
      expect(api().store.products.find((p) => p.id === 'dumplings')!.media[0]!.altText).toBeNull(),
    );
  });

  it('desvincular pide confirmación, no borra el asset y se puede cancelar', async () => {
    const { api } = await renderScreen();
    const dialog = await openEditor();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desvincular la imagen 1' }));
    const confirm = await screen.findByRole('dialog', { name: 'Desvincular imagen' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(api().store.products.find((p) => p.id === 'dumplings')!.media).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Desvincular la imagen 1' }));
    const again = await screen.findByRole('dialog', { name: 'Desvincular imagen' });
    expect(within(again).getByText(/El archivo sigue en la biblioteca/)).toBeVisible();
    await userEvent.click(within(again).getByRole('button', { name: 'Desvincular' }));
    expect(await screen.findByText('Imagen desvinculada')).toBeVisible();
    expect(api().store.products.find((p) => p.id === 'dumplings')!.media).toHaveLength(0);
    expect(api().store.mediaAssets.some((a) => a.id === 'media-seed-1')).toBe(true);
    expect(await within(dialog).findByText(/aún no tiene imágenes/)).toBeVisible();
  });
});

describe('F14 · biblioteca de medios', () => {
  async function openLibrary(name = 'Gaseosas') {
    const dialog = await openEditor(name);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Biblioteca de imágenes' }));
    const library = await screen.findByRole('dialog', { name: 'Biblioteca de imágenes' });
    await within(library).findByRole('list');
    return { dialog, library };
  }

  it('lista los READY y permite reutilizar uno en el producto', async () => {
    const { api } = await renderScreen();
    const { dialog, library } = await openLibrary();
    expect(within(library).getAllByRole('listitem')).toHaveLength(3);
    const item = within(library).getAllByRole('listitem')[0]!;
    expect(within(item).getByText(/sin uso|usada en 1/)).toBeVisible();
    await userEvent.click(
      within(library).getByRole('button', { name: 'Añadir al producto: imagen 2' }),
    );
    expect(await screen.findByText('Imagen añadida al producto')).toBeVisible();
    expect(api().store.products.find((p) => p.id === 'gaseosas')!.media).toHaveLength(1);
    await userEvent.click(within(library).getAllByRole('button', { name: 'Cerrar' }).at(-1)!);
    expect(await within(dialog).findByRole('listitem', { name: 'Imagen 1 de 1' })).toBeVisible();
  });

  it('un asset ya vinculado queda deshabilitado y el que está en uso no se puede eliminar', async () => {
    await renderScreen();
    const { library } = await openLibrary('Dumplings');
    expect(
      within(library).getByRole('button', { name: 'Añadir al producto: imagen 3' }),
    ).toBeEnabled();
    expect(within(library).getByText('Ya en este producto')).toBeDisabled();
    // media-seed-1 (usado) no ofrece «Eliminar»; los libres sí.
    expect(within(library).getAllByRole('button', { name: /^Eliminar la imagen/ })).toHaveLength(2);
  });

  it('elimina un asset sin uso con confirmación', async () => {
    const { api } = await renderScreen();
    const { library } = await openLibrary();
    await userEvent.click(
      within(library).getAllByRole('button', { name: /^Eliminar la imagen/ })[0]!,
    );
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar imagen' });
    expect(within(confirm).getByText(/no se puede deshacer/)).toBeVisible();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('Imagen eliminada')).toBeVisible();
    expect(api().store.mediaAssets.filter((a) => a.kind === 'PRODUCT_IMAGE')).toHaveLength(2);
  });

  it('MEDIA_IN_USE (409): mensaje claro si otro producto la usó mientras tanto', async () => {
    const { api } = await renderScreen();
    const { library } = await openLibrary();
    const target = api().store.mediaAssets.find((a) => a.id === 'media-seed-3')!;
    api()
      .store.products.find((p) => p.id === 'dumplings')!
      .media.push({
        id: 'pm-x',
        url: `https://media-simulado.invalid/${target.objectKey}`,
        altText: null,
        sortOrder: 1,
        assetId: target.id,
      });
    const buttons = within(library).getAllByRole('button', { name: /^Eliminar la imagen/ });
    // El orden es createdAt desc, id: el último de la lista es media-seed-3.
    await userEvent.click(buttons.at(-1)!);
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar imagen' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    expect(
      await within(library).findByText(
        'La imagen está en uso por un producto. Desvincúlala antes de eliminarla.',
      ),
    ).toBeVisible();
    expect(api().store.mediaAssets.some((a) => a.id === 'media-seed-3')).toBe(true);
  });

  it('biblioteca vacía (escenario empty) y error de carga con reintento', async () => {
    await renderScreen('admin', (s) => {
      s.mediaAssets = [];
      for (const p of s.products) p.media = [];
    });
    const dialog = await openEditor('Gaseosas');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Biblioteca de imágenes' }));
    const library = await screen.findByRole('dialog', { name: 'Biblioteca de imágenes' });
    expect(await within(library).findByText('La biblioteca no tiene imágenes.')).toBeVisible();
  });
});

describe('F14 · permisos y alcance', () => {
  it('sin catalog.update con alcance global: solo lectura con aviso y controles deshabilitados', async () => {
    await renderBackoffice(
      <BackofficeShell>
        <SectionLoader />
      </BackofficeShell>,
      { role: 'manager' },
    );
    expect(await screen.findByText(/Solo lectura: gestionar imágenes/)).toBeVisible();
    expect(screen.queryByLabelText('Seleccionar imágenes para subir')).toBeNull();
    expect(screen.getByRole('button', { name: 'Subir la imagen 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desvincular la imagen 1' })).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'Texto alternativo de la imagen 1' }),
    ).toBeDisabled();
    // La biblioteca se puede consultar pero no escribir.
    await userEvent.click(screen.getByRole('button', { name: 'Biblioteca de imágenes' }));
    const library = await screen.findByRole('dialog', { name: 'Biblioteca de imágenes' });
    await within(library).findByRole('list');
    for (const b of within(library).getAllByRole('button', { name: /Añadir al producto/ })) {
      expect(b).toBeDisabled();
    }
  });
});

/** Carga «Dumplings» con la sesión del rol y monta la sección sola (el editor exige catalog.update). */
function SectionLoader() {
  const client = useDataClient();
  const [product, setProduct] = useState<AdminProduct | null>(null);
  useEffect(() => {
    void products.getAdminProduct(client, 'dumplings').then(setProduct);
  }, [client]);
  return product ? <ProductMediaSection product={product} /> : null;
}

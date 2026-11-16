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

const row = (code: string) =>
  document.querySelector<HTMLElement>(`[data-testid="banner-row"][data-code="${code}"]`)!;
const codesInOrder = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="banner-row"]')).map(
    (el) => el.dataset.code,
  );
const setValue = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function openCreate() {
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo banner' }));
  return await screen.findByRole('dialog', { name: 'Nuevo banner' });
}

async function pickFromLibrary(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir de la biblioteca' }));
  const lib = await screen.findByRole('dialog', { name: 'Imágenes de banner' });
  await userEvent.click(await within(lib).findByRole('button', { name: 'Usar la imagen 1' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Imágenes de banner' })).toBeNull(),
  );
}

describe('Banners (backoffice)', () => {
  it('lista los banners en el orden de la tienda con estado derivado, vigencia, destino, alcance y motivo de ocultación', async () => {
    await renderScreen();
    expect(await screen.findByText('8 banners')).toBeVisible();
    expect(codesInOrder()).toEqual([
      'favoritos',
      'happy-hour',
      'calientito',
      'equipo',
      'fin-de-mes',
      'navidad-en-rolls',
      'semana-del-cliente',
      'bienvenida',
    ]);
    expect(within(row('favoritos')).getByText('Publicado', { selector: '.pill' })).toBeVisible();
    expect(
      within(row('favoritos')).getByText('Botón a categoría: Sushi Rolls · Todas las sucursales'),
    ).toBeVisible();
    expect(within(row('favoritos')).getByText('Sin fechas: siempre vigente')).toBeVisible();
    expect(
      within(row('navidad-en-rolls')).getByText('Programado', { selector: '.pill' }),
    ).toBeVisible();
    expect(
      within(row('semana-del-cliente')).getByText('Vencido', { selector: '.pill' }),
    ).toBeVisible();
    expect(within(row('bienvenida')).getByText('Inactivo', { selector: '.pill' })).toBeVisible();
    expect(within(row('fin-de-mes')).getByText(/Sucursal 1, Sucursal 2/)).toBeVisible();
    // Happy Hour: publicado por fechas pero oculto porque su promoción aún no rige (14:25).
    expect(
      within(row('happy-hour')).getByText(/Oculto ahora: su promoción vinculada no está vigente/),
    ).toBeVisible();
    expect(within(row('happy-hour')).getByText('Activo pero oculto ahora')).toBeVisible();
    expect(within(row('happy-hour')).getByText(/Promoción: Happy Hour/)).toBeVisible();
    // Avisos: demora de caché y subida solo para administración.
    expect(screen.getAllByText(/hasta 30 segundos/).length).toBeGreaterThan(0);
    expect(screen.getByText(/solo un administrador/)).toBeVisible();
  });

  it('filtra por estado derivado, búsqueda y sucursal; limpia los filtros', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'EXPIRED');
    await waitFor(() => expect(codesInOrder()).toEqual(['semana-del-cliente']));
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'all');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar por título o código' }),
      'merecés',
    );
    await waitFor(() => expect(codesInOrder()).toEqual(['calientito']));
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(codesInOrder()).toHaveLength(8));
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sucursal'), 'sucursal-3');
    await waitFor(() => expect(codesInOrder()).not.toContain('fin-de-mes'));
    expect(codesInOrder()).toContain('favoritos');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar por título o código' }),
      'zzzz',
    );
    expect(await screen.findByText('Ningún banner coincide con los filtros.')).toBeVisible();
  });

  it('la fila se apila en pantallas angostas, sin aria-label en el li, y la píldora EN se nombra', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const li = row('favoritos');
    expect(li.className).toMatch(/grid-cols-1/);
    expect(li.className).toMatch(/min-\[560px\]:grid-cols-/);
    expect(li).not.toHaveAttribute('aria-label');
    expect(within(li).getByRole('img', { name: 'Con versión en inglés' })).toHaveTextContent('EN');
    expect(
      within(row('fin-de-mes')).queryByRole('img', { name: 'Con versión en inglés' }),
    ).toBeNull();
  });

  it('un error persistente al activar (503 BANNERS_BUSY) se muestra con role=alert además del aviso', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    api().store.bannersBusy = 1;
    await userEvent.click(
      screen.getByRole('switch', { name: 'Activar Tu primer pedido, con sorpresa' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Hay otra edición en curso/);
    await userEvent.click(within(alert).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado vacío (banners-empty), con aviso de crear el primero', async () => {
    await renderScreen(<BannersScreen />, 'admin', 'banners-empty');
    expect(await screen.findByText('Sin banners')).toBeVisible();
    expect(screen.getByText(/Crea el primer banner/)).toBeVisible();
  });

  it('activa y desactiva (PATCH …/status) con aviso', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const sw = () => screen.getByRole('switch', { name: 'Activar Tu primer pedido, con sorpresa' });
    await userEvent.click(sw());
    expect(await screen.findByText('Tu primer pedido, con sorpresa activado')).toBeVisible();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(sw());
    expect(await screen.findByText('Tu primer pedido, con sorpresa desactivado')).toBeVisible();
  });

  it('reordena con botones subir/bajar accesibles (PUT /order); los bordes y los vencidos quedan deshabilitados', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bajar Los favoritos de los MONcheros' }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole('button', { name: 'Subir Los favoritos de los MONcheros' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Bajar Tu primer pedido, con sorpresa' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir Semana del cliente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar Semana del cliente' })).toBeDisabled();

    const down = screen.getByRole('button', { name: 'Bajar Los favoritos de los MONcheros' });
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByText('Los favoritos de los MONcheros bajó una posición'),
    ).toBeVisible();
    await waitFor(() =>
      expect(codesInOrder().slice(0, 3)).toEqual(['happy-hour', 'favoritos', 'calientito']),
    );
    expect(api().store.banners.find((b) => b.code === 'favoritos')).toMatchObject({
      sortOrder: 1,
      version: 2,
    });
    // El vencido conserva su prioridad.
    expect(api().store.banners.find((b) => b.code === 'semana-del-cliente')!.sortOrder).toBe(6);

    await userEvent.click(
      screen.getByRole('button', { name: 'Subir Los favoritos de los MONcheros' }),
    );
    await waitFor(() => expect(codesInOrder()[0]).toBe('favoritos'));
  });

  it('con filtros activos no se puede reordenar y lo explica', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'PUBLISHED');
    await waitFor(() => expect(codesInOrder()).not.toContain('bienvenida'));
    expect(screen.getByText(/Quita los filtros para reordenar/)).toBeVisible();
    for (const b of screen.getAllByRole('button', { name: /^Subir / })) expect(b).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: /^Bajar / })) expect(b).toBeDisabled();
  });

  it('un encargado con alcance de una sucursal: ve lo suyo, sin editar ni reordenar lo que no cubre entero', async () => {
    await renderScreen(<BannersScreen />, 'manager', 'default', (s) =>
      s.roles
        .find((r) => r.code === 'manager')!
        .permissions.push('banners.read', 'banners.create', 'banners.update', 'promotions.read'),
    );
    await screen.findByText(/banners$/);
    expect(codesInOrder()).toContain('fin-de-mes');
    expect(
      screen.getByRole('switch', { name: 'Activar Los favoritos de los MONcheros' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Bajar Los favoritos de los MONcheros' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Reordenar exige permiso de edición sobre todas las sucursales/),
    ).toBeVisible();
  });

  it('sin banners.read (cocina) no se muestra la pantalla: la API responde 403', async () => {
    await renderScreen(<BannersScreen />, 'kitchen');
    await waitFor(() => expect(screen.queryByText(/banners$/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Nuevo banner' })).toBeNull();
  });

  it('error de carga con reintento', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    const saved = api().store.banners;
    // Un fallo inesperado del servidor en la siguiente consulta (otra clave de caché).
    api().store.banners = null as never;
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'PUBLISHED');
    expect(await screen.findByText('No se pudieron cargar los banners.')).toBeVisible();
    api().store.banners = saved;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(codesInOrder()).toContain('favoritos'));
    expect(screen.queryByText('No se pudieron cargar los banners.')).toBeNull();
  });
});

describe('Banner: alta y edición', () => {
  it('agrupa el formulario en secciones con título y guía de imagen (zona segura y fotos claras)', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    for (const name of ['Imagen', 'Textos', 'Destino', 'Vigencia y alcance']) {
      expect(within(dialog).getByRole('region', { name })).toBeVisible();
    }
    expect(within(dialog).getByText(/Evita fotos muy claras bajo el texto/)).toBeVisible();
    expect(within(dialog).getByText(/60 % izquierdo o central/)).toBeVisible();
  });

  it('un error de imagen enfoca el botón de subir (el input oculto no es focalizable) y los selects de destino se asocian al error', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Código'), 'ok-code');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    // Primer campo con error en orden: la imagen.
    expect(within(dialog).getByRole('button', { name: 'Subir imagen' })).toHaveFocus();
    await userEvent.selectOptions(within(dialog).getByLabelText('Destino del botón'), 'CATEGORY');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    const select = within(dialog).getByLabelText('Categoría de destino');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('valida el formulario antes de enviar y enfoca el primer campo con error', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(within(dialog).getByText(/El código admite de 3 a 64 caracteres/)).toBeVisible();
    expect(within(dialog).getByText('Elige o sube una imagen para el banner.')).toBeVisible();
    expect(within(dialog).getByText(/El título en español es obligatorio/)).toBeVisible();
    expect(
      within(dialog).getByText(/El texto alternativo en español es obligatorio/),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Código')).toHaveFocus();
    // El CTA es una lista cerrada: no hay campo de URL ni de ruta.
    expect(within(dialog).queryByLabelText(/url|enlace|ruta/i)).toBeNull();
  });

  it('crea un banner con imagen de la biblioteca, textos es/en, CTA a categoría y fechas; aparece en la lista', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Código'), 'Verano-2026');
    await pickFromLibrary(dialog);
    const es = within(
      within(dialog).getByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    await userEvent.type(es.getByLabelText(/^Título/), 'Verano de rolls');
    await userEvent.type(es.getByLabelText(/^Texto alternativo/), 'Rolls frescos');
    const en = within(within(dialog).getByRole('group', { name: 'Textos en inglés (opcionales)' }));
    await userEvent.type(en.getByLabelText('Título'), 'Roll summer');
    await userEvent.selectOptions(within(dialog).getByLabelText('Destino del botón'), 'CATEGORY');
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Categoría de destino'),
      'cat-rolls',
    );
    setValue(within(dialog).getByLabelText('Inicio de la vigencia'), '2026-12-01T08:00');
    setValue(within(dialog).getByLabelText('Fin de la vigencia'), '2026-12-31T23:59');
    // El aviso del cupón y la nota de 30 s están en el formulario.
    expect(within(dialog).getByTestId('coupon-text-warning')).toHaveTextContent(
      /no escribas su código/,
    );
    expect(within(dialog).getByText(/hasta 30 segundos/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await screen.findByText('Banner creado')).toBeVisible();
    await waitFor(() => expect(screen.getByText('9 banners')).toBeVisible());
    const created = api().store.banners.find((b) => b.code === 'verano-2026')!;
    expect(created).toMatchObject({
      version: 1,
      active: true,
      startsAt: '2026-12-01T14:00:00.000Z',
      endsAt: '2027-01-01T05:59:00.000Z',
      cta: { type: 'CATEGORY', categoryId: 'cat-rolls' },
    });
    expect(created.translations.en?.title).toBe('Roll summer');
    expect(row('verano-2026')).toBeTruthy();
    expect(within(row('verano-2026')).getByText('Programado', { selector: '.pill' })).toBeVisible();
  });

  it('sube una imagen nueva: optimiza (3:1), pide el intent BANNER_IMAGE, sube al almacén simulado y la usa', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.upload(
      within(dialog).getByLabelText('Seleccionar la imagen del banner'),
      png(),
    );
    expect(await within(dialog).findByText('Imagen lista')).toBeVisible();
    const asset = api()
      .store.mediaAssets.filter((a) => a.kind === 'BANNER_IMAGE')
      .at(-1)!;
    expect(asset).toMatchObject({ status: 'READY', mimeType: 'image/webp', sizeBytes: 900 });
    expect(asset.objectKey).toMatch(/^banners\/2026\//);
    expect(within(dialog).getByText('Almacén simulado')).toBeVisible();
  });

  it('un archivo que no es imagen muestra el error sin borrar el resto del formulario', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Código'), 'sigue-aqui');
    await userEvent.upload(
      within(dialog).getByLabelText('Seleccionar la imagen del banner'),
      new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
      { applyAccept: false },
    );
    expect(await within(dialog).findByText(/Formato no admitido/)).toBeVisible();
    expect(within(dialog).getByLabelText('Código')).toHaveValue('sigue-aqui');
  });

  it('409 BANNER_CODE_TAKEN: el error queda en el campo código y el modal sigue abierto', async () => {
    await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Código'), 'favoritos');
    await pickFromLibrary(dialog);
    const es = within(
      within(dialog).getByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    await userEvent.type(es.getByLabelText(/^Título/), 'Otro');
    await userEvent.type(es.getByLabelText(/^Texto alternativo/), 'Alt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(
      (await within(dialog).findAllByText('Ya existe un banner con ese código. Elige otro.'))
        .length,
    ).toBeGreaterThan(0);
    expect(dialog).toBeVisible();
  });

  it('503 BANNERS_BUSY: mensaje reintentable y conserva los datos', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Código'), 'ocupado');
    await pickFromLibrary(dialog);
    const es = within(
      within(dialog).getByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    await userEvent.type(es.getByLabelText(/^Título/), 'Ocupado');
    await userEvent.type(es.getByLabelText(/^Texto alternativo/), 'Alt');
    api().store.bannersBusy = 1;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await within(dialog).findByText(/Hay otra edición en curso/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear banner' }));
    expect(await screen.findByText('Banner creado')).toBeVisible();
  });

  it('edita con expectedVersion, carga ambas traducciones y solo envía lo que cambió', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.click(
      screen.getByRole('button', { name: 'Editar Los favoritos de los MONcheros' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    const es = within(
      await within(dialog).findByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    expect(es.getByLabelText(/^Título/)).toHaveValue('Los favoritos de los MONcheros');
    const en = within(within(dialog).getByRole('group', { name: 'Textos en inglés (opcionales)' }));
    expect(en.getByLabelText('Título')).toHaveValue("MONcheros' favorites");
    // El código no se puede cambiar.
    expect(within(dialog).getByLabelText('Código')).toBeDisabled();
    await userEvent.clear(es.getByLabelText(/^Título/));
    await userEvent.type(es.getByLabelText(/^Título/), 'Favoritos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Favoritos actualizado')).toBeVisible();
    const b = api().store.banners.find((x) => x.code === 'favoritos')!;
    expect(b.version).toBe(2);
    expect(b.translations.es.title).toBe('Favoritos');
    expect(b.translations.es.subtitle).toBe('Platanito, California y Calientito Roll.');
  });

  it('sin cambios no envía nada', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.click(
      screen.getByRole('button', { name: 'Editar Los favoritos de los MONcheros' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    await within(dialog).findByRole('group', { name: 'Textos en español (obligatorios)' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Sin cambios que guardar')).toBeVisible();
    expect(api().store.banners.find((x) => x.code === 'favoritos')!.version).toBe(1);
  });

  it('409 BANNER_VERSION_CONFLICT: ofrece cargar la versión actual y no pisa los cambios ajenos', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.click(
      screen.getByRole('button', { name: 'Editar Los favoritos de los MONcheros' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    const es = within(
      await within(dialog).findByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    // Otra persona edita mientras tanto.
    const stored = api().store.banners.find((x) => x.code === 'favoritos')!;
    stored.translations.es.subtitle = 'Cambio ajeno';
    stored.version = 2;
    await userEvent.clear(es.getByLabelText(/^Título/));
    await userEvent.type(es.getByLabelText(/^Título/), 'Mi título');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialog).findByText(/Otra persona modificó este banner/)).toBeVisible();
    expect(stored.translations.es.title).toBe('Los favoritos de los MONcheros');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar la versión actual' }));
    // El formulario se reinicia (nuevo diálogo) con la versión actual.
    expect(await screen.findByDisplayValue('Cambio ajeno')).toBeVisible();
    // La edición pendiente se descartó: el título vuelve al guardado.
    expect(screen.queryByDisplayValue('Mi título')).toBeNull();
  });

  it('422 BANNER_CTA_INVALID: el destino quedó inactivo mientras se editaba', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.click(
      screen.getByRole('button', { name: 'Editar Los favoritos de los MONcheros' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    const es = within(
      await within(dialog).findByRole('group', { name: 'Textos en español (obligatorios)' }),
    );
    api().store.menuCategories.find((c) => c.id === 'cat-rolls')!.active = false;
    await userEvent.type(es.getByLabelText(/^Título/), '!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(
      (await within(dialog).findAllByText(/El destino del botón no es válido/)).length,
    ).toBeGreaterThan(0);
  });

  it('404: si el banner ya no existe al abrirlo lo dice', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    const editButton = screen.getByRole('button', {
      name: 'Editar Los favoritos de los MONcheros',
    });
    api().store.banners = api().store.banners.filter((b) => b.code !== 'favoritos');
    await userEvent.click(editButton);
    expect(await screen.findByText('El banner ya no existe.')).toBeVisible();
  });

  it('vista previa SIN publicar: escritorio/móvil e idioma con el respaldo a español resaltado', async () => {
    const { api } = await renderScreen();
    await screen.findByText('8 banners');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    const preview = await within(dialog).findByTestId('banner-preview');
    expect(preview).toHaveAttribute('data-device', 'desktop');
    expect(preview).toHaveTextContent('Fin de mes: bebidas');
    expect(preview).toHaveAttribute('inert');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Móvil' }));
    expect(within(dialog).getByTestId('banner-preview')).toHaveAttribute('data-device', 'mobile');
    await userEvent.click(within(dialog).getByRole('button', { name: /Móvil pequeño/ }));
    expect(within(dialog).getByTestId('banner-preview')).toHaveAttribute(
      'data-device',
      'mobileSmall',
    );
    expect(within(dialog).getByTestId('banner-preview').className).toMatch(/w-\[320px\]/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'EN' }));
    // Sin inglés: todo sale en español y se indica qué campos.
    expect(
      within(dialog).getByText(
        /Saldrán en español \(sin traducción\): título, subtítulo, texto del botón, texto alternativo/,
      ),
    ).toBeVisible();
    expect(within(dialog).getByTestId('banner-preview').querySelector('h2')).toHaveAttribute(
      'lang',
      'es',
    );
    // No cambió nada publicado.
    expect(api().store.banners.find((b) => b.code === 'fin-de-mes')!.version).toBe(1);
  });
});

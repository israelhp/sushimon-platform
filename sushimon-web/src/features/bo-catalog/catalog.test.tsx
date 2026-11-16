import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import * as promotionsService from '@/services/promotions';
import type { MockStore } from '@/mocks/store';
import { PromotionsScreen } from './components/PromotionsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

const renderScreen = (
  ui: ReactElement,
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
  prepareStore?: (store: MockStore) => void,
) => renderBackoffice(<BackofficeShell>{ui}</BackofficeShell>, { role, scenario, prepareStore });

describe('Promociones', () => {
  const card = (name: string) =>
    screen.getByText(name, { selector: '.promo-name' }).closest('.promo') as HTMLElement;
  const openCreate = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }));
    return await screen.findByRole('dialog', { name: 'Nueva promoción' });
  };
  const save = (dialog: HTMLElement, name = 'Crear promoción') =>
    userEvent.click(within(dialog).getByRole('button', { name }));
  /** Fija el valor de un `datetime-local`/`type=time` (userEvent no escribe en ellos de forma fiable). */
  const setValue = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

  it('lista las promociones con estado, vigencia, horario, alcance, código y `Rige ahora`', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    expect(await screen.findByText('Happy Hour', { selector: '.promo-name' })).toBeVisible();
    expect(screen.getByText('6 promociones')).toBeVisible();

    const happy = card('Happy Hour');
    expect(within(happy).getByText('Happy Hour', { selector: '.promo-kicker' })).toBeVisible();
    expect(within(happy).getByText('-25%')).toBeVisible();
    expect(within(happy).getByText('Vigencia: 1 oct 2026 – 31 dic 2026')).toBeVisible();
    expect(within(happy).getByText('4 franjas semanales')).toBeVisible();
    expect(within(happy).getByText('Todas las sucursales')).toBeVisible();
    expect(within(happy).getByText('7 productos · Solo en restaurante')).toBeVisible();
    expect(within(happy).getByText('En curso', { selector: '.pill' })).toBeVisible();
    // Son las 14:25: aún no rige el horario semanal.
    expect(within(happy).queryByText(/Rige ahora/)).toBeNull();

    const coupon = card('Cupón de bienvenida');
    expect(within(coupon).getByText('Código: BIENVENIDO10')).toBeVisible();
    expect(within(coupon).getByText('Cupón', { selector: '.promo-kicker' })).toBeVisible();
    expect(within(coupon).getByText(/Rige ahora/)).toBeVisible();

    const fin = card('Fin de mes: bebidas');
    expect(within(fin).getByText('Sucursal 1, Sucursal 2')).toBeVisible();

    const combo = card('Combo Mon para 2');
    expect(combo).toHaveClass('off');
    expect(within(combo).getByText('Q20.00')).toBeVisible();
    expect(within(combo).getByText('Inactiva', { selector: '.pill' })).toBeVisible();
    expect(
      within(card('Navidad en rolls')).getByText('Programada', { selector: '.pill' }),
    ).toBeVisible();
    expect(
      within(card('Semana del cliente')).getByText('Vencida', { selector: '.pill' }),
    ).toBeVisible();
  });

  it('activa y desactiva una promoción con aviso (PATCH …/status)', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Combo Mon para 2');
    const sw = () => screen.getByRole('switch', { name: 'Activar Combo Mon para 2' });
    await userEvent.click(sw());
    expect(await screen.findByText('Combo Mon para 2 activada')).toBeVisible();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(sw());
    expect(await screen.findByText('Combo Mon para 2 desactivada')).toBeVisible();
  });

  it('rotula las promociones vencidas en el escenario promotion-expired', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'promotion-expired');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    expect(screen.getAllByText('Vencida', { selector: '.pill' })).toHaveLength(5);
    expect(screen.getAllByText('Vencida · ya no se aplica')).toHaveLength(5);
    expect(
      within(card('Combo Mon para 2')).getByText('Inactiva', { selector: '.pill' }),
    ).toBeVisible();
  });

  it('filtra por búsqueda, estado, tipo, sucursal y fechas; limpia los filtros', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar por nombre o código' }),
      'bienvenido',
    );
    await waitFor(() =>
      expect(screen.queryByText('Happy Hour', { selector: '.promo-name' })).toBeNull(),
    );
    expect(screen.getByText('Cupón de bienvenida')).toBeVisible();
    expect(screen.getByText('1 promociones')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await screen.findByText('Happy Hour', { selector: '.promo-name' });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'inactive');
    await waitFor(() =>
      expect(screen.queryByText('Happy Hour', { selector: '.promo-name' })).toBeNull(),
    );
    expect(screen.getByText('Combo Mon para 2')).toBeVisible();

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'FIXED_AMOUNT');
    await waitFor(() =>
      expect(screen.queryByText('Happy Hour', { selector: '.promo-name' })).toBeNull(),
    );
    expect(screen.getByText('Combo Mon para 2')).toBeVisible();

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sucursal'), 'sucursal-3');
    await waitFor(() => expect(screen.queryByText('Fin de mes: bebidas')).toBeNull());
    expect(screen.getByText('Happy Hour', { selector: '.promo-name' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await screen.findByText('Fin de mes: bebidas');
    // Fechas: solo la que se solapa con el 16–19 de octubre (la Semana del cliente y el Happy Hour).
    setValue(screen.getByLabelText('Desde'), '2026-10-16');
    setValue(screen.getByLabelText('Hasta'), '2026-10-19');
    await waitFor(() => expect(screen.queryByText('Fin de mes: bebidas')).toBeNull());
    expect(screen.getByText('Semana del cliente')).toBeVisible();
    expect(screen.getByText('Happy Hour', { selector: '.promo-name' })).toBeVisible();
  });

  it('sin resultados con filtros: estado vacío con «Limpiar filtros»; rango de fechas invertido avisa', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar por nombre o código' }),
      'zzzz',
    );
    expect(await screen.findByText('Ninguna promoción coincide con los filtros.')).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]!);
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    setValue(screen.getByLabelText('Desde'), '2026-12-01');
    setValue(screen.getByLabelText('Hasta'), '2026-11-01');
    expect(
      await screen.findByText('La fecha final no puede ser anterior a la inicial.'),
    ).toBeVisible();
  });

  it('pagina el listado del servidor', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'default', (store) => {
      for (let i = 1; i <= 9; i++) {
        const copy = structuredClone(store.promotions[2]!);
        store.promotions.push({ ...copy, id: `extra-${i}`, code: null, name: `Extra ${i}` });
      }
    });
    await screen.findByText('Navidad en rolls');
    expect(screen.getByText('Página 1 de 2 · 15 promociones')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2 · 15 promociones')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Página 1 de 2 · 15 promociones')).toBeVisible();
  });

  it('valida el modal: nombre, valor, vigencia, alcance y horario, con foco en el primer error', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    const dialog = await openCreate();

    await save(dialog);
    expect(within(dialog).getByText(/Escribe un nombre de 1 a 120/)).toBeVisible();
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' });
    expect(name).toHaveFocus();
    await userEvent.type(name, 'Jueves de sashimi');

    const value = within(dialog).getByLabelText('Descuento (%)');
    await userEvent.clear(value);
    await userEvent.type(value, '120');
    await save(dialog);
    expect(within(dialog).getByText('El descuento no puede superar 100 %.')).toBeVisible();
    expect(value).toHaveFocus();
    await userEvent.clear(value);
    await userEvent.type(value, '15');

    const end = within(dialog).getByLabelText('Fin de vigencia');
    setValue(end, '2026-11-01T00:00');
    await save(dialog);
    expect(within(dialog).getByText('El fin debe ser posterior al inicio.')).toBeVisible();
    expect(end).toHaveFocus();
    setValue(end, '2026-12-11T00:00');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir sucursales' }));
    await save(dialog);
    expect(within(dialog).getByText('Elige al menos una sucursal.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sucursal 1' }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir productos' }));
    await save(dialog);
    expect(within(dialog).getByText(/Elige al menos un producto/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Todos los productos' }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir franja' }));
    setValue(within(dialog).getByLabelText('Inicio de la franja 1'), '18:00');
    setValue(within(dialog).getByLabelText('Fin de la franja 1'), '15:00');
    await save(dialog);
    expect(within(dialog).getByText(/el fin debe ser posterior al inicio/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar la franja 1' }));
    expect(within(dialog).getByText('Sin franjas: todos los días y todo el día.')).toBeVisible();
  });

  it('crea una promoción válida con el reloj de la demo y la ve en el listado', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    const dialog = await openCreate();
    // Vigencia inicial: hoy (2026-11-11) 00:00 a 30 días.
    expect(within(dialog).getByLabelText('Inicio de vigencia')).toHaveValue('2026-11-11T00:00');
    expect(within(dialog).getByLabelText('Fin de vigencia')).toHaveValue('2026-12-11T00:00');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nombre' }),
      'Jueves de sashimi',
    );
    await save(dialog);

    expect(await screen.findByText('Promoción creada y activa')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const created = (await screen.findByText('Jueves de sashimi')).closest('.promo') as HTMLElement;
    expect(within(created).getByText('-15%')).toBeVisible();
    expect(within(created).getByText('Vigencia: 11 nov 2026 – 10 dic 2026')).toBeVisible();
    expect(within(created).getByText('Automática', { selector: '.promo-kicker' })).toBeVisible();
    expect(screen.getByText('7 promociones')).toBeVisible();
  });

  it('crea un cupón con horario, sucursales y productos reales y manda lo correcto al servidor', async () => {
    const view = await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    const dialog = await openCreate();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nombre' }),
      'Viernes de rolls',
    );
    await userEvent.type(within(dialog).getByLabelText('Código del cupón'), ' rolls-10 ');
    expect(within(dialog).getByText(/Con código: es un cupón/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Monto fijo por unidad' }));
    const value = within(dialog).getByLabelText('Monto por unidad (Q)');
    await userEvent.clear(value);
    await userEvent.type(value, '12,5');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir sucursales' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sucursal 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Elegir productos' }));
    await userEvent.type(
      within(dialog).getByRole('searchbox', { name: 'Buscar productos' }),
      'california',
    );
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'California Roll' }));
    expect(within(dialog).getByRole('button', { name: 'Quitar California Roll' })).toBeVisible();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir franja' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Día de la franja 1'), '5');
    setValue(within(dialog).getByLabelText('Inicio de la franja 1'), '22:00');
    setValue(within(dialog).getByLabelText('Fin de la franja 1'), '02:00');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Cruza la medianoche' }));
    await save(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = view.api().store.promotions.find((p) => p.name === 'Viernes de rolls')!;
    expect(saved).toMatchObject({
      code: 'ROLLS-10',
      kind: 'FIXED_AMOUNT',
      value: '12.50',
      branchScope: 'SELECTED',
      branchIds: ['sucursal-2'],
      productScope: 'SELECTED',
      productIds: ['california-roll'],
      version: 1,
    });
    // «Cruza la medianoche» se partió en dos días (vie 22:00–24:00 + sáb 00:00–02:00).
    expect(saved.schedule).toEqual([
      { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
      { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
    ]);
  });

  it('con código (cupón) avisa que nombre y descripción son públicos; sin código no; y la nota de publicación no promete inmediatez', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    const dialog = await openCreate();
    const warning = /nombre y su descripción se muestran en la tienda\. No escribas el código ahí/;
    expect(within(dialog).queryByText(warning)).toBeNull();
    expect(within(dialog).getByText(/hasta 30 segundos en verse en la tienda/)).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText('Código del cupón'), 'abc-10');
    expect(within(dialog).getByText(warning)).toBeVisible();
    await userEvent.clear(within(dialog).getByLabelText('Código del cupón'));
    expect(within(dialog).queryByText(warning)).toBeNull();
  });

  it('409 por código repetido: error en el campo, sin cerrar el modal', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Otro cupón');
    const code = within(dialog).getByLabelText('Código del cupón');
    await userEvent.type(code, 'bienvenido10');
    await save(dialog);
    expect(
      await within(dialog).findAllByText('Ya existe una promoción con ese código. Elige otro.'),
    ).not.toHaveLength(0);
    expect(code).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Nueva promoción' })).toBeVisible();
  });

  it('edita: carga el detalle, envía solo lo cambiado y avisa', async () => {
    const view = await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar promoción' });
    const name = await within(dialog).findByRole('textbox', { name: 'Nombre' });
    expect(name).toHaveValue('Fin de mes: bebidas');
    expect(within(dialog).getByLabelText('Descuento (%)')).toHaveValue('10.00');
    expect(within(dialog).getByLabelText('Inicio de vigencia')).toHaveValue('2026-11-01T00:00');
    expect(within(dialog).getByRole('checkbox', { name: 'Sucursal 1' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Sucursal 3' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Quitar Gaseosas' })).toBeVisible();

    // Sin cambios: no hay petición, solo aviso.
    await save(dialog, 'Guardar cambios');
    expect(await screen.findByText('Sin cambios que guardar')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(view.api().store.promotions.find((p) => p.id === 'fin-de-mes')?.version).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' }));
    const again = await screen.findByRole('dialog', { name: 'Editar promoción' });
    const field = await within(again).findByRole('textbox', { name: 'Nombre' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Fin de mes: todo');
    await save(again, 'Guardar cambios');
    expect(await screen.findByText('Fin de mes: todo actualizada')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = view.api().store.promotions.find((p) => p.id === 'fin-de-mes')!;
    expect(saved).toMatchObject({ name: 'Fin de mes: todo', version: 2, value: '10.00' });
    expect(await screen.findByText('Fin de mes: todo')).toBeVisible();
  });

  it('409 de versión: avisa y «Cargar la versión actual» recarga el formulario sin pisar al otro', async () => {
    const view = await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar promoción' });
    const name = await within(dialog).findByRole('textbox', { name: 'Nombre' });
    // «Otra persona» guarda antes (versión 2).
    await promotionsService.updateAdminPromotion(view.api().client, 'fin-de-mes', {
      expectedVersion: 1,
      name: 'Nombre de la otra persona',
    });
    await userEvent.clear(name);
    await userEvent.type(name, 'Mi nombre');
    await save(dialog, 'Guardar cambios');
    expect(await within(dialog).findByText(/Otra persona modificó esta promoción/)).toBeVisible();
    expect(view.api().store.promotions.find((p) => p.id === 'fin-de-mes')?.name).toBe(
      'Nombre de la otra persona',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar la versión actual' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Nombre' }),
      ).toHaveValue('Nombre de la otra persona'),
    );
    expect(within(screen.getByRole('dialog')).queryByText(/Otra persona modificó/)).toBeNull();
  });

  it('una promoción eliminada en otra sesión (404) avisa en el modal de edición', async () => {
    const view = await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    view.api().store.promotions = view.api().store.promotions.filter((p) => p.id !== 'fin-de-mes');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar promoción' });
    expect(await within(dialog).findByText('La promoción ya no existe.')).toBeVisible();
  });

  it('un 503 PROMOTIONS_BUSY se muestra y se puede reintentar', async () => {
    const view = await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    view.api().store.promotionsBusy = 1;
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Reintento');
    await save(dialog);
    expect(await within(dialog).findByText(/Hay otra edición en curso/)).toBeVisible();
    await save(dialog);
    expect(await screen.findByText('Promoción creada y activa')).toBeVisible();
  });

  it('muestra el estado vacío sin promociones', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'empty');
    expect(await screen.findByText('Sin promociones')).toBeVisible();
    expect(
      screen.getByText('Crea la primera promoción para mostrarla en la tienda.'),
    ).toBeVisible();
  });

  it('error de carga: aviso con reintento', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'error');
    expect(await screen.findByText(/No se pudieron cargar las promociones/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  it('el servidor rechaza al encargado (403) aunque la UI no lo oculte', async () => {
    await renderScreen(<PromotionsScreen />, 'manager');
    expect(
      await screen.findByRole('heading', { name: 'No tienes permiso para ver esta pantalla' }),
    ).toBeVisible();
    expect(
      screen.getByText('El servidor rechazó la consulta por permisos insuficientes.'),
    ).toBeVisible();
  });

  it('solo lectura: sin permisos de escritura el alta y la edición se deshabilitan con aviso', async () => {
    await renderScreen(<PromotionsScreen />, 'manager', 'default', (store) => {
      store.roles.find((r) => r.code === 'manager')?.permissions.push('promotions.read');
    });
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    expect(
      screen.getByText('Tu rol puede ver las promociones, pero no crearlas ni editarlas.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nueva promoción' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Activar Happy Hour' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Happy Hour' })).toBeDisabled();
  });

  it('alcance acotado: las de «todas las sucursales» o con sucursales ajenas no son editables; las propias sí', async () => {
    await renderScreen(<PromotionsScreen />, 'manager', 'default', (store) => {
      store.roles
        .find((r) => r.code === 'manager')
        ?.permissions.push('promotions.read', 'promotions.create', 'promotions.update');
    });
    await screen.findByText('Happy Hour', { selector: '.promo-name' });
    expect(screen.getByRole('switch', { name: 'Activar Cupón de bienvenida' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Activar Fin de mes: bebidas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Fin de mes: bebidas' })).toHaveAttribute(
      'title',
      'No cubres todas las sucursales de esta promoción',
    );
    // Su alta ofrece «Elegir sucursales» (sin «Todas»).
    const dialog = await openCreate();
    expect(within(dialog).getByRole('button', { name: 'Todas' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Elegir sucursales' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

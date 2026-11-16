import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { ProductsScreen } from './components/ProductsScreen';
import { PromotionsScreen } from './components/PromotionsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

const renderScreen = (
  ui: ReactElement,
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
) => renderBackoffice(<BackofficeShell>{ui}</BackofficeShell>, { role, scenario });

const dumplingsSwitch = () => screen.getByRole('switch', { name: 'Disponible: Dumplings' });

describe('Productos: permisos por rol', () => {
  it('el administrador ve "Nuevo producto" y los botones de edición', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    expect(await screen.findByText('Dumplings')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Editar Dumplings' })).toBeVisible();
    expect(
      screen.getByText(/29 productos · disponibilidad para Todas las sucursales/),
    ).toBeVisible();
  });

  it('el encargado solo cambia la disponibilidad: sin alta ni edición', async () => {
    await renderScreen(<ProductsScreen />, 'manager');
    expect(await screen.findByText('Dumplings')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar / })).toBeNull();
    expect(dumplingsSwitch()).toBeEnabled();
    expect(screen.getByText(/disponibilidad para Sucursal 1/)).toBeVisible();
  });
});

describe('Productos: disponibilidad por sucursal', () => {
  it('el encargado marca agotado su sucursal y vuelve a activarlo, con aviso', async () => {
    await renderScreen(<ProductsScreen />, 'manager');
    await screen.findByText('Dumplings');
    expect(dumplingsSwitch()).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(dumplingsSwitch());
    expect(await screen.findByText('Dumplings marcado como agotado')).toBeVisible();
    await waitFor(() => expect(dumplingsSwitch()).toHaveAttribute('aria-checked', 'false'));
    const card = dumplingsSwitch().closest('.pcard') as HTMLElement;
    expect(card).toHaveClass('off');
    expect(within(card).getByText('Agotado')).toBeVisible();

    await userEvent.click(dumplingsSwitch());
    expect(await screen.findByText('Dumplings disponible')).toBeVisible();
    await waitFor(() => expect(dumplingsSwitch()).toHaveAttribute('aria-checked', 'true'));
  });

  it('con todas las sucursales, un producto sin stock en una se muestra parcial y se activa en todas', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Joselito Roll');
    const sw = () => screen.getByRole('switch', { name: 'Disponible: Joselito Roll' });
    expect(sw()).toHaveAttribute('aria-checked', 'mixed');
    expect(within(sw().closest('.pcard') as HTMLElement).getByText('Parcial 2/3')).toBeVisible();
    await userEvent.click(sw());
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
  });

  it('el administrador agota un producto en todas las sucursales', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(dumplingsSwitch());
    await waitFor(() => expect(dumplingsSwitch()).toHaveAttribute('aria-checked', 'false'));
    expect(
      within(dumplingsSwitch().closest('.pcard') as HTMLElement).getByText('Agotado'),
    ).toBeVisible();
  });
});

describe('Productos: búsqueda, filtros y vistas', () => {
  it('filtra por categoría con contador y por texto, y limpia desde el estado vacío', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    const tabs = screen.getByRole('tablist', { name: 'Filtrar por categoría' });
    expect(within(tabs).getByRole('tab', { name: /^Todas\s*29$/ })).toBeVisible();

    await userEvent.click(within(tabs).getByRole('tab', { name: /^Entradas/ }));
    expect(screen.queryByText('Joselito Roll')).toBeNull();
    expect(screen.getByText('Dumplings')).toBeVisible();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'zzz');
    expect(screen.getByText('Sin productos')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Joselito Roll')).toBeVisible();
  });

  it('la vista Tabla conserva los datos y el interruptor', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Disponibilidad' })).toBeVisible();
    expect(within(table).getByText('Q53.00')).toBeVisible();
    expect(within(table).getByRole('switch', { name: 'Disponible: Dumplings' })).toBeVisible();
  });
});

describe('Productos: modal', () => {
  it('valida con aviso y lleva el foco al primer campo con error', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo producto' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escribe el nombre del producto.');
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(name, 'Roll Mon');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    const price = within(dialog).getByLabelText(/^Precio/);
    await userEvent.type(price, '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escribe un precio mayor a Q0.00.');
    expect(price).toHaveFocus();
  });

  it('crea un producto con disponibilidad por sucursal y aparece en la lista', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo producto' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Roll Mon');
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '48');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Disponible: Sucursal 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));

    expect(await screen.findByText('Producto creado')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Roll Mon')).toBeVisible();
    expect(screen.getByText('Q48.00')).toBeVisible();
    // Sin stock en la sucursal 2: con todas las sucursales queda parcial.
    expect(screen.getByRole('switch', { name: 'Disponible: Roll Mon' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('edita el precio de un producto existente', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Dumplings');
    const price = within(dialog).getByLabelText(/^Precio/);
    await userEvent.clear(price);
    await userEvent.type(price, '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('Producto actualizado')).toBeVisible();
    const card = screen.getByRole('switch', { name: 'Disponible: Dumplings' }).closest('.pcard');
    await waitFor(() => expect(within(card as HTMLElement).getByText('Q60.00')).toBeVisible());
  });
});

describe('Productos: estados', () => {
  it('muestra el estado vacío sin catálogo', async () => {
    await renderScreen(<ProductsScreen />, 'admin', 'empty');
    expect(await screen.findByText('Todavía no hay productos en el catálogo.')).toBeVisible();
  });

  it('avisa del error con reintento', async () => {
    await renderScreen(<ProductsScreen />, 'admin', 'error');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo cargar el catálogo.');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});

describe('Promociones', () => {
  it('muestra tarjetas con vigencia, días, horas y estado', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    expect(await screen.findByText('Happy Hour 2x1')).toBeVisible();
    expect(screen.getByText('2 activas de 3')).toBeVisible();
    const happy = screen.getByText('Happy Hour 2x1').closest('.promo') as HTMLElement;
    expect(within(happy).getByText('Vigencia: 1 oct – 31 dic 2026')).toBeVisible();
    expect(within(happy).getByText('15:00 – 18:00 · Todas las sucursales')).toBeVisible();
    expect(within(happy).getByText('Activa')).toBeVisible();
    expect(
      within(happy).getByRole('group', { name: 'Días: Lunes, Martes, Miércoles, Jueves' }),
    ).toBeVisible();
    const martes = screen.getByText('Martes de tempura').closest('.promo') as HTMLElement;
    expect(within(martes).getByText('-20%')).toBeVisible();
    const combo = screen.getByText('Combo Mon para 2').closest('.promo') as HTMLElement;
    expect(combo).toHaveClass('off');
    expect(within(combo).getByText('Q199')).toBeVisible();
    expect(within(combo).getByText('Inactiva', { selector: '.pill' })).toBeVisible();
  });

  it('activa y desactiva una promoción con aviso', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Combo Mon para 2');
    const sw = () => screen.getByRole('switch', { name: 'Activar Combo Mon para 2' });
    await userEvent.click(sw());
    expect(await screen.findByText('Combo Mon para 2 activada')).toBeVisible();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText('3 activas de 3')).toBeVisible();
  });

  it('rotula las promociones vencidas y no permite activarlas', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'promotion-expired');
    await screen.findByText('Happy Hour 2x1');
    // La del Combo Mon ya estaba inactiva: el estado "Inactiva" del servidor prevalece sobre "Vencida".
    expect(screen.getAllByText('Vencida', { selector: '.pill' })).toHaveLength(2);
    expect(screen.getByText('0 activas de 3')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Activar Happy Hour 2x1' })).toBeDisabled();
    expect(screen.getAllByText('Vencida · ya no se aplica')).toHaveLength(2);
  });

  it('valida el modal: nombre, día, horas y vigencia, con foco en el error', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour 2x1');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva promoción' });
    const save = () =>
      userEvent.click(within(dialog).getByRole('button', { name: 'Crear promoción' }));

    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Escribe el nombre de la promoción.',
    );
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' });
    expect(name).toHaveFocus();

    await userEvent.type(name, 'Jueves de sashimi');
    // Quita viernes y sábado (valores iniciales): sin días.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Viernes' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sábado' }));
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Elige al menos un día.');
    expect(within(dialog).getByRole('button', { name: 'Lunes' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Jueves' }));
    const end = within(dialog).getByLabelText('Hora fin');
    fireEvent.change(end, { target: { value: '11:00' } });
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'La hora de fin debe ser posterior a la de inicio.',
    );
    expect(end).toHaveFocus();

    fireEvent.change(end, { target: { value: '16:00' } });
    const to = within(dialog).getByLabelText('Vigente hasta');
    fireEvent.change(to, { target: { value: '2026-11-01' } });
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'La fecha final no puede ser anterior a la inicial.',
    );
    expect(to).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Precio especial' }));
    const value = within(dialog).getByLabelText('Precio especial (Q)');
    await userEvent.clear(value);
    fireEvent.change(to, { target: { value: '2026-12-11' } });
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Indica el descuento o precio especial.',
    );
    expect(value).toHaveFocus();
  });

  it('crea una promoción válida con el reloj de la demo', async () => {
    await renderScreen(<PromotionsScreen />, 'admin');
    await screen.findByText('Happy Hour 2x1');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva promoción' });
    // Vigencia inicial: hoy (2026-11-11) a 30 días.
    expect(within(dialog).getByLabelText('Vigente desde')).toHaveValue('2026-11-11');
    expect(within(dialog).getByLabelText('Vigente hasta')).toHaveValue('2026-12-11');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nombre' }),
      'Jueves de sashimi',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear promoción' }));

    expect(await screen.findByText('Promoción creada y activa')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const card = (await screen.findByText('Jueves de sashimi')).closest('.promo') as HTMLElement;
    expect(within(card).getByText('-15%')).toBeVisible();
    expect(within(card).getByText('Vigencia: 11 nov – 11 dic 2026')).toBeVisible();
    expect(screen.getByText('3 activas de 4')).toBeVisible();
  });

  it('muestra el estado vacío sin promociones', async () => {
    await renderScreen(<PromotionsScreen />, 'admin', 'empty');
    expect(await screen.findByText('Sin promociones')).toBeVisible();
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
});

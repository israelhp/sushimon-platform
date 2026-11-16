import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { PromotionsScreen } from './components/PromotionsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

const renderScreen = (
  ui: ReactElement,
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
) => renderBackoffice(<BackofficeShell>{ui}</BackofficeShell>, { role, scenario });

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

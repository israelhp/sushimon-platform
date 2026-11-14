import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ApiError } from '@/lib/data-access/errors';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import * as svc from '@/services/branch-schedule';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { BranchesScreen } from './components/BranchesScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/sucursales'));

const renderScreen = (role: StaffRole = 'admin', scenario: MockScenario = 'default') =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="sucursales">
        <BranchesScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );

const card = (name: string) =>
  screen.getByText(name, { selector: '.cname' }).closest('.bcard') as HTMLElement;

async function openSchedule(name = 'Sucursal 1') {
  const user = userEvent.setup();
  const view = await renderScreen();
  await screen.findByText('5 sucursales');
  await user.click(screen.getByRole('button', { name: `Horario y cierres de ${name}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Horario y cierres' });
  return { user, view, dialog };
}

const input = (dialog: HTMLElement, label: string) =>
  within(dialog).getByLabelText(label) as HTMLInputElement;

describe('estado de la sucursal diferenciado', () => {
  it('administrativo (activa/inactiva) y operativo (abierta, inactiva) son distintos', async () => {
    await renderScreen();
    await screen.findByText('5 sucursales');
    expect(await within(card('Sucursal 1')).findByText('Abierta ahora')).toBeVisible();
    // detalle del servidor: próximo cierre (nextClosesAt)
    expect(
      await within(card('Sucursal 1')).findByText(/Cierra hoy a las 10:00 p\. m\./),
    ).toBeVisible();
    expect(within(card('Sucursal 1')).getByText('Activa')).toBeVisible();
    expect(within(card('Sucursal 4')).getByText('Inactiva')).toBeVisible();
    expect(within(card('Sucursal 4')).getByText('Inactiva · no recibe pedidos')).toBeVisible();
    // una sucursal inactiva no consulta disponibilidad pública (daría 404)
    expect(within(card('Sucursal 4')).queryByText('Abierta ahora')).toBeNull();
  });

  it('sin horario configurado se distingue de cerrada por horario', async () => {
    const { user } = await openSchedule('Sucursal 2');
    const dialog = screen.getByRole('dialog', { name: 'Horario y cierres' });
    for (let d = 1; d <= 7; d++) {
      const names = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      await user.click(
        within(dialog).getByRole('switch', { name: `Atiende el día ${names[d - 1]}` }),
      );
    }
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    const confirm = await screen.findByRole('dialog', { name: 'Guardar horario' });
    expect(within(confirm).getByText(/quedará sin horario configurado/)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar y guardar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Guardar horario' })).toBeNull(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(await within(card('Sucursal 2')).findByText('Sin horario configurado')).toBeVisible();
  });
});

describe('editor de horario semanal', () => {
  it('muestra los 7 días con sus intervalos y los días sin atención', async () => {
    const { dialog } = await openSchedule('Sucursal 3');
    expect(await within(dialog).findByLabelText('Apertura del intervalo 1 de Martes')).toHaveValue(
      '12:00',
    );
    expect(input(dialog, 'Cierre del intervalo 1 de Martes')).toHaveValue('22:00');
    // Sucursal 3 no atiende los lunes
    expect(within(dialog).getByRole('switch', { name: 'Atiende el día Lunes' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(dialog).getByText('Sin atención')).toBeVisible();
    expect(within(dialog).getAllByRole('switch')).toHaveLength(7);
    expect(within(dialog).getByRole('button', { name: 'Guardar horario' })).toBeDisabled();
  });

  it('edita varios intervalos, confirma y guarda con expectedVersion', async () => {
    const { user, view, dialog } = await openSchedule();
    const put = vi.spyOn(view.api().client, 'put');
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Lunes');
    // parte el lunes en dos intervalos con hueco
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Lunes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Lunes'), '15:00');
    await user.click(within(dialog).getByRole('button', { name: 'Agregar intervalo a Lunes' }));
    await user.type(input(dialog, 'Apertura del intervalo 2 de Lunes'), '18:00');
    await user.type(input(dialog, 'Cierre del intervalo 2 de Lunes'), '24:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    const confirm = await screen.findByRole('dialog', { name: 'Guardar horario' });
    expect(within(confirm).getByText(/Cambian: Lunes\./)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar y guardar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Guardar horario' })).toBeNull(),
    );
    expect(
      screen.getByText('Horario de Sucursal 1 guardado', { selector: '.toast' }),
    ).toBeVisible();
    expect(put).toHaveBeenCalledTimes(1);
    const body = put.mock.calls[0]![1] as {
      expectedVersion: string;
      days: { weekday: number; intervals: unknown[] }[];
    };
    expect(body.expectedVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(body.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(body.days[0]!.intervals).toEqual([
      { opensAt: '12:00', closesAt: '15:00' },
      { opensAt: '18:00', closesAt: '24:00' },
    ]);
    // el servidor lo refleja y la tienda lo consume
    const saved = await svc.getBranchHours(view.api().client, 'sucursal-1');
    expect(saved.days[0]!.intervals).toHaveLength(2);
  });

  it('detecta solapes antes de guardar (sin llamar al servidor) y enfoca el campo', async () => {
    const { user, view, dialog } = await openSchedule();
    const put = vi.spyOn(view.api().client, 'put');
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Viernes');
    await user.click(within(dialog).getByRole('button', { name: 'Agregar intervalo a Viernes' }));
    await user.type(input(dialog, 'Apertura del intervalo 2 de Viernes'), '20:00');
    await user.type(input(dialog, 'Cierre del intervalo 2 de Viernes'), '23:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    const second = input(dialog, 'Apertura del intervalo 2 de Viernes');
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(second).toHaveFocus();
    expect(
      within(dialog).getByText('Se solapa con days[4].intervals[0] (12:00-22:00)'),
    ).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Guardar horario' })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('cierre antes de la apertura y formato inválido se marcan por intervalo', async () => {
    const { user, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Martes');
    await user.clear(input(dialog, 'Apertura del intervalo 1 de Martes'));
    await user.type(input(dialog, 'Apertura del intervalo 1 de Martes'), '22:00');
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Martes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Martes'), '02:00');
    await user.clear(input(dialog, 'Apertura del intervalo 1 de Jueves'));
    await user.type(input(dialog, 'Apertura del intervalo 1 de Jueves'), '9:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    expect(within(dialog).getByText(/divide el turno en dos días/)).toBeVisible();
    expect(within(dialog).getByText(/Usa el formato HH:mm/)).toBeVisible();
    expect(input(dialog, 'Apertura del intervalo 1 de Martes')).toHaveFocus();
  });

  it('limita a 6 intervalos por día', async () => {
    const { user, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Lunes');
    const add = within(dialog).getByRole('button', { name: 'Agregar intervalo a Lunes' });
    for (let i = 0; i < 5; i++) await user.click(add);
    expect(input(dialog, 'Apertura del intervalo 6 de Lunes')).toBeVisible();
    expect(add).toBeDisabled();
  });

  it('atajo «pasa de medianoche»: divide el turno en dos días', async () => {
    const { user, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Viernes');
    // 12:00–22:00 ya existe el viernes: liberamos la tarde para el turno nocturno
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Viernes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Viernes'), '17:00');
    await user.selectOptions(within(dialog).getByLabelText('Día de inicio'), 'Viernes');
    await user.clear(within(dialog).getByLabelText('Abre'));
    await user.type(within(dialog).getByLabelText('Abre'), '18:00');
    await user.clear(within(dialog).getByLabelText('Cierra al día siguiente a las'));
    await user.type(within(dialog).getByLabelText('Cierra al día siguiente a las'), '02:00');
    await user.click(within(dialog).getByRole('button', { name: 'Dividir y agregar turno' }));
    expect(
      within(dialog).getByText(/Turno dividido: Viernes 18:00–24:00 y Sábado 00:00–02:00/),
    ).toBeVisible();
    expect(input(dialog, 'Apertura del intervalo 2 de Viernes')).toHaveValue('18:00');
    expect(input(dialog, 'Cierre del intervalo 2 de Viernes')).toHaveValue('24:00');
    // el sábado queda con 00:00–02:00 primero y 12:00–22:00 después
    expect(input(dialog, 'Apertura del intervalo 1 de Sábado')).toHaveValue('00:00');
    expect(input(dialog, 'Cierre del intervalo 1 de Sábado')).toHaveValue('02:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    expect(await screen.findByRole('dialog', { name: 'Guardar horario' })).toBeVisible();
  });

  it('el atajo rechaza un turno que no cruza la medianoche', async () => {
    const { user, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Viernes');
    await user.clear(within(dialog).getByLabelText('Cierra al día siguiente a las'));
    await user.type(within(dialog).getByLabelText('Cierra al día siguiente a las'), '20:00');
    await user.click(within(dialog).getByRole('button', { name: 'Dividir y agregar turno' }));
    expect(within(dialog).getByText(/El cierre debe ser posterior a medianoche/)).toBeVisible();
  });

  it('409 HOURS_VERSION_CONFLICT: avisa y «Recargar horario» descarta lo editado', async () => {
    const { user, view, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Lunes');
    // otra persona guarda primero (misma sesión de servidor): cambia el miércoles
    const current = await svc.getAdminBranchHours(view.api().client, 'sucursal-1');
    await svc.replaceAdminBranchHours(view.api().client, 'sucursal-1', {
      expectedVersion: current.version,
      days: current.days.map((d) =>
        d.weekday === 3 ? { ...d, intervals: [{ opensAt: '13:00', closesAt: '20:00' }] } : d,
      ),
    });
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Lunes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Lunes'), '23:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Guardar horario' })).getByRole('button', {
        name: 'Confirmar y guardar',
      }),
    );
    expect(await within(dialog).findByText(/Otra persona modificó el horario/)).toBeVisible();
    // no se guardó el cambio del lunes
    expect(
      (await svc.getAdminBranchHours(view.api().client, 'sucursal-1')).days[0]!.intervals[0]!
        .closesAt,
    ).toBe('22:00');
    await user.click(within(dialog).getByRole('button', { name: 'Recargar horario' }));
    await waitFor(() =>
      expect(input(dialog, 'Apertura del intervalo 1 de Miércoles')).toHaveValue('13:00'),
    );
    expect(input(dialog, 'Cierre del intervalo 1 de Lunes')).toHaveValue('22:00');
    expect(within(dialog).queryByText(/Otra persona modificó/)).toBeNull();
  });

  it('422 SCHEDULE_INVALID del servidor se muestra por día e intervalo', async () => {
    const { user, view, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Lunes');
    vi.spyOn(view.api().client, 'put').mockRejectedValueOnce(
      new ApiError(
        422,
        'unprocessable',
        'Horario inválido',
        undefined,
        undefined,
        'SCHEDULE_INVALID',
        [
          {
            path: 'days[4].intervals[0]',
            code: 'INTERVAL_OVERLAP',
            message: 'Se solapa con days[4].intervals[1] (11:00-15:00)',
          },
        ],
      ),
    );
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Lunes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Lunes'), '23:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Guardar horario' })).getByRole('button', {
        name: 'Confirmar y guardar',
      }),
    );
    expect(
      await within(dialog).findByText('Se solapa con days[4].intervals[1] (11:00-15:00)'),
    ).toBeVisible();
    expect(input(dialog, 'Apertura del intervalo 1 de Viernes')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByText(/el horario no es válido/)).toBeVisible();
  });

  it('el encargado ve el horario en solo lectura (sin manage_hours)', async () => {
    const user = userEvent.setup();
    await renderScreen('manager');
    await screen.findByText('1 sucursal');
    await user.click(screen.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Horario y cierres' });
    expect(
      await within(dialog).findByText(/Solo lectura: no tienes permiso para modificar horarios/),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Guardar horario' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Agregar intervalo/ })).toBeNull();
    expect(input(dialog, 'Apertura del intervalo 1 de Lunes')).toBeDisabled();
    await user.click(within(dialog).getByRole('tab', { name: 'Cierres' }));
    expect(
      await within(dialog).findByText(/Solo lectura: no tienes permiso para modificar cierres/),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Nuevo cierre' })).toBeNull();
  });

  it('estado de error al cargar con reintento', async () => {
    const view = await renderScreen();
    await screen.findByText('5 sucursales');
    vi.spyOn(view.api().client, 'get').mockImplementation(async (path: string) => {
      if (path.endsWith('/hours')) throw new ApiError(500, 'server_error', 'x');
      return { items: [], page: 1, pageSize: 20, total: 0 } as never;
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Horario y cierres' });
    expect(await within(dialog).findByText('No pudimos cargar el horario.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});

describe('cierres extraordinarios', () => {
  async function openClosures() {
    const ctx = await openSchedule();
    await ctx.user.click(within(ctx.dialog).getByRole('tab', { name: 'Cierres' }));
    return ctx;
  }
  const setDate = (dialog: HTMLElement, label: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

  it('lista en curso/próximos con motivo, filtra por estado y los terminados son de solo lectura', async () => {
    const { user, dialog } = await openClosures();
    expect(await within(dialog).findByText('Próximo')).toBeVisible();
    expect(within(dialog).getByText('Motivo: Mantenimiento de campana extractora')).toBeVisible();
    expect(within(dialog).getByText(/El motivo solo se ve en el backoffice/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Terminados' }));
    expect(await within(dialog).findByText('Terminado')).toBeVisible();
    expect(within(dialog).getByText('Motivo: Capacitación del equipo')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /Editar el cierre/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Cancelar cierre del/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'En curso' }));
    expect(await within(dialog).findByText('Sin cierres')).toBeVisible();
  });

  it('crea un cierre futuro con validación en cliente y lo muestra en la lista', async () => {
    const { user, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(within(form).getByText('Indica cuándo empieza el cierre.')).toBeVisible();
    expect(within(form).getByLabelText('Inicio (hora de Guatemala)')).toHaveFocus();

    setDate(form, 'Inicio (hora de Guatemala)', '2026-12-01T10:00');
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-12-01T09:00');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(within(form).getByText('El fin debe ser posterior al inicio.')).toBeVisible();

    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-12-01T14:00');
    await user.type(
      within(form).getByLabelText('Motivo (opcional, solo visible aquí)'),
      'Evento privado',
    );
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo cierre' })).toBeNull());
    expect(screen.getByText('Cierre creado', { selector: '.toast' })).toBeVisible();
    expect(await within(dialog).findByText('Motivo: Evento privado')).toBeVisible();
  });

  it('un solape se informa desde el servidor (409 CLOSURE_OVERLAP) sin cerrar el formulario', async () => {
    const { user, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    // cierre-1: 18-nov 12:00–16:00 local
    setDate(form, 'Inicio (hora de Guatemala)', '2026-11-18T14:00');
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-11-18T18:00');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(
      await within(form).findByText(/Se solapa con otro cierre de esta sucursal/),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Nuevo cierre' })).toBeVisible();
  });

  it('un cierre que empieza ya pide confirmación y deja la sucursal en «Cierre extraordinario»', async () => {
    const { user, view, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    setDate(form, 'Inicio (hora de Guatemala)', '2026-11-11T14:00'); // 14:00 local < ahora (14:25)
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-11-11T18:00');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    const confirm = await screen.findByRole('dialog', { name: 'Este cierre empieza ya' });
    expect(within(confirm).getByText(/dejará de recibir pedidos de inmediato/)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo cierre' })).toBeNull());
    expect((await svc.getBranchAvailability(view.api().client, 'sucursal-1')).reason).toBe(
      'EXCEPTIONAL_CLOSURE',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(await within(card('Sucursal 1')).findByText('Cierre extraordinario')).toBeVisible();
  });

  it('cancelar un cierre futuro pide confirmación y lo elimina', async () => {
    const { user, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: /Cancelar cierre del/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Cancelar cierre' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar cierre' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cancelar cierre' })).toBeNull(),
    );
    expect(screen.getByText('Cierre cancelado', { selector: '.toast' })).toBeVisible();
    expect(await within(dialog).findByText('Sin cierres')).toBeVisible();
  });

  it('terminar ahora un cierre en curso (PATCH endsAt) y la sucursal vuelve a abrir', async () => {
    const ctx = await openSchedule();
    const { user, view } = ctx;
    await svc.createAdminBranchClosure(view.api().client, 'sucursal-1', {
      startsAt: '2026-11-11T20:00:00Z',
      endsAt: '2026-11-11T23:00:00Z',
      reason: 'Corte de energía',
    });
    await user.click(within(ctx.dialog).getByRole('tab', { name: 'Cierres' }));
    expect(
      await within(ctx.dialog).findByText('En curso', { selector: '.pill, .st-rep, span' }),
    ).toBeVisible();
    await user.click(
      await within(ctx.dialog).findByRole('button', { name: /Terminar ahora el cierre del/ }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Terminar cierre ahora' });
    await user.click(within(confirm).getByRole('button', { name: 'Terminar ahora' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Terminar cierre ahora' })).toBeNull(),
    );
    expect(screen.getByText('Cierre terminado', { selector: '.toast' })).toBeVisible();
    expect((await svc.getBranchAvailability(view.api().client, 'sucursal-1')).reason).toBe('OPEN');
  });

  it('editar un cierre en curso: inicio bloqueado y el fin solo se acorta', async () => {
    const ctx = await openSchedule();
    const { user, view } = ctx;
    await act(async () => {
      await svc.createAdminBranchClosure(view.api().client, 'sucursal-1', {
        startsAt: '2026-11-11T20:00:00Z',
        endsAt: '2026-11-11T23:00:00Z',
      });
    });
    await user.click(within(ctx.dialog).getByRole('tab', { name: 'Cierres' }));
    await user.click(
      (await within(ctx.dialog).findAllByRole('button', { name: /Editar el cierre del/ }))[0]!,
    );
    const form = await screen.findByRole('dialog', { name: 'Editar cierre' });
    expect(within(form).getByLabelText('Inicio (hora de Guatemala)')).toBeDisabled();
    setDate(form, 'Fin (solo se puede acortar)', '2026-11-11T20:00'); // 20:00 local = 02:00Z siguiente > actual
    await user.click(within(form).getByRole('button', { name: 'Guardar cierre' }));
    expect(within(form).getByText(/solo puedes acortar el fin/)).toBeVisible();
    setDate(form, 'Fin (solo se puede acortar)', '2026-11-11T16:00');
    await user.click(within(form).getByRole('button', { name: 'Guardar cierre' }));
    const confirm = await screen.findByRole('dialog', { name: 'Modificar un cierre en curso' });
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cierre' })).toBeNull());
    const list = await svc.listAdminBranchClosures(view.api().client, 'sucursal-1', {
      status: 'active',
    });
    expect(list.items[0]!.endsAt).toBe('2026-11-11T22:00:00.000Z');
  });

  it('STARTS_TOO_EARLY: validación previa en el cliente y error del servidor en el campo', async () => {
    const { user, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    setDate(form, 'Inicio (hora de Guatemala)', '2026-11-11T12:00'); // 2 h 25 min antes
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-11-11T18:00');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(
      within(form).getByText('El inicio no puede ser anterior a una hora atrás.'),
    ).toBeVisible();
    expect(within(form).getByLabelText('Inicio (hora de Guatemala)')).toHaveFocus();
  });

  it('STARTS_TOO_EARLY que solo detecta el servidor se muestra en el campo de inicio', async () => {
    const { user, view, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    vi.spyOn(view.api().client, 'post').mockRejectedValueOnce(
      new ApiError(422, 'unprocessable', 'x', undefined, undefined, 'CLOSURE_RANGE_INVALID', [
        { path: 'startsAt', code: 'STARTS_TOO_EARLY', message: 'm' },
      ]),
    );
    setDate(form, 'Inicio (hora de Guatemala)', '2026-12-01T10:00');
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-12-01T12:00');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(
      await within(form).findByText('El inicio no puede ser anterior a una hora atrás.'),
    ).toBeVisible();
    expect(within(form).getByLabelText('Inicio (hora de Guatemala)')).toHaveFocus();
  });

  it('CLOSURE_LIMIT_REACHED: mensaje claro y el formulario conserva lo escrito', async () => {
    const { user, view, dialog } = await openClosures();
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    vi.spyOn(view.api().client, 'post').mockRejectedValueOnce(
      new ApiError(422, 'unprocessable', 'x', undefined, undefined, 'CLOSURE_LIMIT_REACHED'),
    );
    setDate(form, 'Inicio (hora de Guatemala)', '2026-12-01T10:00');
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-12-01T12:00');
    await user.type(within(form).getByLabelText('Motivo (opcional, solo visible aquí)'), 'Evento');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(await within(form).findByText(/máximo de 100 cierres vigentes o futuros/)).toBeVisible();
    expect(within(form).queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(within(form).getByLabelText('Motivo (opcional, solo visible aquí)')).toHaveValue(
      'Evento',
    );
  });

  it('BRANCH_SCHEDULE_BUSY: «Reintentar» repite el guardado sin perder lo escrito', async () => {
    const { user, view, dialog } = await openClosures();
    view.api().store.scheduleBusy = { 'sucursal-1': 1 };
    await user.click(await within(dialog).findByRole('button', { name: 'Nuevo cierre' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cierre' });
    setDate(form, 'Inicio (hora de Guatemala)', '2026-12-01T10:00');
    setDate(form, 'Fin (hora de Guatemala, no incluido)', '2026-12-01T12:00');
    await user.type(within(form).getByLabelText('Motivo (opcional, solo visible aquí)'), 'Evento');
    await user.click(within(form).getByRole('button', { name: 'Crear cierre' }));
    expect(await within(form).findByText(/Otra persona está guardando cambios/)).toBeVisible();
    expect(within(form).getByLabelText('Motivo (opcional, solo visible aquí)')).toHaveValue(
      'Evento',
    );
    await user.click(within(form).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo cierre' })).toBeNull());
    expect(await within(dialog).findByText('Motivo: Evento')).toBeVisible();
  });
});

describe('editor: BRANCH_SCHEDULE_BUSY', () => {
  it('avisa, conserva el borrador y «Reintentar» guarda', async () => {
    const { user, view, dialog } = await openSchedule();
    await within(dialog).findByLabelText('Apertura del intervalo 1 de Lunes');
    view.api().store.scheduleBusy = { 'sucursal-1': 1 };
    await user.clear(input(dialog, 'Cierre del intervalo 1 de Lunes'));
    await user.type(input(dialog, 'Cierre del intervalo 1 de Lunes'), '23:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar horario' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Guardar horario' })).getByRole('button', {
        name: 'Confirmar y guardar',
      }),
    );
    expect(
      await within(dialog).findByText(/Otra persona está guardando cambios en esta sucursal/),
    ).toBeVisible();
    expect(input(dialog, 'Cierre del intervalo 1 de Lunes')).toHaveValue('23:00');
    expect(
      (await svc.getAdminBranchHours(view.api().client, 'sucursal-1')).days[0]!.intervals[0]!
        .closesAt,
    ).toBe('22:00');
    await user.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByText('Horario de Sucursal 1 guardado', { selector: '.toast' }),
    ).toBeVisible();
    expect(
      (await svc.getAdminBranchHours(view.api().client, 'sucursal-1')).days[0]!.intervals[0]!
        .closesAt,
    ).toBe('23:00');
    expect(within(dialog).queryByText(/Otra persona está guardando/)).toBeNull();
  });
});

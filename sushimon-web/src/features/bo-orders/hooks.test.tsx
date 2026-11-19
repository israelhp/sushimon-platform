import { useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDemoSession } from '@/features/session/demo-session';
import { queryKeys } from '@/features/query-keys';
import type { AdminOrderTransitionResult } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { pollOverrideMs, useAdminOrderBoard, useAdminOrderCommand, useStaffKey } from './hooks';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

// Comando bajo control del test: lo resuelve a mano para comprobar que NO hay actualización optimista.
const control = vi.hoisted(() => ({
  release: null as null | ((r: unknown) => void),
  calls: 0,
}));
vi.mock('@/services/admin-orders', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/admin-orders')>();
  return {
    ...original,
    runAdminOrderCommand: () => {
      control.calls += 1;
      return new Promise((resolve) => {
        control.release = resolve;
      });
    },
  };
});

beforeEach(() => {
  resetNavigationMock('/backoffice/pedidos');
  control.release = null;
  control.calls = 0;
});

function Probe() {
  const staffKey = useStaffKey();
  const [branch, setBranch] = useState<string | null>(null);
  const board = useAdminOrderBoard(branch, { poll: false });
  const qc = useQueryClient();
  const session = useDemoSession();
  const keys = qc
    .getQueryCache()
    .getAll()
    .map((q) => JSON.stringify(q.queryKey));
  return (
    <div>
      <span data-testid="staff">{staffKey}</span>
      <span data-testid="branch">{branch ?? 'all'}</span>
      <span data-testid="state">
        {board.data
          ? `datos:${board.data.branchId ?? 'all'}`
          : board.isLoading
            ? 'cargando'
            : 'vacío'}
      </span>
      <span data-testid="keys">{keys.join('|')}</span>
      <button onClick={() => setBranch('sucursal-1')}>sucursal-1</button>
      <button onClick={() => session.signOutStaff()}>salir</button>
    </div>
  );
}

describe('claves por persona + sucursal (spec 023 §10.2)', () => {
  it('la clave lleva la persona y la sucursal; al cambiar de sucursal NO se ve el tablero anterior', async () => {
    const view = await renderBackoffice(<Probe />, { role: 'admin' });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('datos:all'));
    const staffId = view.api().session.staff!.userId;
    expect(screen.getByTestId('staff')).toHaveTextContent(staffId);
    expect(screen.getByTestId('keys').textContent).toContain(
      JSON.stringify(queryKeys.backoffice.adminOrders.board(staffId, null)),
    );

    fireEvent.click(screen.getByRole('button', { name: 'sucursal-1' }));
    // Sin `keepPreviousData`: nunca «datos:all» bajo la clave de la otra sucursal; primero cargando.
    expect(screen.getByTestId('state')).toHaveTextContent('cargando');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('datos:sucursal-1'));
  });

  it('al cerrar sesión se descarta la caché de pedidos de la persona anterior', async () => {
    const view = await renderBackoffice(<Probe />, { role: 'admin' });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('datos:all'));
    const staffId = view.api().session.staff!.userId;
    expect(screen.getByTestId('keys').textContent).toContain(staffId);
    await userEvent.click(screen.getByRole('button', { name: 'salir' }));
    // Ningún dato de la persona anterior sobrevive (solo queda la entrada vacía y deshabilitada de «sin sesión»).
    await waitFor(() => expect(screen.getByTestId('keys').textContent).not.toContain(staffId));
    expect(screen.getByTestId('state')).toHaveTextContent('vacío');
  });

  it('el intervalo de pruebas por variable pública solo se acepta si es numérico', () => {
    expect(pollOverrideMs(undefined)).toBeNull();
    expect(pollOverrideMs('abc')).toBeNull();
    expect(pollOverrideMs('0')).toBeNull();
    expect(pollOverrideMs('10000')).toBe(10_000);
  });
});

function Command() {
  const mutation = useAdminOrderCommand();
  const qc = useQueryClient();
  const board = useAdminOrderBoard(null, { poll: false });
  const pendingColumn = board.data?.columns.find((c) => c.status === 'pending');
  return (
    <div>
      <span data-testid="pending">{pendingColumn?.items.length ?? -1}</span>
      <span data-testid="status">{mutation.status}</span>
      <button
        onClick={() =>
          mutation.mutate({ id: 'MON-307057', command: 'accept', expectedStatus: 'pending' })
        }
      >
        aceptar
      </button>
      <button onClick={() => void qc.invalidateQueries()}>noop</button>
    </div>
  );
}

describe('comando de transición', () => {
  it('SIN actualización optimista: nada cambia hasta que el servidor responde; luego se invalida el tablero', async () => {
    await renderBackoffice(<Command />, { role: 'admin' });
    await waitFor(() =>
      expect(Number(screen.getByTestId('pending').textContent)).toBeGreaterThan(0),
    );
    const before = screen.getByTestId('pending').textContent;

    await userEvent.click(screen.getByRole('button', { name: 'aceptar' }));
    await waitFor(() => expect(control.calls).toBe(1));
    expect(screen.getByTestId('status')).toHaveTextContent('pending');
    expect(screen.getByTestId('pending').textContent).toBe(before);

    const result: AdminOrderTransitionResult = {
      order: {
        id: 'MON-307057',
        orderNumber: 307057,
        displayNumber: 'MON-307057',
        status: 'accepted',
        branchId: 'sucursal-1',
        branchName: 'Sucursal 1',
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
        customerName: 'José Pablo Ruiz',
        itemCount: 1,
        total: '10.00',
        paymentMethodPreference: 'cash',
        scheduledFor: null,
        placedAt: '2026-11-11T19:45:00.000Z',
        updatedAt: '2026-11-11T20:25:00.000Z',
        availableActions: [],
      },
      transition: {
        from: 'pending',
        to: 'accepted',
        at: '2026-11-11T20:25:00.000Z',
        replayed: false,
        appliedByMe: true,
      },
      pendingActions: [],
    };
    await act(async () => control.release?.(result));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
  });
});

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render';
import { TOAST_ACTION_DURATION, TOAST_WARN_DURATION, ToastProvider, useToast } from './Toast';

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const { notify } = useToast();
  return (
    <>
      <button type="button" onClick={() => notify('Elige una sucursal', { tone: 'warn' })}>
        advertir
      </button>
      <button
        type="button"
        onClick={() =>
          notify('Quitado', { action: { label: 'Deshacer', onAction: onUndo ?? (() => {}) } })
        }
      >
        con acción
      </button>
    </>
  );
}

describe('Toast · tono y pausa (U1, U5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('una advertencia lleva role="alert" y un icono propio (no un check de éxito) y dura más', () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'advertir' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Elige una sucursal');
    expect(
      alert.querySelector('svg.lucide-triangle-alert, svg.lucide-alert-triangle'),
    ).not.toBeNull();
    expect(alert.querySelector('svg.lucide-check')).toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_WARN_DURATION - 1));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un aviso con acción se pausa con el puntero o el foco encima y se reanuda al salir', () => {
    const undo = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <Trigger onUndo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'con acción' }));
    const action = screen.getByRole('button', { name: 'Deshacer' });
    const toast = action.parentElement!;
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION * 3));
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION));
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });

  it('la acción se ejecuta y cierra el aviso', () => {
    const undo = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <Trigger onUndo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'con acción' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });
});

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render';
import { TOAST_DURATION, ToastProvider, useToast } from './Toast';

function Trigger({ message }: { message: string }) {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify(message)}>
      avisar
    </button>
  );
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('anuncia el mensaje en una región viva y lo oculta tras la duración de la tienda', () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger message="Agregado al pedido" />
      </ToastProvider>,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'avisar' }));
    expect(region).toHaveTextContent('Agregado al pedido');
    act(() => vi.advanceTimersByTime(TOAST_DURATION.store - 1));
    expect(region).toHaveTextContent('Agregado al pedido');
    act(() => vi.advanceTimersByTime(1));
    expect(region).toBeEmptyDOMElement();
  });

  it('un aviso nuevo reemplaza al anterior y reinicia el temporizador (backoffice)', () => {
    renderWithIntl(
      <ToastProvider zone="bo">
        <Trigger message="Pedido #12 aceptado" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(2000));
    const region = screen.getByRole('status');
    expect(region.querySelector('.toast')).toHaveTextContent('Pedido #12 aceptado');
    act(() => vi.advanceTimersByTime(TOAST_DURATION.bo - 2000));
    expect(region).toBeEmptyDOMElement();
  });

  it('useToast fuera del proveedor lanza un error claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderWithIntl(<Trigger message="x" />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

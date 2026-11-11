import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render';
import { Button, IconButton, buttonClasses } from './Button';

describe('buttonClasses', () => {
  it('tienda: clases del prototipo', () => {
    expect(buttonClasses()).toBe('btn');
    expect(buttonClasses({ variant: 'primary' })).toBe('btn btn-primary');
    expect(buttonClasses({ variant: 'dark', block: true })).toBe('btn btn-dark w-full');
    expect(buttonClasses({ variant: 'link' })).toBe('link-btn');
    expect(buttonClasses({ size: 'sm' })).toContain('!min-h-[44px]');
  });
  it('backoffice: clases de su hoja', () => {
    expect(buttonClasses({ zone: 'bo', variant: 'primary', size: 'sm' })).toBe(
      'btn btn-primary sm',
    );
    expect(buttonClasses({ zone: 'bo', variant: 'danger', block: true })).toBe('btn danger block');
    expect(buttonClasses({ zone: 'bo', variant: 'green', size: 'lg' })).toBe('btn btn-green lg');
  });
});

describe('Button', () => {
  it('es type="button" por defecto y dispara onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(
      <Button variant="primary" onClick={onClick}>
        Agregar
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Agregar' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('btn', 'btn-primary');
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading: deshabilitado, aria-busy y no dispara onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(
      <Button loading onClick={onClick}>
        Pagar
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Pagar' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('IconButton exige nombre accesible', () => {
    renderWithIntl(
      <IconButton label="Cerrar sesión" zone="bo">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(btn).toHaveClass('icon-btn', 'bordered');
  });
});

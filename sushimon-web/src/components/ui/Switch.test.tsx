import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

function Controlled({ zone }: { zone?: 'store' | 'bo' }) {
  const [on, setOn] = useState(false);
  return <Switch zone={zone} checked={on} onCheckedChange={setOn} label="Disponible: Roll Mon" />;
}

describe('Switch', () => {
  it('expone role="switch" con nombre y estado', () => {
    render(<Controlled />);
    const sw = screen.getByRole('switch', { name: 'Disponible: Roll Mon' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('se alterna con Espacio y Enter desde el teclado', async () => {
    const user = userEvent.setup();
    render(<Controlled zone="bo" />);
    const sw = screen.getByRole('switch');
    await user.tab();
    expect(sw).toHaveFocus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveClass('switch', 'on');
    await user.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).not.toHaveClass('on');
  });

  it('estado mixto y deshabilitado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch zone="bo" checked={false} mixed onCheckedChange={onChange} label="Todas" />,
    );
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'mixed');
    expect(sw).toHaveClass('part');
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked={false} disabled onCheckedChange={onChange} label="Todas" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

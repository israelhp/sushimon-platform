import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render';
import { Drawer } from './Drawer';
import { Modal } from './Modal';
import type { Zone } from './zone';

function Harness({ zone = 'store' as Zone, onClose }: { zone?: Zone; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir
      </button>
      <Modal
        zone={zone}
        open={open}
        title="Rechazar pedido"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        footer={<button type="button">confirmar</button>}
      >
        <input aria-label="motivo" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it.each<Zone>(['store', 'bo'])('es un diálogo modal accesible con título (%s)', async (zone) => {
    const user = userEvent.setup();
    renderWithIntl(<Harness zone={zone} />);
    await user.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Rechazar pedido' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    // se monta en <body> dentro de un envoltorio de su zona
    expect(dialog.closest('[data-zone]')).toHaveAttribute('data-zone', zone);
  });

  it('Esc cierra, restaura el scroll y devuelve el foco al disparador', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithIntl(<Harness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'abrir' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('atrapa el foco: Tab y Shift+Tab ciclan dentro del diálogo', async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />);
    await user.click(screen.getByRole('button', { name: 'abrir' }));
    const close = screen.getByRole('button', { name: 'Cerrar' });
    const input = screen.getByRole('textbox', { name: 'motivo' });
    const confirm = screen.getByRole('button', { name: 'confirmar' });
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('el botón Cerrar usa el texto traducido', async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />, { locale: 'en' });
    await user.click(screen.getByRole('button', { name: 'abrir' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Drawer', () => {
  it('se abre como diálogo y se cierra con Esc', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithIntl(<Drawer open title="Detalle" onClose={onClose} zone="bo" />);
    expect(screen.getByRole('dialog', { name: 'Detalle' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

/** Espera a que la ficha termine de cargar (el diálogo se abre ya, con esqueleto `aria-busy`) y la devuelve. */
export async function findLoadedDialog(): Promise<HTMLElement> {
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy', 'true'));
  return screen.getByRole('dialog');
}

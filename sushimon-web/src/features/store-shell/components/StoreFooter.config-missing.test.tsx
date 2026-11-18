import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type DataClient } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { StoreFooter } from './StoreFooter';

/** Cliente `http` que responde 404 a `store/config` (endpoint inexistente en la API) y nada más. */
const httpWithoutStoreConfig = (_base: DataClient): DataClient =>
  withShortcuts('http', async (path: string) => {
    throw new ApiError(404, 'not_found', `GET ${path} → 404`);
  });

describe('StoreFooter · GET /v1/store/config inexistente (adaptador http)', () => {
  it('oculta contacto y horario: ni «Algo salió mal» ni «Reintentar» (un 404 permanente no se reintenta)', async () => {
    await renderStore(<StoreFooter />, { wrapClient: httpWithoutStoreConfig });
    // El 404 se resuelve de inmediato (sin reintentos): espera a que desaparezca el esqueleto.
    await waitFor(() => expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(0));
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
    expect(screen.queryByText(/algo salió mal/i)).toBeNull();
    // El resto del pie sigue: aviso de privacidad.
    expect(screen.getByText(/MON SUSHI/)).toBeTruthy();
  });
});

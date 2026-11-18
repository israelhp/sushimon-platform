import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DataProvider } from '@/lib/data-access/provider';
import { createFixedClock } from '@/mocks/clock';
import { createMockDataClient } from '@/mocks/index';
import { createSeedStore } from '@/mocks/seed';
import { usePayWithCard } from '@/features/orders/hooks';
import { createDraftOrder as createOrder } from '@/services/orders';

const PAN = '4242424242424242';
const CVV = '737';

/**
 * Regresión de seguridad: TanStack Query conserva las `variables` de cada mutación en su caché hasta el
 * `gcTime`. El pago con tarjeta no debe pasar por `useMutation`: ni el PAN ni el CVV pueden quedar en la
 * caché de mutaciones ni de consultas.
 */
describe('usePayWithCard · sin datos de tarjeta en cachés', () => {
  it('no deja PAN ni CVV en la caché de mutaciones ni de consultas', async () => {
    const client = createMockDataClient({
      scenario: 'default',
      latencyMs: 0,
      persist: false,
      store: createSeedStore('default'),
      clock: createFixedClock(),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider client={client} queryClient={queryClient}>
        {children}
      </DataProvider>
    );
    const order = await createOrder(client, {
      fulfillment: 'pickup',
      branchId: 'sucursal-1',
      schedule: { kind: 'now' },
      customer: { name: 'Cliente Demo', phone: '5555-1234', email: 'cliente@ejemplo.com' },
      lines: [{ productId: 'dumplings', quantity: 1 }],
      paymentMethod: 'card',
    });

    const { result } = renderHook(() => usePayWithCard(), { wrapper });
    let status = '';
    await act(async () => {
      const paid = await result.current.pay({
        orderId: order.id,
        cardNumber: PAN,
        holderName: 'CLIENTE DEMO',
        expiry: '12/28',
        cvv: CVV,
      });
      status = paid.status;
    });
    expect(status).toBe('approved');

    const mutations = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => ({ variables: m.state.variables, data: m.state.data })),
    );
    const queries = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    for (const dump of [mutations, queries]) {
      expect(dump).not.toContain(PAN);
      expect(dump).not.toContain(CVV);
      expect(dump.toLowerCase()).not.toContain('cvv');
    }
  });
});

import { PaymentsReadAdapter } from './payments-read.adapter.js';
import type { PaymentsRepository } from './payments.repository.js';

const adapter = (review: boolean | Error) => {
  const hasPaidOnClosedOrder = vi.fn(() =>
    review instanceof Error ? Promise.reject(review) : Promise.resolve(review),
  );
  return {
    hasPaidOnClosedOrder,
    port: new PaymentsReadAdapter({ hasPaidOnClosedOrder } as unknown as PaymentsRepository),
  };
};

describe('PaymentsReadAdapter (reemplaza a ProvisionalPaymentRule, P74)', () => {
  it('pago PAID + pedido cerrado => payment_review; en otro caso []', async () => {
    expect(await adapter(true).port.inspect('o1')).toEqual({ pendingActions: ['payment_review'] });
    expect(await adapter(false).port.inspect('o1')).toEqual({ pendingActions: [] });
  });

  it('no depende de la preferencia (la firma ya no la recibe) y consulta una sola vez por pedido', async () => {
    const a = adapter(false);
    await a.port.inspect('o1');
    expect(a.hasPaidOnClosedOrder).toHaveBeenCalledTimes(1);
    expect(a.hasPaidOnClosedOrder).toHaveBeenCalledWith('o1');
  });

  it('un fallo de la BD se propaga (el comando de F22 lo captura tras el commit)', async () => {
    await expect(adapter(new Error('caído')).port.inspect('o1')).rejects.toThrow('caído');
  });
});

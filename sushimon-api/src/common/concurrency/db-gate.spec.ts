import { DbGate, splitGateBudget } from './db-gate.js';

const busy = () => new Error('busy');
const defer = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('DbGate (F19: generalización de StoreDbGate)', () => {
  it('limita la concurrencia, encola y libera el cupo en orden', async () => {
    const gate = new DbGate(1, 2, 1_000, busy);
    const first = defer();
    const order: string[] = [];
    const a = gate.run(async () => {
      order.push('a');
      await first.promise;
    });
    const b = gate.run(() => Promise.resolve(order.push('b')));
    expect(gate.inFlight).toBe(1);
    expect(gate.waiting).toBe(1);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.inFlight).toBe(0);
  });

  it('cola llena => rechaza al instante con el error de la fábrica', async () => {
    const gate = new DbGate(1, 0, 1_000, () => Object.assign(new Error('x'), { tag: 'fábrica' }));
    const hold = defer();
    void gate.run(() => hold.promise);
    await expect(gate.run(() => Promise.resolve())).rejects.toMatchObject({ tag: 'fábrica' });
    hold.resolve();
  });

  it('espera agotada => rechaza y el elemento sale de la cola', async () => {
    vi.useFakeTimers();
    try {
      const gate = new DbGate(1, 2, 50, busy);
      const hold = defer();
      void gate.run(() => hold.promise);
      const waiting = gate.run(() => Promise.resolve());
      const assertion = expect(waiting).rejects.toThrow('busy');
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
      expect(gate.waiting).toBe(0);
      hold.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('libera el cupo si la tarea falla o lanza de forma síncrona', async () => {
    const gate = new DbGate(1, 1, 1_000, busy);
    await expect(gate.run(() => Promise.reject(new Error('f')))).rejects.toThrow('f');
    await expect(
      gate.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.inFlight).toBe(0);
    await expect(gate.run(() => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe('splitGateBudget (F17 + F19 comparten DB_POOL_MAX - 1)', () => {
  it.each([
    [3, 1, 1],
    [4, 1, 2],
    [7, 2, 4],
    [10, 3, 6],
    [20, 6, 13],
  ])('pool %i => cotizador %i y tienda %i; la suma no supera pool-1', (pool, checkout, store) => {
    const split = splitGateBudget(pool);
    expect(split).toEqual({ checkout, store });
    expect(split.checkout + split.store).toBeLessThanOrEqual(pool - 1);
  });

  it('pool de 1 o 2: mínimo 1 por semáforo (la suma puede exceder el presupuesto; documentado)', () => {
    expect(splitGateBudget(1)).toEqual({ checkout: 1, store: 1 });
    expect(splitGateBudget(2)).toEqual({ checkout: 1, store: 1 });
  });
});

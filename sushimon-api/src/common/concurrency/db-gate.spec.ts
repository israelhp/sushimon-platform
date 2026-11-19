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

  describe('rejectIfWaiting (admisión de lecturas, F21)', () => {
    it('con cupo libre admite aunque se pida un umbral de 0', async () => {
      const gate = new DbGate(1, 8, 1_000, busy);
      await expect(gate.run(() => Promise.resolve('ok'), { rejectIfWaiting: 0 })).resolves.toBe(
        'ok',
      );
    });

    it('cupo ocupado y cola con >= n esperas => la lectura se rechaza AL INSTANTE; la escritura sigue encolándose', async () => {
      const gate = new DbGate(1, 8, 1_000, busy);
      const hold = defer();
      const held = gate.run(() => hold.promise);
      const waiting = [gate.run(() => Promise.resolve(1)), gate.run(() => Promise.resolve(2))];
      expect(gate.waiting).toBe(2);
      await expect(
        gate.run(() => Promise.resolve('lectura'), { rejectIfWaiting: 2 }),
      ).rejects.toThrow('busy');
      expect(gate.waiting).toBe(2); // el rechazo no ocupa plaza
      const write = gate.run(() => Promise.resolve('escritura')); // sin opción: entra en cola (plaza 3)
      expect(gate.waiting).toBe(3);
      hold.resolve();
      await expect(Promise.all([held, ...waiting, write])).resolves.toEqual([
        undefined,
        1,
        2,
        'escritura',
      ]);
    });

    it('con menos de n esperas la lectura SÍ se encola', async () => {
      const gate = new DbGate(1, 8, 1_000, busy);
      const hold = defer();
      const held = gate.run(() => hold.promise);
      const one = gate.run(() => Promise.resolve(1));
      const read = gate.run(() => Promise.resolve('lectura'), { rejectIfWaiting: 2 });
      expect(gate.waiting).toBe(2);
      hold.resolve();
      await expect(Promise.all([held, one, read])).resolves.toEqual([undefined, 1, 'lectura']);
    });

    it('sin la opción el comportamiento por defecto no cambia (cola llena => ocupado; si no, espera)', async () => {
      const gate = new DbGate(1, 1, 1_000, busy);
      const hold = defer();
      const held = gate.run(() => hold.promise);
      const queued = gate.run(() => Promise.resolve('a'));
      await expect(gate.run(() => Promise.resolve('b'))).rejects.toThrow('busy');
      hold.resolve();
      await expect(Promise.all([held, queued])).resolves.toEqual([undefined, 'a']);
    });
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

describe('splitGateBudget (F17 + F19 + F20 comparten DB_POOL_MAX - 1)', () => {
  it.each([
    [5, 1, 1, 2],
    [7, 2, 1, 3],
    [10, 3, 2, 4],
    [20, 6, 4, 9],
  ])(
    'pool %i => cotizador %i, pedidos %i y tienda %i; la suma no supera pool-1',
    (pool, checkout, orders, store) => {
      const split = splitGateBudget(pool);
      expect(split).toEqual({ checkout, orders, store });
      expect(split.checkout + split.orders + split.store).toBeLessThanOrEqual(pool - 1);
    },
  );

  it('excepción documentada: con DB_POOL_MAX <= 3 (B < 3) el mínimo de 1 por gate suma 3 > B', () => {
    for (const pool of [1, 2, 3]) {
      expect(splitGateBudget(pool)).toEqual({ checkout: 1, orders: 1, store: 1 });
    }
    expect(splitGateBudget(3).checkout + splitGateBudget(3).orders + splitGateBudget(3).store).toBe(
      3,
    ); // con pool 3 los tres gates consumen el pool completo: 0 conexiones para rutas sin gate
  });

  it('con DB_POOL_MAX >= 4 (B >= 3) queda SIEMPRE al menos 1 conexión libre y cada gate tiene >= 1', () => {
    for (let pool = 4; pool <= 60; pool += 1) {
      const s = splitGateBudget(pool);
      expect(Math.min(s.checkout, s.orders, s.store)).toBeGreaterThanOrEqual(1);
      expect(s.checkout + s.orders + s.store).toBeLessThanOrEqual(pool - 1);
    }
  });

  it('cada cupo es al menos 1 y la suma nunca supera pool-1 con pool >= 5', () => {
    for (let pool = 5; pool <= 60; pool += 1) {
      const s = splitGateBudget(pool);
      expect(Math.min(s.checkout, s.orders, s.store)).toBeGreaterThanOrEqual(1);
      expect(s.checkout + s.orders + s.store).toBeLessThanOrEqual(pool - 1);
    }
  });
});

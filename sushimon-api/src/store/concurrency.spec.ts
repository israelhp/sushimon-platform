import { StoreDbGate } from './concurrency.js';

const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('StoreDbGate (semáforo compartido)', () => {
  it('nunca ejecuta más de `max` tareas a la vez y conserva el orden', async () => {
    const gate = new StoreDbGate(2, 10, 1_000);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const out = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        gate.run(async () => {
          started.push(n);
          active += 1;
          peak = Math.max(peak, active);
          await sleep(5);
          active -= 1;
          return n * 2;
        }),
      ),
    );
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
    expect(started).toEqual([1, 2, 3, 4, 5]);
    expect([gate.inFlight, gate.waiting]).toEqual([0, 0]);
  });

  it('libera siempre el cupo: tarea que rechaza o lanza de forma síncrona', async () => {
    const gate = new StoreDbGate(1, 5, 1_000);
    await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(
      gate.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(gate.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(gate.inFlight).toBe(0);
  });

  it('cola llena => 503 STORE_BUSY inmediato', async () => {
    const gate = new StoreDbGate(1, 1, 1_000);
    const hold = gate.run(() => sleep(30));
    const queued = gate.run(() => Promise.resolve(1));
    const rejected = await gate.run(() => Promise.resolve(2)).catch((e: unknown) => e);
    expect(code(rejected)).toBe('STORE_BUSY');
    await Promise.all([hold, queued]);
  });

  it('espera máxima superada => 503 STORE_BUSY y la tarea vencida no se ejecuta', async () => {
    const gate = new StoreDbGate(1, 5, 10);
    const hold = gate.run(() => sleep(60));
    const ran = vi.fn(() => Promise.resolve(1));
    const rejected = await gate.run(ran).catch((e: unknown) => e);
    expect(code(rejected)).toBe('STORE_BUSY');
    await hold;
    await sleep(0);
    expect(ran).not.toHaveBeenCalled();
    expect([gate.inFlight, gate.waiting]).toEqual([0, 0]);
  });

  it('max inválido se trata como 1', async () => {
    await expect(new StoreDbGate(0, 1, 10).run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

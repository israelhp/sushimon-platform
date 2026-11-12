/**
 * Reloj inyectable de la demo. ÚNICO lugar del código mock que puede leer la hora real.
 *
 * Fecha base fija: miércoles 11 de noviembre de 2026, 14:25 en Guatemala (UTC−6, sin horario de
 * verano) = 2026-11-11T20:25:00Z. Es el "ahora" de los prototipos: los pedidos sembrados del
 * backoffice tienen 3–75 min de antigüedad y el pedido demo MON-490217 se creó 28 min antes.
 *
 * - Pruebas: `createFixedClock()` (no avanza salvo con `advance`/`set`).
 * - Navegador: `createBrowserClock()` parte de la fecha base y avanza al ritmo del reloj real desde
 *   el inicio de la sesión de la pestaña (inicio guardado en sessionStorage).
 */
export const DEMO_BASE_TIME = '2026-11-11T20:25:00.000Z';

export interface Clock {
  now(): Date;
}

export interface FixedClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function createFixedClock(iso: string = DEMO_BASE_TIME): FixedClock {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    set: (value) => {
      current = new Date(value).getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

const SESSION_START_KEY = 'sushimon-demo-clock-start-v1';

/** Reloj del navegador: fecha base + tiempo real transcurrido desde que empezó la sesión. */
export function createBrowserClock(): Clock {
  const realNow = () => Date.now();
  let start = realNow();
  if (typeof window !== 'undefined') {
    try {
      const saved = Number(window.sessionStorage.getItem(SESSION_START_KEY));
      if (Number.isFinite(saved) && saved > 0 && saved <= start) start = saved;
      else window.sessionStorage.setItem(SESSION_START_KEY, String(start));
    } catch {
      // sessionStorage no disponible: el reloj arranca en cada carga.
    }
  }
  const base = new Date(DEMO_BASE_TIME).getTime();
  return { now: () => new Date(base + (realNow() - start)) };
}

export * from '@/lib/time';

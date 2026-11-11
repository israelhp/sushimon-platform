/**
 * PRNG determinista (mulberry32) y utilidades. Ninguna factory usa Math.random():
 * la misma semilla produce siempre la misma secuencia.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits: convierte una clave (p. ej., "2026-11-10|sucursal-1|7") en semilla. */
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rngFor(key: string): Rng {
  return mulberry32(hashSeed(key));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick: lista vacía');
  return item;
}

export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Elige por pesos (los pesos no necesitan sumar 1). */
export function weighted<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let x = rng() * total;
  for (const item of items) {
    x -= item.weight;
    if (x <= 0) return item.value;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error('weighted: lista vacía');
  return last.value;
}

/** Referencia alfanumérica determinista (A-Z0-9). */
export function reference(rng: Rng, length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(rng() * chars.length)];
  return out;
}

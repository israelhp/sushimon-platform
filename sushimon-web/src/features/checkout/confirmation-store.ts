import type { OrderCreated } from '@/lib/data-access/models';

/**
 * F20 (spec 021 §9.4) — Credencial de invitado del pedido recién creado. Vive SOLO en `sessionStorage` (`monsushi-order-<id>`):
 * por pestaña, no sobrevive al cerrarla, nunca en `localStorage`, en la URL ni en logs. El pedido NO se guarda aquí: se reconstruye
 * con `GET /v1/orders/{id}` (JWT del dueño o `X-Order-Token`). Es una credencial de acceso a UN pedido, no autenticación.
 */
export const orderConfirmationKey = (orderId: string) => `monsushi-order-${orderId}`;

interface Stored {
  /** `null` = pedido de un cliente con sesión (accede con su JWT). */
  guestToken: string | null;
  expiresAt: string | null;
  /** Número visible (`MON-000000`): NO es una credencial; permite mostrarlo si se pierde el acceso. */
  displayNumber: string;
}

/** Respaldo en memoria de la pestaña (SPA): si `sessionStorage` falla, la confirmación sigue accesible hasta recargar. */
const memory = new Map<string, Stored>();

/**
 * Guarda la credencial y el número. Devuelve `false` si NO se pudo persistir en `sessionStorage` (almacenamiento bloqueado o
 * lleno): la credencial queda solo en memoria y la pantalla debe avisar al cliente que guarde su número.
 */
export function saveConfirmation(created: OrderCreated): boolean {
  const value: Stored = {
    guestToken: created.access?.guestToken ?? null,
    expiresAt: created.access?.expiresAt ?? null,
    displayNumber: created.order.displayNumber,
  };
  memory.set(created.order.id, value);
  try {
    window.sessionStorage.setItem(orderConfirmationKey(created.order.id), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Solo pruebas: vacía el respaldo en memoria (las pruebas reutilizan ids deterministas). */
export const resetConfirmationMemory = () => memory.clear();

function readStored(orderId: string): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(orderConfirmationKey(orderId));
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      if (typeof v.displayNumber === 'string' || typeof v.guestToken === 'string') {
        return {
          guestToken: typeof v.guestToken === 'string' ? v.guestToken : null,
          expiresAt: typeof v.expiresAt === 'string' ? v.expiresAt : null,
          displayNumber: typeof v.displayNumber === 'string' ? v.displayNumber : '',
        };
      }
    }
  } catch {
    /* almacenamiento ilegible: se usa la memoria */
  }
  return memory.get(orderId) ?? null;
}

/** ¿Está la confirmación persistida en `sessionStorage` (sobrevive a una recarga)? */
export function isConfirmationPersisted(orderId: string): boolean {
  try {
    return window.sessionStorage.getItem(orderConfirmationKey(orderId)) !== null;
  } catch {
    return false;
  }
}

/** Credencial guardada y no vencida (`null` si no hay: otra pestaña/dispositivo o sesión de cliente). */
export function readGuestToken(orderId: string, nowMs: number = Date.now()): string | null {
  const v = readStored(orderId);
  if (!v || typeof v.guestToken !== 'string' || !v.guestToken.startsWith('smo_')) return null;
  if (v.expiresAt && Date.parse(v.expiresAt) <= nowMs) return null;
  return v.guestToken;
}

/** Número visible guardado de este pedido (o `null`: no hay confirmación reciente en esta pestaña). */
export function readOrderNumber(orderId: string): string | null {
  return readStored(orderId)?.displayNumber || null;
}

export function clearConfirmation(orderId: string) {
  memory.delete(orderId);
  try {
    window.sessionStorage.removeItem(orderConfirmationKey(orderId));
  } catch {
    /* nada que limpiar */
  }
}

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import type { DbGate, DbGateRunOptions } from '../common/concurrency/db-gate.js';
import { GUEST_TOKEN_PATTERN, hashGuestToken } from './order-access-token.js';
import { translateOrdersDbError } from './orders-errors.js';

/**
 * Admisión de LECTURAS (F21/F23): con el cupo lleno, una lectura se rechaza (503 `ORDERS_BUSY`) si ya hay 2 esperas en cola;
 * las plazas restantes quedan reservadas a las escrituras.
 */
export const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };

/** 404 idéntico (mismo cuerpo) que `getOrder`: inexistente, ajeno, token inválido/vencido/revocado, invitado con JWT. */
export const orderNotFound = (): NotFoundException => new NotFoundException('Pedido no encontrado');

/** Hash del token de invitado, o `undefined` sin token. Un formato imposible => 400 sin tocar la BD. */
export function guestHashOf(rawToken: string | undefined): Buffer | undefined {
  if (rawToken === undefined) return undefined;
  if (!GUEST_TOKEN_PATTERN.test(rawToken)) {
    throw new BadRequestException(['X-Order-Token: formato inválido']);
  }
  return hashGuestToken(rawToken);
}

/**
 * Autorización de lectura (misma regla que `OrdersService.authorizedRead`, F20): primero el token de invitado, después el dueño
 * por JWT. `null` en TODO caso denegado: el llamador responde el mismo 404.
 */
export async function authorizedRead<T>(
  principal: Principal | undefined,
  hash: Buffer | undefined,
  now: Date,
  finders: {
    byToken: (hash: Buffer, now: Date) => Promise<T | null>;
    byOwner: (authUserId: string) => Promise<T | null>;
  },
): Promise<T | null> {
  if (hash !== undefined) {
    const byToken = await finders.byToken(hash, now);
    if (byToken) return byToken;
  }
  return principal ? finders.byOwner(principal.authUserId) : null;
}

/** Gate de pedidos con admisión de lectura + traducción de «ocupado o sin conexión» a 503 `ORDERS_BUSY`. */
export async function runOrdersRead<T>(gate: DbGate, task: () => Promise<T>): Promise<T> {
  try {
    return await gate.run(task, READ_ADMISSION);
  } catch (error) {
    throw translateOrdersDbError(error);
  }
}

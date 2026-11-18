import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de acceso de invitado a su pedido (F20, ADR-0026 D5). `smo_` + 32 bytes aleatorios (256 bits) en base64url (43
 * caracteres). En BD solo se guarda su sha256 (alta entropía: no necesita sal ni HMAC). Se muestra una vez; en una
 * repetición idempotente de invitado se emite otro y el anterior se revoca.
 */

export const GUEST_TOKEN_PREFIX = 'smo_';
export const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const GUEST_TOKEN_PATTERN = /^smo_[A-Za-z0-9_-]{43}$/;

export interface IssuedGuestToken {
  /** En claro: solo se entrega al cliente, nunca se guarda ni se registra. */
  token: string;
  hash: Buffer;
  expiresAt: Date;
}

export const hashGuestToken = (token: string): Buffer =>
  createHash('sha256').update(token, 'utf8').digest();

export function issueGuestToken(now: Date): IssuedGuestToken {
  const token = `${GUEST_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    token,
    hash: hashGuestToken(token),
    expiresAt: new Date(now.getTime() + GUEST_TOKEN_TTL_MS),
  };
}

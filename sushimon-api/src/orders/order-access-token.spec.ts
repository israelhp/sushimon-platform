import { createHash } from 'node:crypto';
import {
  GUEST_TOKEN_PATTERN,
  GUEST_TOKEN_TTL_MS,
  hashGuestToken,
  issueGuestToken,
} from './order-access-token.js';

describe('token de acceso de invitado (F20)', () => {
  const now = new Date('2026-11-16T22:00:00Z');

  it('formato smo_ + 43 caracteres base64url (256 bits) y vigencia de 14 días', () => {
    const t = issueGuestToken(now);
    expect(t.token).toMatch(GUEST_TOKEN_PATTERN);
    expect(t.token).toHaveLength(4 + 43);
    expect(t.expiresAt.getTime() - now.getTime()).toBe(GUEST_TOKEN_TTL_MS);
    expect(GUEST_TOKEN_TTL_MS).toBe(14 * 86_400_000);
  });

  it('en BD solo el sha256 (32 bytes), que coincide con hashGuestToken; el token no se deriva del hash', () => {
    const t = issueGuestToken(now);
    expect(t.hash).toHaveLength(32);
    expect(t.hash.equals(createHash('sha256').update(t.token).digest())).toBe(true);
    expect(hashGuestToken(t.token).equals(t.hash)).toBe(true);
    expect(t.hash.toString('base64url')).not.toContain(t.token.slice(4));
  });

  it('200 tokens distintos (entropía) y el patrón rechaza formas inválidas', () => {
    expect(new Set(Array.from({ length: 200 }, () => issueGuestToken(now).token)).size).toBe(200);
    for (const bad of [
      '',
      'smo_',
      `smo_${'A'.repeat(42)}`,
      `smo_${'A'.repeat(44)}`,
      `xxx_${'A'.repeat(43)}`,
      `smo_${'A'.repeat(42)}+`,
    ]) {
      expect(GUEST_TOKEN_PATTERN.test(bad)).toBe(false);
    }
  });
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMfaStatus, MfaError, startTotpEnrollment, toMfaError, verifyTotp } from './mfa';

const ok = <T>(data: T) => Promise.resolve({ data, error: null });
const fail = (error: object) => Promise.resolve({ data: null, error });

function client(over: Record<string, unknown> = {}) {
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(() => ok({ currentLevel: 'aal1', nextLevel: 'aal2' })),
    listFactors: vi.fn(() => ok({ all: [], totp: [] })),
    enroll: vi.fn(() =>
      ok({ id: 'f-new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRET' } }),
    ),
    unenroll: vi.fn(() => ok({ id: 'x' })),
    challenge: vi.fn(() => ok({ id: 'ch-1' })),
    verify: vi.fn(() => ok({})),
    ...over,
  };
  return { mfa, supabase: { auth: { mfa } } as unknown as SupabaseClient };
}

describe('toMfaError', () => {
  it.each([
    [{ code: 'mfa_verification_failed' }, 'invalidCode'],
    [{ code: 'mfa_challenge_expired' }, 'expired'],
    [{ code: 'mfa_factor_not_found' }, 'factorMissing'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'rateLimited'],
    [{ status: 429 }, 'rateLimited'],
    [{ code: 'session_not_found' }, 'session'],
    [{ name: 'AuthSessionMissingError' }, 'session'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network'],
    [{ code: 'otra' }, 'unknown'],
    [null, 'unknown'],
  ])('%j → %s', (error, key) => {
    expect(toMfaError(error).key).toBe(key);
  });
});

describe('loadMfaStatus', () => {
  it('solo cuenta los factores TOTP verificados (un pendiente no está habilitado)', async () => {
    const { supabase } = client({
      listFactors: vi.fn(() =>
        ok({
          all: [],
          totp: [
            { id: 'a', status: 'verified', friendly_name: 'Móvil' },
            { id: 'b', status: 'unverified', friendly_name: 'Pendiente' },
          ],
        }),
      ),
    });
    const status = await loadMfaStatus(supabase);
    expect(status).toEqual({ currentLevel: 'aal1', verifiedTotp: [{ id: 'a', label: 'Móvil' }] });
  });

  it('un error de Supabase lanza (no asume un estado)', async () => {
    const { supabase } = client({
      listFactors: vi.fn(() => fail({ status: 0, name: 'AuthRetryableFetchError' })),
    });
    await expect(loadMfaStatus(supabase)).rejects.toMatchObject({ key: 'network' });
  });
});

describe('startTotpEnrollment', () => {
  it('descarta factores pendientes anteriores y enrola uno nuevo con el emisor Sushi Mon', async () => {
    const { supabase, mfa } = client({
      listFactors: vi.fn(() =>
        ok({
          all: [
            { id: 'old', factor_type: 'totp', status: 'unverified' },
            { id: 'phone', factor_type: 'phone', status: 'unverified' },
          ],
          totp: [],
        }),
      ),
    });
    const result = await startTotpEnrollment(supabase);
    expect(mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });
    expect(mfa.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: 'totp', issuer: 'Sushi Mon' }),
    );
    expect(result).toEqual({
      factorId: 'f-new',
      qrCode: 'data:image/svg+xml;utf-8,<svg/>',
      secret: 'SECRET',
    });
  });

  it('con un factor ya verificado no enrola otro', async () => {
    const { supabase, mfa } = client({
      listFactors: vi.fn(() => ok({ all: [], totp: [{ id: 'a', status: 'verified' }] })),
    });
    await expect(startTotpEnrollment(supabase)).rejects.toBeInstanceOf(MfaError);
    expect(mfa.enroll).not.toHaveBeenCalled();
  });
});

describe('verifyTotp', () => {
  it('challenge → verify → comprueba aal2', async () => {
    const { supabase, mfa } = client({
      getAuthenticatorAssuranceLevel: vi.fn(() => ok({ currentLevel: 'aal2', nextLevel: 'aal2' })),
    });
    await verifyTotp(supabase, 'f1', '123456');
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: 'f1',
      challengeId: 'ch-1',
      code: '123456',
    });
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 456'])(
    'rechaza el formato %j sin llamar a Supabase',
    async (code) => {
      const { supabase, mfa } = client();
      await expect(verifyTotp(supabase, 'f1', code)).rejects.toMatchObject({ key: 'invalidCode' });
      expect(mfa.challenge).not.toHaveBeenCalled();
    },
  );

  it('código incorrecto → invalidCode', async () => {
    const { supabase } = client({ verify: vi.fn(() => fail({ code: 'mfa_verification_failed' })) });
    await expect(verifyTotp(supabase, 'f1', '000000')).rejects.toMatchObject({
      key: 'invalidCode',
    });
  });

  it('challenge inválido o factor inexistente se traducen', async () => {
    const { supabase } = client({ challenge: vi.fn(() => fail({ code: 'mfa_factor_not_found' })) });
    await expect(verifyTotp(supabase, 'f1', '123456')).rejects.toMatchObject({
      key: 'factorMissing',
    });
  });

  it('si tras verificar la sesión no quedó en aal2 falla (no se confía en el éxito del verify)', async () => {
    const { supabase } = client(); // currentLevel sigue en aal1
    await expect(verifyTotp(supabase, 'f1', '123456')).rejects.toMatchObject({ key: 'session' });
  });
});

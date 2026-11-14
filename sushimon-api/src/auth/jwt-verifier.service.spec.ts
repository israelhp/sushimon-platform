import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { Logger } from '@nestjs/common';
import { createTestKeys, ISSUER, USER_ID, type TestKeys } from '../../test/support/tokens.js';
import { InvalidTokenError, JwtVerifierService } from './jwt-verifier.service.js';

const HS_SECRET = 'a'.repeat(40);

function config(overrides: Record<string, unknown> = {}): ConfigService<never, true> {
  const values: Record<string, unknown> = {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    AUTH_CLOCK_TOLERANCE_S: 5,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService<never, true>;
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidTokenError);
    return (e as InvalidTokenError).reason;
  }
  throw new Error('se esperaba rechazo');
}

describe('JwtVerifierService', () => {
  let keys: TestKeys;
  let verifier: JwtVerifierService;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    keys = await createTestKeys();
    verifier = new JwtVerifierService(config(), keys.jwks);
  });

  it('acepta un token válido y construye la identidad', async () => {
    const p = await verifier.verify(await keys.sign({ email: 'Cliente@Example.com' }));
    expect(p).toEqual({
      authUserId: USER_ID,
      email: 'cliente@example.com',
      provider: 'google',
      googleOAuth: true,
      aal: 'aal1',
      displayName: 'Cliente Prueba',
    });
  });

  it('googleOAuth es false si la sesión no nació de OAuth', async () => {
    const p = await verifier.verify(await keys.sign({ amr: [{ method: 'password' }] }));
    expect(p.googleOAuth).toBe(false);
  });

  describe('nivel de aseguramiento (MFA)', () => {
    const totp = [
      { method: 'oauth', timestamp: 1 },
      { method: 'totp', timestamp: 2 },
    ];
    it('aal2 solo con claim aal2 Y segundo factor TOTP en amr', async () => {
      const p = await verifier.verify(await keys.sign({ aal: 'aal2', amr: totp }));
      expect(p.aal).toBe('aal2');
    });
    it.each([
      ['sin claim aal', {}],
      ['aal1 explícito', { aal: 'aal1' }],
      ['aal2 sin TOTP en amr', { aal: 'aal2' }],
      ['TOTP en amr pero claim aal1', { aal: 'aal1', amr: totp }],
      ['claim con valor desconocido', { aal: 'aal3', amr: totp }],
      ['claim con tipo inválido', { aal: true, amr: totp }],
      ['claim aal2 con mayúsculas', { aal: 'AAL2', amr: totp }],
      ['claim aal como arreglo', { aal: ['aal2'], amr: totp }],
    ])('degrada a aal1: %s', async (_name, claims) => {
      const p = await verifier.verify(await keys.sign(claims));
      expect(p.aal).toBe('aal1');
    });
    it('lo que diga user_metadata/app_metadata no eleva el nivel', async () => {
      const p = await verifier.verify(
        await keys.sign({
          app_metadata: { provider: 'google', aal: 'aal2' },
          user_metadata: { aal: 'aal2' },
        }),
      );
      expect(p.aal).toBe('aal1');
    });
  });

  it('rechaza token expirado (más allá de la tolerancia)', async () => {
    const token = await keys.sign({}, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    expect(await rejection(verifier.verify(token))).toBe('expired');
  });

  it('rechaza emisor distinto', async () => {
    const token = await keys.sign({}, { issuer: 'https://otro.example/auth/v1' });
    expect(await rejection(verifier.verify(token))).toBe('claim:iss');
  });

  it('rechaza audiencia distinta', async () => {
    const token = await keys.sign({}, { audience: 'otra' });
    expect(await rejection(verifier.verify(token))).toBe('claim:aud');
  });

  it('rechaza firma de otra clave', async () => {
    expect(await rejection(verifier.verify(await keys.signWithForeignKey()))).toBe(
      'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    );
  });

  it('rechaza sujeto ausente o que no es UUID', async () => {
    expect(await rejection(verifier.verify(await keys.sign({ sub: 'no-es-uuid' })))).toBe(
      'claim:sub',
    );
  });

  it.each(['anon', 'service_role'])('rechaza role=%s', async (role) => {
    expect(await rejection(verifier.verify(await keys.sign({ role })))).toBe('claim:role');
  });

  it('rechaza "alg: none"', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: USER_ID,
      iss: ISSUER,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 600,
      role: 'authenticated',
    })}.`;
    await rejection(verifier.verify(token));
  });

  it('rechaza HS256 si no hay secreto configurado (confusión de algoritmo)', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(HS_SECRET));
    await rejection(verifier.verify(token));
  });

  it('acepta HS256 solo con SUPABASE_JWT_SECRET configurado', async () => {
    const hs = new JwtVerifierService(config({ SUPABASE_JWT_SECRET: HS_SECRET }), keys.jwks);
    const sign = (secret: string) =>
      new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(USER_ID)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(secret));
    await expect(hs.verify(await sign(HS_SECRET))).resolves.toMatchObject({ authUserId: USER_ID });
    await rejection(hs.verify(await sign('b'.repeat(40))));
  });

  it.each(['', 'abc', 'a.b.c', 'a.b'])('rechaza token mal formado %j', async (t) => {
    await rejection(verifier.verify(t));
  });

  it('sin configuración de Supabase rechaza todo', async () => {
    const off = new JwtVerifierService(config({ SUPABASE_URL: undefined }), null);
    expect(await rejection(off.verify(await keys.sign()))).toBe('auth-not-configured');
  });

  it('limpia y acota el nombre para mostrar', async () => {
    const p = await verifier.verify(
      await keys.sign({ user_metadata: { full_name: `Ana\u0000\n${'x'.repeat(300)}` } }),
    );
    expect(p.displayName).toHaveLength(120);
    expect(p.displayName).not.toMatch(/\p{Cc}/u);
  });
});

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export const ISSUER = 'http://127.0.0.1:54341/auth/v1';
export const AUDIENCE = 'authenticated';
export const USER_ID = '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11';

export interface TestKeys {
  jwks: JWTVerifyGetKey;
  sign: (claims?: JWTPayload, opts?: SignOptions) => Promise<string>;
  /** Firma con OTRA clave (misma kid) para probar firma inválida. */
  signWithForeignKey: (claims?: JWTPayload) => Promise<string>;
}

interface SignOptions {
  alg?: 'ES256';
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
}

/** Genera un par ES256 efímero y un JWKS local: pruebas deterministas sin red ni Supabase. */
export async function createTestKeys(): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const foreign = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  const build = (key: CryptoKey, claims: JWTPayload = {}, opts: SignOptions = {}) => {
    const jwt = new SignJWT({
      role: 'authenticated',
      email: 'cliente@example.com',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Cliente Prueba', email_verified: true },
      amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }],
      ...claims,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(claims.sub ?? USER_ID)
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '10m');
    return jwt.sign(key);
  };

  return {
    jwks,
    sign: (claims, opts) => build(privateKey, claims, opts),
    signWithForeignKey: (claims) => build(foreign.privateKey, claims),
  };
}

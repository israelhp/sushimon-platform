import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyObject,
} from 'jose';
import type { Env } from '../config/env.js';
import type { Principal } from './auth.types.js';

/** Resolutor de claves públicas (JWKS). Inyectable para pruebas sin red. */
export const JWKS_RESOLVER = 'AUTH:JWKS_RESOLVER';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASYMMETRIC = ['ES256', 'RS256'] as const;

export class InvalidTokenError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Fábrica del resolutor JWKS remoto (con caché y límites de tiempo, apto para serverless). */
export function createJwksResolver(config: ConfigService<Env, true>): JWTVerifyGetKey | null {
  const explicit = config.get('SUPABASE_JWKS_URL', { infer: true });
  const base = config.get('SUPABASE_URL', { infer: true });
  const url =
    explicit ?? (base ? `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json` : null);
  if (!url) return null;
  return createRemoteJWKSet(new URL(url), { timeoutDuration: 3_000, cooldownDuration: 30_000 });
}

/**
 * Verifica JWT emitidos por Supabase Auth: firma, emisor, audiencia, expiración y sujeto.
 * - Solo algoritmos permitidos explícitamente (nunca `none`); HS256 únicamente con SUPABASE_JWT_SECRET.
 * - Exige claims `sub`, `exp`, `iss`, `aud` y `role = authenticated` (descarta anon y service_role).
 * - No decide permisos: eso es autorización y vive en el servidor (IdentityService).
 */
@Injectable()
export class JwtVerifierService {
  private readonly logger = new Logger(JwtVerifierService.name);
  private readonly issuer: string | null;
  private readonly audience: string;
  private readonly hmacSecret: Uint8Array | null;
  private readonly clockTolerance: number;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(JWKS_RESOLVER) private readonly jwks: JWTVerifyGetKey | null,
  ) {
    const base = config.get('SUPABASE_URL', { infer: true });
    this.issuer =
      config.get('SUPABASE_JWT_ISSUER', { infer: true }) ??
      (base ? `${base.replace(/\/+$/, '')}/auth/v1` : null);
    this.audience = config.get('SUPABASE_JWT_AUDIENCE', { infer: true });
    const secret = config.get('SUPABASE_JWT_SECRET', { infer: true });
    this.hmacSecret = secret ? new TextEncoder().encode(secret) : null;
    this.clockTolerance = config.get('AUTH_CLOCK_TOLERANCE_S', { infer: true });
    if (!this.issuer || (!this.jwks && !this.hmacSecret)) {
      this.logger.warn(
        'Supabase Auth no configurado (SUPABASE_URL): toda ruta protegida responderá 401',
      );
    }
  }

  async verify(token: string): Promise<Principal> {
    if (!this.issuer || (!this.jwks && !this.hmacSecret)) {
      throw new InvalidTokenError('auth-not-configured');
    }
    let payload: JWTPayload;
    try {
      const algorithms: string[] = [...ASYMMETRIC, ...(this.hmacSecret ? ['HS256'] : [])];
      const result = await jwtVerify(
        token,
        async (header, jwt): Promise<KeyObject | CryptoKey | Uint8Array> => {
          if (header.alg === 'HS256') {
            if (!this.hmacSecret) throw new InvalidTokenError('hs256-not-allowed');
            return this.hmacSecret;
          }
          if (!this.jwks) throw new InvalidTokenError('no-jwks');
          return (await this.jwks(header, jwt)) as KeyObject | CryptoKey;
        },
        {
          issuer: this.issuer,
          audience: this.audience,
          algorithms,
          clockTolerance: this.clockTolerance,
          requiredClaims: ['sub', 'exp', 'iss', 'aud'],
        },
      );
      payload = result.payload;
    } catch (error) {
      throw new InvalidTokenError(describe(error));
    }
    return toPrincipal(payload);
  }
}

function describe(error: unknown): string {
  if (error instanceof InvalidTokenError) return error.reason;
  if (error instanceof joseErrors.JWTExpired) return 'expired';
  if (error instanceof joseErrors.JWTClaimValidationFailed) return `claim:${error.claim}`;
  if (error instanceof joseErrors.JOSEError) return error.code;
  return 'invalid';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toPrincipal(payload: JWTPayload): Principal {
  const sub = str(payload.sub);
  if (!sub || !UUID.test(sub)) throw new InvalidTokenError('claim:sub');
  if (payload['role'] !== 'authenticated') throw new InvalidTokenError('claim:role');

  const appMeta = record(payload['app_metadata']);
  const userMeta = record(payload['user_metadata']);
  const provider = str(appMeta['provider']);
  const amr = Array.isArray(payload['amr']) ? (payload['amr'] as unknown[]) : [];
  const viaOAuth = amr.some((a) => record(a)['method'] === 'oauth');
  const viaTotp = amr.some((a) => record(a)['method'] === 'totp');
  // Solo el claim firmado cuenta; aal2 exige además el segundo factor TOTP registrado en amr.
  const aal = payload['aal'] === 'aal2' && viaTotp ? 'aal2' : 'aal1';
  const email = str(payload['email'])?.toLowerCase() ?? null;
  const name = str(userMeta['full_name']) ?? str(userMeta['name']);

  return {
    authUserId: sub.toLowerCase(),
    email,
    provider,
    // Default-deny: solo se vincula personal si Auth marca el correo como verificado (`email_verified === true`).
    // Ausente, false o de otro tipo = no verificado. Riesgo residual: `user_metadata` es editable por el usuario;
    // la defensa real es deshabilitar el proveedor Email y controlar el linking de identidades en Supabase
    // (docs/security/auth.md).
    googleOAuth: provider === 'google' && viaOAuth && userMeta['email_verified'] === true,
    aal,
    // Solo dato inicial para mostrar: se limpia de caracteres de control y se acota.
    displayName: name ? name.replace(/\p{Cc}/gu, '').slice(0, 120) || null : null,
    avatarUrl: str(userMeta['avatar_url']) ?? str(userMeta['picture']),
  };
}

import { z } from 'zod';

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

/** Un valor vacío (p. ej. `DATABASE_URL=` copiado de .env.example) se trata como no definido. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

/** Zona IANA válida para `Intl.DateTimeFormat` (la rechaza con RangeError si no existe). */
const ianaTimeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'debe ser una zona horaria IANA válida (p. ej. America/Guatemala)');

/** Escenarios del adaptador simulado de PedidosYa (F09 D17). */
export const PEDIDOSYA_MOCK_SCENARIOS = [
  'available',
  'unavailable',
  'unknown',
  'timeout',
  'provider_error',
  'invalid_request',
] as const;
export type PedidosYaMockScenario = (typeof PEDIDOSYA_MOCK_SCENARIOS)[number];

const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/**
 * Esquema de variables de entorno. Falla al arrancar si la configuración es inválida.
 * Los secretos (DATABASE_URL, DIRECT_URL, HEALTH_READY_TOKEN) solo viven en el entorno.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGINS: csv('http://localhost:3000'),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

    /** Transaction pooler de Supabase (puerto 6543, `?pgbouncer=true`). Usado por la API en runtime. */
    DATABASE_URL: optional(
      z.string().regex(/^postgres(ql)?:\/\//, 'debe ser una URL postgresql://'),
    ),
    /** Conexión directa o session pooler (5432). Solo para `prisma migrate`; no la usa la API. */
    DIRECT_URL: optional(z.string().regex(/^postgres(ql)?:\/\//, 'debe ser una URL postgresql://')),
    /** Conexiones por instancia. Pequeño a propósito: cada instancia serverless abre su propio pool. */
    DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),

    /** Ventana y tope del rate limit global (por IP). Los límites por endpoint se ajustan por slice. */
    RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    /** Saltos de proxy de confianza (p. ej. 1 detrás de Vercel/Render) para obtener la IP real. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    /** URL base del proyecto Supabase (p. ej. https://<ref>.supabase.co). */
    SUPABASE_URL: optional(z.url()),
    /** Audiencia esperada del JWT. Supabase usa `authenticated`. */
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    /** Emisor esperado. Por defecto `${SUPABASE_URL}/auth/v1`. */
    SUPABASE_JWT_ISSUER: optional(z.string().min(1)),
    /** JWKS con las claves públicas de firma. Por defecto `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. */
    SUPABASE_JWKS_URL: optional(z.url()),
    /** Secreto HS256 heredado (proyectos sin claves asimétricas). Solo servidor; si se omite, HS256 se rechaza. */
    SUPABASE_JWT_SECRET: optional(z.string().min(32, 'mínimo 32 caracteres')),
    /**
     * Clave de servicio (service role) de Supabase. OPCIONAL y SOLO servidor: habilita únicamente el reinicio de MFA por
     * un administrador (`POST /v1/admin/staff/{id}/mfa-reset`, F02). Sin ella el endpoint responde 503
     * `MFA_RESET_UNAVAILABLE`. Nunca en el cliente (jamás `NEXT_PUBLIC_`), en logs, errores ni auditoría.
     */
    SUPABASE_SERVICE_ROLE_KEY: optional(z.string().min(20, 'mínimo 20 caracteres')),
    /** Tiempo máximo (ms) de cada llamada a la Admin API de Supabase Auth. */
    SUPABASE_ADMIN_TIMEOUT_MS: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(500).max(30_000).default(8_000),
    ),
    /** Tolerancia de reloj al validar exp/nbf (segundos). */
    AUTH_CLOCK_TOLERANCE_S: z.coerce.number().int().min(0).max(60).default(5),

    /** Zona horaria del negocio (F08): los horarios semanales son hora local de esta zona. */
    BUSINESS_TIMEZONE: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      ianaTimeZone.default('America/Guatemala'),
    ),

    /**
     * Adaptador de cobertura de PedidosYa (F09). `unavailable` (defecto, único válido en producción): sin red,
     * responde UNKNOWN / BLOCKED_EXTERNAL. `mock`: simulación determinista SOLO para desarrollo y pruebas.
     */
    PEDIDOSYA_COVERAGE_ADAPTER: z.preprocess(
      blankToUndefined,
      z.enum(['unavailable', 'mock']).default('unavailable'),
    ),
    /** Escenario del mock (solo con `PEDIDOSYA_COVERAGE_ADAPTER=mock`; por defecto `unknown`). */
    PEDIDOSYA_MOCK_SCENARIO: optional(z.enum(PEDIDOSYA_MOCK_SCENARIOS)),
    /** Tope técnico (ms) del orquestador al consultar el adaptador de PedidosYa; no es un SLA del proveedor. */
    PEDIDOSYA_COVERAGE_TIMEOUT_MS: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(100).max(10_000).default(3_000),
    ),

    /**
     * Hosts permitidos para las URL de imágenes de productos (F11, lista separada por comas). Entrada `cdn.ejemplo.com` =
     * coincidencia exacta; `.ejemplo.com` = cualquier subdominio. Vacía o ausente = cualquier host https público (las IP
     * literales, `localhost` y los hostnames sin punto se rechazan siempre). F14 fijará el host de R2/CDN.
     */
    PRODUCT_MEDIA_ALLOWED_HOSTS: z.preprocess(
      blankToUndefined,
      z
        .string()
        .default('')
        .transform((v) =>
          v
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
        .refine(
          (list) =>
            list.every((h) => /^\.?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) && h.includes('.')),
          'cada host debe ser un nombre de dominio con punto (p. ej. cdn.ejemplo.com o .ejemplo.com)',
        ),
    ),

    /** Token de `GET /v1/health/ready` (cabecera `x-health-token`). Obligatorio en producción. */
    HEALTH_READY_TOKEN: optional(z.string().min(16, 'mínimo 16 caracteres')),
  })
  .superRefine((env, ctx) => {
    if (env.PEDIDOSYA_MOCK_SCENARIO && env.PEDIDOSYA_COVERAGE_ADAPTER !== 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PEDIDOSYA_MOCK_SCENARIO'],
        message: 'solo es válido con PEDIDOSYA_COVERAGE_ADAPTER=mock',
      });
    }
    if (env.NODE_ENV === 'production' && env.PEDIDOSYA_COVERAGE_ADAPTER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PEDIDOSYA_COVERAGE_ADAPTER'],
        message: 'el adaptador simulado no se permite en producción',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.SUPABASE_URL) {
      const problem = supabaseUrlProblem(env.SUPABASE_URL);
      if (problem) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: problem });
      }
    }
    if (!env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'obligatoria en producción',
      });
    }
    if (!env.HEALTH_READY_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['HEALTH_READY_TOKEN'],
        message: 'obligatorio en producción',
      });
    }
    if (!env.SUPABASE_URL && !(env.SUPABASE_JWT_ISSUER && env.SUPABASE_JWKS_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'obligatoria en producción (o SUPABASE_JWT_ISSUER + SUPABASE_JWKS_URL)',
      });
    }
    if (env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'no se permite "*" en producción',
      });
    }
  });

/** En producción SUPABASE_URL debe ser https, sin credenciales, sin query ni fragmento (nunca se imprime el valor). */
function supabaseUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL inválida';
  }
  if (url.protocol !== 'https:') return 'en producción debe usar https';
  if (url.username || url.password) return 'no debe incluir credenciales';
  if (url.search || url.hash) return 'no debe incluir query ni fragmento';
  return null;
}

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // Solo nombres de variable y motivo: nunca el valor (podría ser un secreto).
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración de entorno inválida: ${detail}`);
  }
  // El mock exige NODE_ENV EXPLÍCITO en development|test: un NODE_ENV ausente (que aquí se resuelve a `development`
  // por defecto), vacío o desconocido no basta. No cambia el default de NODE_ENV para el resto de la app.
  if (parsed.data.PEDIDOSYA_COVERAGE_ADAPTER === 'mock' && !isMockAllowedNodeEnv(raw['NODE_ENV'])) {
    throw new Error(
      'Configuración de entorno inválida: PEDIDOSYA_COVERAGE_ADAPTER: el adaptador simulado solo se permite con NODE_ENV=development o test explícito',
    );
  }
  // Un NODE_ENV ausente se resuelve a `development` y se SALTARÍA las comprobaciones de producción: si hay señales
  // claras de despliegue exigimos NODE_ENV explícito (el default de desarrollo/test/CI no cambia).
  const signal = missingNodeEnv(raw['NODE_ENV']) ? deploymentSignal(raw, parsed.data) : null;
  if (signal) {
    throw new Error(
      `Configuración de entorno inválida: NODE_ENV: debe definirse explícitamente (${signal}); ` +
        'sin él se aplicarían los valores de desarrollo y se omitirían las comprobaciones de producción',
    );
  }
  return parsed.data;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Variables que las plataformas de despliegue definen en runtime (solo su presencia; nunca su valor). */
const DEPLOYMENT_VARS = [
  'VERCEL',
  'RENDER',
  'FLY_APP_NAME',
  'RAILWAY_ENVIRONMENT',
  'K_SERVICE',
  'WEBSITE_SITE_NAME',
  'DYNO',
] as const;

function missingNodeEnv(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Motivo (sin valores sensibles) por el que parece un despliegue, o null si parece entorno local. */
function deploymentSignal(raw: Record<string, unknown>, env: Env): string | null {
  if (env.DATABASE_URL) {
    let host: string | null = null;
    try {
      host = new URL(env.DATABASE_URL).hostname.toLowerCase();
    } catch {
      // URL ilegible: no se puede afirmar que sea local.
    }
    if (host === null || !LOCAL_HOSTS.has(host)) return 'DATABASE_URL apunta a un host no local';
  }
  const platform = DEPLOYMENT_VARS.find((k) => !missingNodeEnv(raw[k]));
  return platform ? `se detectó la variable de plataforma ${platform}` : null;
}

/** Avisos de arranque no bloqueantes (se registran en `main.ts`). Sin valores sensibles. */
export function envWarnings(env: Pick<Env, 'NODE_ENV' | 'TRUST_PROXY_HOPS'>): string[] {
  const warnings: string[] = [];
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
    warnings.push(
      'TRUST_PROXY_HOPS=0 en producción: detrás de un proxy/CDN todos los clientes compartirían la IP del proxy ' +
        'y el rate limit por IP se aplicaría al conjunto (o sería evadible por cabeceras). Definir >= 1 si hay proxy.',
    );
  }
  return warnings;
}

/** `NODE_ENV` explícito y permitido para el adaptador simulado de PedidosYa. */
export function isMockAllowedNodeEnv(value: unknown): boolean {
  return value === 'development' || value === 'test';
}

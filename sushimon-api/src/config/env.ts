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
  return parsed.data;
}

/** `NODE_ENV` explícito y permitido para el adaptador simulado de PedidosYa. */
export function isMockAllowedNodeEnv(value: unknown): boolean {
  return value === 'development' || value === 'test';
}

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

    /** Token de `GET /v1/health/ready` (cabecera `x-health-token`). Obligatorio en producción. */
    HEALTH_READY_TOKEN: optional(z.string().min(16, 'mínimo 16 caracteres')),
  })
  .superRefine((env, ctx) => {
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
  return parsed.data;
}

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

/**
 * Cliente de base de datos (Prisma 7 + driver adapter `pg`).
 * - Conexión perezosa: arrancar la API NO exige base de datos; `GET /v1/health` sigue respondiendo y
 *   `/v1/health/ready` informa el estado real.
 * - Pool pequeño por instancia (DB_POOL_MAX) pensado para el transaction pooler de Supabase en serverless.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly configured: boolean;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const connectionString = config.get('DATABASE_URL', { infer: true });
    super({
      adapter: new PrismaPg({
        // Sin URL se usa un marcador inerte: nunca se conecta porque `configured` es false.
        connectionString: connectionString ?? 'postgresql://unconfigured.invalid/none',
        max: config.get('DB_POOL_MAX', { infer: true }),
        connectionTimeoutMillis: config.get('DB_CONNECTION_TIMEOUT_MS', { infer: true }),
        idleTimeoutMillis: config.get('DB_IDLE_TIMEOUT_MS', { infer: true }),
      }),
    });
    this.configured = Boolean(connectionString);
    if (!this.configured) this.logger.warn('DATABASE_URL no configurada: sin acceso a datos');
  }

  /** Comprueba conexión y que exista el esquema `app`. Nunca lanza: devuelve el resultado. */
  async checkConnection(): Promise<{ ok: boolean; schemaApp: boolean }> {
    if (!this.configured) return { ok: false, schemaApp: false };
    try {
      const rows = await this.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app') AS present`;
      return { ok: true, schemaApp: rows[0]?.present === true };
    } catch (error) {
      this.logger.error(
        `Fallo de conexión: ${error instanceof Error ? error.name : 'desconocido'}`,
      );
      return { ok: false, schemaApp: false };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

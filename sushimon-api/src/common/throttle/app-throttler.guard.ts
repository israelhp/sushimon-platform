import { HttpStatus, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { codedException } from '../errors/coded-exception.js';

/** Límites por ruta de los endpoints públicos que tocan BD (F09). Por IP y por instancia (ver `TRUST_PROXY_HOPS`). */
export const COVERAGE_CHECK_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
/** Lecturas públicas del catálogo (F11): lista y ficha de productos, 60/min por IP. */
export const PRODUCTS_PUBLIC_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
export const LOCATIONS_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/** Favoritos del cliente (F06 D13). Por IP; cada handler tiene su contador. */
export const FAVORITES_LIST_THROTTLE = { default: { limit: 120, ttl: 60_000 } };
export const FAVORITES_ADD_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
export const FAVORITES_REMOVE_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/**
 * Reinicio de MFA de un empleado (F02): operación de alto impacto. 5 por minuto por ACTOR autenticado (`authUserId`
 * del JWT verificado) y, además, 20 por minuto por IP (varios administradores pueden compartir una salida NAT).
 * El contador por actor depende de que `JwtAuthGuard` corra ANTES que este guard (así `req.principal` ya existe y las
 * solicitudes anónimas no consumen el cupo del actor); lo demuestra `test/staff-mfa-reset.e2e-spec.ts`.
 */
export const MFA_RESET_THROTTLE = {
  default: { limit: 20, ttl: 60_000 },
  actor: { limit: 5, ttl: 60_000 },
};

/**
 * Medios (F14): por ACTOR autenticado y, además, por IP (varios empleados pueden compartir NAT). Mismo patrón que
 * `MFA_RESET_THROTTLE`. Intents: 20/min por actor (cada uno crea una fila y firma una URL de escritura); confirmar:
 * 60/min (consulta R2); borrar: 30/min.
 */
export const MEDIA_INTENT_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 20, ttl: 60_000 },
};
export const MEDIA_COMPLETE_THROTTLE = {
  default: { limit: 120, ttl: 60_000 },
  actor: { limit: 60, ttl: 60_000 },
};
export const MEDIA_DELETE_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 30, ttl: 60_000 },
};

/** Throttler adicional «por actor»: solo cuenta en las rutas que declaran un límite `actor`. */
export const ACTOR_THROTTLER = 'actor';

/** Clave por actor: `authUserId` del principal verificado; sin principal (anónimo) cae a la IP. */
export function actorTracker(req: Record<string, unknown>): Promise<string> {
  const principal = req['principal'] as { authUserId?: unknown } | undefined;
  const id = typeof principal?.authUserId === 'string' ? principal.authUserId : null;
  return Promise.resolve(
    id ? `actor:${id}` : `ip:${typeof req['ip'] === 'string' ? req['ip'] : 'unknown'}`,
  );
}

/** El throttler por actor se salta en toda ruta que no declare `@Throttle({ actor: … })`. */
export function skipUnlessActorLimited(context: ExecutionContext): boolean {
  const key = `THROTTLER:LIMIT${ACTOR_THROTTLER}`;
  return (
    Reflect.getMetadata(key, context.getHandler()) === undefined &&
    Reflect.getMetadata(key, context.getClass()) === undefined
  );
}

/** Mismo token que usa @nestjs/throttler internamente para las opciones del módulo. */
const THROTTLER_OPTIONS = 'THROTTLER:MODULE_OPTIONS';

/**
 * ThrottlerGuard con inyección explícita: `openapi:emit` corre con tsx (esbuild), que no emite
 * `emitDecoratorMetadata`, y el guard original depende de esa metadata para resolver `Reflector`.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  /** El guard global cuenta solo por IP: el throttler por actor lo evalúa `ActorThrottlerGuard` (tras el JWT). */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name !== ACTOR_THROTTLER);
  }

  /** 429 con `code` estable (`RATE_LIMITED`); `Retry-After` ya lo fija el guard y el filtro añade `no-store`. */
  protected override throwThrottlingException(): Promise<void> {
    throw codedException(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Demasiadas solicitudes; reintenta más tarde',
    );
  }
}

/**
 * Guard global registrado DESPUÉS de `JwtAuthGuard` (ver `AuthModule`): evalúa únicamente el throttler `actor`, de modo
 * que `req.principal` ya está verificado al calcular la clave. Una solicitud anónima o con token inválido ya fue
 * rechazada (401) por el JWT y nunca llega aquí: no consume el cupo de ningún actor.
 */
@Injectable()
export class ActorThrottlerGuard extends AppThrottlerGuard {
  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  override async onModuleInit(): Promise<void> {
    await ThrottlerGuard.prototype.onModuleInit.call(this);
    this.throttlers = this.throttlers.filter((t) => t.name === ACTOR_THROTTLER);
  }
}

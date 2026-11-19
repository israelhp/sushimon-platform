import { HttpStatus, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorage,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { Response } from 'express';
import { codedException } from '../errors/coded-exception.js';

/** Límites por ruta de los endpoints públicos que tocan BD (F09). Por IP y por instancia (ver `TRUST_PROXY_HOPS`). */
export const COVERAGE_CHECK_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
/** Lecturas públicas del catálogo (F11): lista y ficha de productos, 60/min por IP. */
export const PRODUCTS_PUBLIC_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
/** Búsqueda pública (F17): más cara que una lectura simple; 30/min por IP, contador propio de la ruta. */
export const STORE_SEARCH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
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

/** Escrituras de promociones (F15): 30/min por ACTOR autenticado y, además, 60/min por IP (NAT compartido). */
export const PROMOTION_WRITE_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 30, ttl: 60_000 },
};

/** Escrituras de banners (F16): 30/min por ACTOR autenticado y, además, 60/min por IP (NAT compartido). */
export const BANNER_WRITE_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 30, ttl: 60_000 },
};

/**
 * Cotización de checkout (F19, P43): 60/min por IP (`default`) y por actor autenticado (`actor`); un invitado cae a su IP.
 * Con `couponCode` en el cuerpo aplican además los contadores propios `coupon` (10/min por IP) y `couponActor` (20/min por
 * actor), para frenar la enumeración de cupones sin castigar el uso normal.
 */
export const CHECKOUT_QUOTE_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 60, ttl: 60_000 },
  coupon: { limit: 10, ttl: 60_000 },
  couponActor: { limit: 20, ttl: 60_000 },
};

/**
 * Creación de pedidos (F20, spec 021 §8): 10/min por IP (`default`) y por actor autenticado (`actor`; un invitado cae a su
 * IP). Un pedido real cuesta una transacción y consume número de secuencia: el límite es mucho menor que el del cotizador.
 */
export const CREATE_ORDER_THROTTLE = {
  default: { limit: 10, ttl: 60_000 },
  actor: { limit: 10, ttl: 60_000 },
};

/** Lectura de un pedido (F20): 60/min por IP y 30/min por actor; los intentos con token inválido también cuentan. */
export const ORDER_READ_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 30, ttl: 60_000 },
};

/**
 * Seguimiento de un pedido (F21, spec 022 §6.5): 120/min por IP y 60/min por actor (un invitado cae a su IP => 60/min
 * efectivos). Contador propio de la ruta (el sondeo no consume la cuota de `getOrder`); los intentos con token inválido cuentan.
 */
export const ORDER_TRACKING_THROTTLE = {
  default: { limit: 120, ttl: 60_000 },
  actor: { limit: 60, ttl: 60_000 },
};

/**
 * Historial, recibo y vista previa de «Volver a pedir» (F23, spec 024 §5.8). Contadores propios de cada ruta, independientes de
 * los de F20/F21/F22. Lista: 120/min por IP y 60/min por actor. Recibo: 60/30 (igual que `getOrder`). Vista previa: 30/15 (es la ruta
 * más cara, ~7 sentencias). Los intentos con token inválido también cuentan.
 */
export const MY_ORDERS_LIST_THROTTLE = {
  default: { limit: 120, ttl: 60_000 },
  actor: { limit: 60, ttl: 60_000 },
};
export const ORDER_RECEIPT_THROTTLE = {
  default: { limit: 60, ttl: 60_000 },
  actor: { limit: 30, ttl: 60_000 },
};
export const ORDER_REORDER_PREVIEW_THROTTLE = {
  default: { limit: 30, ttl: 60_000 },
  actor: { limit: 15, ttl: 60_000 },
};

/**
 * Backoffice de pedidos (F22, spec 023 §6.7). Lecturas (tablero sondeado a ~15 s por pestaña, varias pestañas tras un NAT):
 * 240/min por IP y 90/min por actor. Comandos: 120/min por IP y 60/min por actor. Contadores propios de cada ruta,
 * independientes de los de F20/F21.
 */
export const ADMIN_ORDERS_READ_THROTTLE = {
  default: { limit: 240, ttl: 60_000 },
  actor: { limit: 90, ttl: 60_000 },
};
export const ADMIN_ORDERS_COMMAND_THROTTLE = {
  default: { limit: 120, ttl: 60_000 },
  actor: { limit: 60, ttl: 60_000 },
};

/** Throttler adicional «por actor»: solo cuenta en las rutas que declaran un límite `actor`. */
export const ACTOR_THROTTLER = 'actor';

/** Contadores de cupón de la cotización (F19): por IP y por actor. Solo cuentan si la ruta los declara Y el cuerpo trae cupón. */
export const COUPON_THROTTLER = 'coupon';
export const COUPON_ACTOR_THROTTLER = 'couponActor';
/** Throttlers que evalúa `ActorThrottlerGuard` (después del JWT); el resto los evalúa `AppThrottlerGuard`. */
const ACTOR_SIDE = new Set<string>([ACTOR_THROTTLER, COUPON_ACTOR_THROTTLER]);

/** Clave por actor: `authUserId` del principal verificado; sin principal (anónimo) cae a la IP. */
export function actorTracker(req: Record<string, unknown>): Promise<string> {
  const principal = req['principal'] as { authUserId?: unknown } | undefined;
  const id = typeof principal?.authUserId === 'string' ? principal.authUserId : null;
  return Promise.resolve(
    id ? `actor:${id}` : `ip:${typeof req['ip'] === 'string' ? req['ip'] : 'unknown'}`,
  );
}

const hasLimitMetadata = (name: string, context: ExecutionContext): boolean => {
  const key = `THROTTLER:LIMIT${name}`;
  return (
    Reflect.getMetadata(key, context.getHandler()) !== undefined ||
    Reflect.getMetadata(key, context.getClass()) !== undefined
  );
};

/** ¿El cuerpo ya parseado trae `couponCode` (no vacío)? El guard corre antes que la validación: no se confía en el tipo. */
function bodyHasCoupon(context: ExecutionContext): boolean {
  const body = context.switchToHttp().getRequest<{ body?: unknown }>().body;
  if (typeof body !== 'object' || body === null) return false;
  const code = (body as Record<string, unknown>)['couponCode'];
  return code !== undefined && code !== null && code !== '';
}

/** Los throttlers de cupón se saltan en toda ruta que no los declare y en solicitudes sin cupón. */
export function skipUnlessCouponLimited(name: string) {
  return (context: ExecutionContext): boolean =>
    !hasLimitMetadata(name, context) || !bodyHasCoupon(context);
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
    this.throttlers = this.throttlers.filter((t) => !ACTOR_SIDE.has(t.name ?? ''));
  }

  /**
   * 429 con `code` estable (`RATE_LIMITED`). El guard base fija `Retry-After` solo para el throttler `default`; los demás
   * (p. ej. `actor`) lo emiten con sufijo (`Retry-After-actor`), así que aquí se garantiza SIEMPRE `Retry-After` (segundos
   * hasta que se libere la ventana). El filtro global añade `no-store`.
   */
  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response | undefined>();
    if (res && typeof res.setHeader === 'function' && !res.getHeader('Retry-After')) {
      const seconds = Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 1);
      res.setHeader('Retry-After', String(Math.max(1, seconds)));
    }
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
    this.throttlers = this.throttlers.filter((t) => ACTOR_SIDE.has(t.name ?? ''));
  }
}

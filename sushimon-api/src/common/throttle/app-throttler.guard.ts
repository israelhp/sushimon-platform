import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { codedException } from '../errors/coded-exception.js';

/** Límites por ruta de los endpoints públicos que tocan BD (F09). Por IP y por instancia (ver `TRUST_PROXY_HOPS`). */
export const COVERAGE_CHECK_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
export const LOCATIONS_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/** Favoritos del cliente (F06 D13). Por IP; cada handler tiene su contador. */
export const FAVORITES_LIST_THROTTLE = { default: { limit: 120, ttl: 60_000 } };
export const FAVORITES_ADD_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
export const FAVORITES_REMOVE_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

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

  /** 429 con `code` estable (`RATE_LIMITED`); `Retry-After` ya lo fija el guard y el filtro añade `no-store`. */
  protected override throwThrottlingException(): Promise<void> {
    throw codedException(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Demasiadas solicitudes; reintenta más tarde',
    );
  }
}

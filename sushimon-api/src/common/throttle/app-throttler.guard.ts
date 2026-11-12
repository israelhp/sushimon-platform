import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage, type ThrottlerModuleOptions } from '@nestjs/throttler';

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
}

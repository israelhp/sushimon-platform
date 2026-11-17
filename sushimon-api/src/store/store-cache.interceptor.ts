import { Injectable, type CallHandler, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { BoundedCacheInterceptor, boundedCacheControl } from '../common/http/bounded-cache.js';
import { STORE_MAX_AGE_S } from './store-policy.js';

/** Sin `branchId` la ficha conserva la política de F11 (60 s + revalidación; con ETag como hoy). */
export const PRODUCT_DETAIL_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** Respuesta con secciones degradadas: la CDN la guarda 3 s como máximo; el navegador no. */
export const DEGRADED_CACHE = 'public, max-age=0, s-maxage=3';

interface Cacheable {
  generatedAt: string;
  nextChangeAt: string | null;
  degraded?: readonly unknown[];
}

/**
 * Caché pública de los agregados (ADR-0023): `public, max-age=min(N,5), s-maxage=N`, `N = clamp(segundos hasta
 * nextChangeAt, 1, 15)` (15 sin cambio próximo), `no-store` si `nextChangeAt` ya pasó; `degraded` => `public, max-age=0, s-maxage=3`. Sin
 * ETag ni `stale-while-revalidate`. Solo respuestas exitosas (los errores los marca `no-store` el filtro global).
 */
@Injectable()
export class StoreCacheInterceptor extends BoundedCacheInterceptor {
  protected override cacheControlFor(body: Cacheable): string {
    // Sección que falla: se acota (3 s en la compartida, 0 en el navegador) en vez de anular la CDN.
    if (body.degraded && body.degraded.length > 0) return DEGRADED_CACHE;
    return boundedCacheControl(body, STORE_MAX_AGE_S);
  }
}

/**
 * Ficha de producto: SIN `branchId` => política de F11 (idéntica a la actual); CON `branchId` => política acotada de los
 * agregados y sin ETag. Se decide por la presencia del parámetro (los valores inválidos acaban en 400 `no-store`).
 */
@Injectable()
export class ProductDetailCacheInterceptor extends StoreCacheInterceptor {
  override intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (typeof req.query['branchId'] === 'string') return super.intercept(context, next);
    return next
      .handle()
      .pipe(
        tap(() =>
          context
            .switchToHttp()
            .getResponse<Response>()
            .setHeader('Cache-Control', PRODUCT_DETAIL_CACHE),
        ),
      );
  }
}

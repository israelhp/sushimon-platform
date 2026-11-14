import {
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';

/**
 * Fija `Cache-Control` SOLO en respuestas exitosas (un 404/400 no debe quedar en caché compartida).
 * Se usa un interceptor y no `@Header`, que Nest aplica también a las respuestas de error.
 */
export function CacheControl(value: string): MethodDecorator & ClassDecorator {
  class CacheControlInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      return next
        .handle()
        .pipe(
          tap(() =>
            context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', value),
          ),
        );
    }
  }
  return UseInterceptors(CacheControlInterceptor);
}

/** Datos públicos: caché compartida corta (la API no puede purgar la CDN; ver spec F07 D8). */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

/**
 * Middleware para el prefijo `/v1/admin`: `no-store` en TODA respuesta (también 400/401/403/404), para que
 * ningún intermediario guarde datos o errores administrativos.
 */
export function noStoreMiddleware(
  _req: Request,
  res: Response,
  next: (error?: unknown) => void,
): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

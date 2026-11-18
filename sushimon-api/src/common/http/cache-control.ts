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

/**
 * Middleware de rutas PRIVADAS por solicitud (F19, checkout): `private, no-store` en TODA respuesta, también en 400/401/
 * 429/503, y SIN ETag (Express lo añade con `res.set('ETag', …)` al enviar: se ignora solo para esta respuesta).
 * `AllExceptionsFilter` respeta este valor en lugar de rebajarlo a `no-store`.
 */
export function privateNoStoreMiddleware(
  _req: Request,
  res: Response,
  next: (error?: unknown) => void,
): void {
  res.setHeader('Cache-Control', 'private, no-store');
  const setHeader = res.setHeader.bind(res) as (name: string, value: unknown) => Response;
  res.setHeader = ((name: string, value: unknown) =>
    name.toLowerCase() === 'etag' ? res : setHeader(name, value)) as Response['setHeader'];
  next();
}

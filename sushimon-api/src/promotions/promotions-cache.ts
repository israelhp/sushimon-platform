import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/** Tope de la caché compartida (`s-maxage`, segundos). */
export const PROMOTIONS_MAX_AGE_S = 30;
/** Tope de la caché del navegador (`max-age`, segundos): el navegador no se puede purgar. */
export const PROMOTIONS_BROWSER_MAX_AGE_S = 5;

/**
 * `Cache-Control` público de las promociones (spec F15 D16): `s-maxage = N = clamp(segundos enteros hasta
 * `nextChangeAt`, 1, 30)` (30 si no hay cambio próximo), `max-age = min(N, 5)` y `no-store` si `nextChangeAt` ya pasó.
 * Una edición del backoffice puede tardar hasta 30 s en verse en público (F19 siempre revalida al cotizar). Sin
 * `stale-while-revalidate` ni `ETag`. Se calcula con `generatedAt` de la propia respuesta.
 */
export function promotionsCacheControl(body: {
  generatedAt: string;
  nextChangeAt: string | null;
}): string {
  let seconds = PROMOTIONS_MAX_AGE_S;
  if (body.nextChangeAt !== null) {
    const untilMs = Date.parse(body.nextChangeAt) - Date.parse(body.generatedAt);
    if (!Number.isFinite(untilMs) || untilMs <= 0) return 'no-store';
    seconds = Math.min(PROMOTIONS_MAX_AGE_S, Math.max(1, Math.floor(untilMs / 1000)));
  }
  return `public, max-age=${Math.min(seconds, PROMOTIONS_BROWSER_MAX_AGE_S)}, s-maxage=${seconds}`;
}

/** Solo respuestas exitosas: los errores los marca `no-store` el filtro global. */
@Injectable()
export class PromotionsCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Sin ETag SOLO en esta ruta: Express lo añade con `res.set('ETag', …)` al enviar; se ignora para esta respuesta.
    const res = context.switchToHttp().getResponse<Response>();
    const setHeader = res.setHeader.bind(res) as (name: string, value: unknown) => Response;
    res.setHeader = ((name: string, value: unknown) =>
      name.toLowerCase() === 'etag' ? res : setHeader(name, value)) as Response['setHeader'];
    return next.handle().pipe(
      map((body: { generatedAt: string; nextChangeAt: string | null }) => {
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Cache-Control', promotionsCacheControl(body));
        return body;
      }),
    );
  }
}

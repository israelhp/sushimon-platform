import { Injectable, type CallHandler, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { BoundedCacheInterceptor } from '../common/http/bounded-cache.js';

/** Caché pública fija de los banners (ADR-0033): no hay vigencia que acote; 30 s limitan el desfase tras editar/borrar. */
export const PUBLIC_BANNERS_CACHE = 'public, max-age=15, s-maxage=30';

/** `Cache-Control` constante + `Vary: Accept-Encoding`, sin ETag (lo suprime la clase base). Solo respuestas exitosas. */
@Injectable()
export class PublicBannersCacheInterceptor extends BoundedCacheInterceptor {
  protected override cacheControlFor(): string {
    return PUBLIC_BANNERS_CACHE;
  }

  override intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return super
      .intercept(context, next)
      .pipe(
        tap(() =>
          context.switchToHttp().getResponse<Response>().setHeader('Vary', 'Accept-Encoding'),
        ),
      );
  }
}

import { Injectable } from '@nestjs/common';
import {
  BOUNDED_BROWSER_MAX_AGE_S,
  BOUNDED_MAX_AGE_S,
  BoundedCacheInterceptor,
  boundedCacheControl,
} from '../common/http/bounded-cache.js';

/** Tope de la caché compartida (`s-maxage`, segundos). */
export const PROMOTIONS_MAX_AGE_S = BOUNDED_MAX_AGE_S;
/** Tope de la caché del navegador (`max-age`, segundos): el navegador no se puede purgar. */
export const PROMOTIONS_BROWSER_MAX_AGE_S = BOUNDED_BROWSER_MAX_AGE_S;

/**
 * `Cache-Control` público de las promociones (spec F15 D16). Desde F16 la lógica vive en
 * `common/http/bounded-cache.ts` (la comparte `GET /v1/store/banners`); el comportamiento no cambia.
 */
export const promotionsCacheControl = boundedCacheControl;

/** Solo respuestas exitosas; sin ETag en esta ruta. */
@Injectable()
export class PromotionsCacheInterceptor extends BoundedCacheInterceptor {}

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { BranchAvailabilityDto } from './dto/branch-schedule-responses.dto.js';

/** Tope de caché compartida de la disponibilidad (segundos). */
export const AVAILABILITY_MAX_AGE_S = 10;

/**
 * `Cache-Control` de la disponibilidad pública (D12, M2): `max-age = s-maxage = min(10, segundos enteros hasta
 * `nextTransitionAt`)`, mínimo 0 (0 => `no-store`). Así ninguna respuesta cacheada cruza una transición
 * abierto/cerrado. Sin `stale-while-revalidate`. Se calcula con `serverTime` de la propia respuesta.
 */
export function availabilityCacheControl(body: {
  serverTime: string;
  nextTransitionAt: string | null;
}): string {
  let seconds = AVAILABILITY_MAX_AGE_S;
  if (body.nextTransitionAt !== null) {
    const untilMs = Date.parse(body.nextTransitionAt) - Date.parse(body.serverTime);
    seconds = Math.min(AVAILABILITY_MAX_AGE_S, Math.floor(untilMs / 1000));
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return 'no-store';
  return `public, max-age=${seconds}, s-maxage=${seconds}`;
}

/** Solo respuestas exitosas: los errores los marca `no-store` el filtro global. */
@Injectable()
export class AvailabilityCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: BranchAvailabilityDto) => {
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Cache-Control', availabilityCacheControl(body));
        return body;
      }),
    );
  }
}

import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';

/**
 * Protege `/health/ready` con `x-health-token`. Si HEALTH_READY_TOKEN no está configurado (solo
 * posible fuera de producción) el endpoint queda abierto para facilitar el desarrollo local.
 */
@Injectable()
export class HealthTokenGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('HEALTH_READY_TOKEN', { infer: true });
    if (!expected) return true;
    const provided = context.switchToHttp().getRequest<Request>().header('x-health-token') ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token de salud inválido');
    }
    return true;
  }
}

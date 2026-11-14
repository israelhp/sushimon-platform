import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from './auth.types.js';

/** Identidad autenticada de la solicitud. Solo disponible en rutas no públicas. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<Request>().principal;
    if (!principal) throw new UnauthorizedException('No autenticado');
    return principal;
  },
);

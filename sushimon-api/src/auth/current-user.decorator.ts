import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { StaffContext } from '../identity/identity.types.js';
import type { Principal } from './auth.types.js';

/** Identidad autenticada de la solicitud. Solo disponible en rutas no públicas. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<Request>().principal;
    if (!principal) throw new UnauthorizedException('No autenticado');
    return principal;
  },
);

/** Contexto de personal ya calculado por `StaffGuard` en esta solicitud (evita repetir consultas a la BD). */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffContext => {
    const staff = ctx.switchToHttp().getRequest<Request>().staff;
    if (!staff) throw new UnauthorizedException('No autenticado');
    return staff;
  },
);

import {
  applyDecorators,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type { StaffContext } from '../identity/identity.types.js';
import { AuthorizationService } from './authorization.service.js';
import { MfaGuard } from './mfa.guard.js';

const PERMISSIONS_KEY = 'auth:requiredPermissions';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffContext;
    }
  }
}

/**
 * AUTORIZACIÓN de backoffice: exige personal activo con asignación efectiva y TODOS los permisos indicados,
 * cada uno en algún alcance (sin permisos = solo personal activo). Se evalúa en el servidor desde la base de
 * datos; el token solo prueba quién es. El alcance por sucursal se resuelve por recurso (`scopeFor`/`canAccess`).
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.principal) throw new UnauthorizedException('No autenticado');
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const staff = await this.authorization.staffFor(req);
    // Cada permiso exigido debe existir en ALGÚN alcance; el alcance por recurso lo resuelve cada servicio
    // con `AuthorizationService.scopeFor/canAccess` (nunca con la unión plana).
    if (!staff || !required.every((p) => this.authorization.has(staff, p))) {
      // Mismo mensaje para "no es personal" y "falta permiso": no revela qué existe.
      throw new ForbiddenException('Acceso denegado');
    }
    return true;
  }
}

/**
 * Restringe la ruta al BACKOFFICE: personal activo con los permisos dados Y sesión `aal2` (MFA TOTP).
 * Orden fijo: JWT (global) → personal activo y permisos → MFA aal2. Toda ruta administrativa debe usar este
 * decorador (a nivel de clase o de método); `StaffGuard` suelto NO exige MFA y no debe usarse en rutas.
 */
export const RequireStaff = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(StaffGuard, MfaGuard),
    ApiForbiddenResponse({
      description: 'No es personal activo, falta un permiso o la sesión no es aal2 (MFA_REQUIRED)',
    }),
  );

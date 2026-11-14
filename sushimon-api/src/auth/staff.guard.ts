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
import { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';

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
 * AUTORIZACIÓN de backoffice: exige personal activo con asignación activa y TODOS los permisos indicados
 * (sin permisos = solo personal activo). Se evalúa en el servidor desde la base de datos; el token solo
 * prueba quién es. El alcance por sucursal se comprueba por recurso con `canAccessBranch`.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.principal) throw new UnauthorizedException('No autenticado');
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const staff = (req.staff ??= (await this.identity.getStaffContext(req.principal)) ?? undefined);
    if (!staff || !required.every((p) => staff.permissions.includes(p))) {
      // Mismo mensaje para "no es personal" y "falta permiso": no revela qué existe.
      throw new ForbiddenException('Acceso denegado');
    }
    return true;
  }
}

/** Restringe la ruta a personal activo con los permisos dados. Combínalo con el guard global de JWT. */
export const RequireStaff = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(StaffGuard),
    ApiForbiddenResponse({ description: 'No es personal activo o falta un permiso' }),
  );

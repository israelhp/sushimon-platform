import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/** Código estable para que la web distinga "falta segundo factor" de "sin permiso". */
export const MFA_REQUIRED_MESSAGE = 'MFA_REQUIRED';

/**
 * Exige `aal2` (segundo factor TOTP verificado por Supabase Auth). Lee SOLO `req.principal.aal`, que sale del
 * JWT con firma, emisor y audiencia ya verificados por `JwtAuthGuard`: nunca de body, query, cabeceras
 * personalizadas ni cookies. Se evalúa DESPUÉS de `StaffGuard` para no revelar a quien no es personal si un
 * correo existe; el personal que aún está en `aal1` recibe `MFA_REQUIRED` (es información de su propia cuenta).
 */
@Injectable()
export class MfaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.principal) throw new UnauthorizedException('No autenticado');
    if (req.principal.aal !== 'aal2') throw new ForbiddenException(MFA_REQUIRED_MESSAGE);
    return true;
  }
}

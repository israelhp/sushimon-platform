import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_OPTIONAL_AUTH_KEY } from './optional-auth.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { InvalidTokenError, JwtVerifierService } from './jwt-verifier.service.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/;
const MAX_HEADER = 8_192;

/**
 * Guard global: toda ruta exige un JWT válido salvo las marcadas con `@Public()`. `@OptionalAuth()` (F19) admite además
 * invitados, pero SOLO si la solicitud no trae cabecera `Authorization`: con cabecera, el token debe ser válido.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtVerifierService) private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const header = req.header('authorization');
    if (header === undefined) {
      const optional = this.reflector.getAllAndOverride<boolean | undefined>(IS_OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (optional === true) return true; // invitado: `req.principal` queda indefinido
    }
    const match = header && header.length <= MAX_HEADER ? BEARER.exec(header) : null;
    const token = match?.[1];
    if (!token) this.reject(http.getResponse<Response>(), req, 'missing-or-malformed');

    try {
      req.principal = await this.verifier.verify(token);
      return true;
    } catch (error) {
      const reason = error instanceof InvalidTokenError ? error.reason : 'unexpected';
      return this.reject(http.getResponse<Response>(), req, reason);
    }
  }

  /** Respuesta uniforme: no revela por qué falló; el motivo va al log con el requestId (sin el token). */
  private reject(res: Response, req: Request, reason: string): never {
    this.logger.warn(`[${req.id ?? '-'}] token rechazado: ${reason}`);
    res.setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException('No autenticado');
  }
}

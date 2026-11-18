import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'auth:isOptional';

/**
 * Autenticación OPCIONAL (F19, ADR-0025 D2): la ruta admite invitados. Lo lee `JwtAuthGuard` (global): SIN cabecera
 * `Authorization` => invitado (`req.principal` indefinido); cabecera presente pero token inválido/mal formado => 401
 * (nunca se degrada a invitado); token válido => `req.principal`. Sin este metadato toda ruta sigue exigiendo JWT
 * (denegar por defecto). No concede ningún permiso: el controlador/servicio decide qué exige sesión.
 */
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

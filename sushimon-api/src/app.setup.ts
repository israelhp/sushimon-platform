import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { bodyParserErrorMiddleware } from './common/http/body-parser-error.middleware.js';
import { privateNoStoreMiddleware } from './common/http/cache-control.js';

/** `Vary` de las rutas de pedidos: la respuesta depende de la sesión y del token de invitado. */
function orderVaryMiddleware(
  _req: unknown,
  res: { vary: (field: string) => unknown },
  next: (error?: unknown) => void,
): void {
  res.vary('Authorization');
  res.vary('X-Order-Token');
  next();
}

/** `Vary` de la lista de pedidos del cliente (F23): depende solo de la sesión. */
function authorizationVaryMiddleware(
  _req: unknown,
  res: { vary: (field: string) => unknown },
  next: (error?: unknown) => void,
): void {
  res.vary('Authorization');
  next();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Sushi Mon API')
    .setVersion('0.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-health-token' }, 'health-token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export interface AppSetupOptions {
  corsOrigins: string[];
  /** Saltos de proxy de confianza para `req.ip` (rate limit por IP real). */
  trustProxyHops?: number;
}

/** Configuración compartida entre main.ts y las pruebas e2e. */
export function configureApp(app: NestExpressApplication, options: AppSetupOptions): void {
  if (options.trustProxyHops) app.set('trust proxy', options.trustProxyHops);
  app.use(helmet());
  // Cotización de checkout (F19): `private, no-store` y sin ETag desde ANTES del parser JSON, para que también los
  // errores del parser (413, JSON inválido) salgan privados. Nest registraría el parser en `init()`, después de esto.
  app.use('/v1/checkout', privateNoStoreMiddleware);
  // Pedidos (F20): datos personales y token de invitado; mismo trato (también 400/401/404/409/422/429/503).
  // `Vary: Authorization, X-Order-Token` también aquí (no solo en los handlers) para que lo lleven los errores (400/404/429/503):
  // el 404 de un pedido ajeno no debe poder servirse a otro solicitante desde una caché intermedia.
  app.use('/v1/orders', privateNoStoreMiddleware, orderVaryMiddleware);
  // Historial del cliente (F23): lista privada; `Vary: Authorization` y `no-store` también en 401/400/429/503.
  app.use('/v1/me/orders', privateNoStoreMiddleware, authorizationVaryMiddleware);
  app.useBodyParser('json');
  app.use(bodyParserErrorMiddleware);
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: options.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After', 'Location'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Siempre lista de mensajes → el filtro la expone como `details`.
      exceptionFactory: (errors) =>
        new BadRequestException(
          errors.flatMap((e) => Object.values(e.constraints ?? { [e.property]: 'inválido' })),
        ),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

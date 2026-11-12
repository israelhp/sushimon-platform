import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';

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
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: options.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
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

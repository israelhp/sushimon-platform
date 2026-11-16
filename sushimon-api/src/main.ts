import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { envWarnings, type Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = new Logger('Bootstrap');
  for (const warning of envWarnings({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
  })) {
    logger.warn(warning);
  }
  configureApp(app, {
    corsOrigins: config.get('CORS_ORIGINS', { infer: true }),
    trustProxyHops: config.get('TRUST_PROXY_HOPS', { infer: true }),
  });
  app.enableShutdownHooks();
  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();

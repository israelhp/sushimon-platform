import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app, {
    corsOrigins: config.get('CORS_ORIGINS', { infer: true }),
    trustProxyHops: config.get('TRUST_PROXY_HOPS', { infer: true }),
  });
  app.enableShutdownHooks();
  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();

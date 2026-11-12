import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { buildOpenApiDocument, configureApp } from '../src/app.setup.js';

/** Emite el OpenAPI generado por NestJS para compararlo con el contrato canónico (contract test). */
const out = process.argv[2];
if (!out) throw new Error('Uso: emit-openapi <ruta-de-salida.json>');

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
configureApp(app, { corsOrigins: [] });
writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2));
await app.close();

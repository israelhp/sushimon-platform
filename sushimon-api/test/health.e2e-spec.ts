import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

const TOKEN = 'token-e2e-123456789';

async function createApp(
  db: { ok: boolean; schemaApp: boolean },
  env: Record<string, string> = {},
): Promise<NestExpressApplication> {
  Object.assign(process.env, { HEALTH_READY_TOKEN: TOKEN, RATE_LIMIT_MAX: '1000' }, env);
  // ConfigModule.forRoot lee process.env al importar AppModule: se reimporta por caso.
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ checkConnection: () => Promise.resolve(db), $disconnect: () => Promise.resolve() })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('API foundations (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  afterEach(async () => {
    await app.close();
    delete process.env['RATE_LIMIT_MAX'];
    delete process.env['HEALTH_READY_TOKEN'];
  });

  describe('GET /v1/health', () => {
    beforeEach(async () => {
      app = await createApp({ ok: false, schemaApp: false });
    });

    it('responde 200 { status: "ok" } aunque la base de datos no esté disponible', async () => {
      const res = await http().get('/v1/health').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('devuelve X-Request-Id y reutiliza el entrante válido', async () => {
      const generated = await http().get('/v1/health').expect(200);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const echoed = await http().get('/v1/health').set('x-request-id', 'trace-abc-12345');
      expect(echoed.headers['x-request-id']).toBe('trace-abc-12345');
    });

    it('error estándar con requestId en rutas inexistentes', async () => {
      const res = await http().get('/v1/nope').expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND' });
      expect((res.body as { requestId?: string }).requestId).toBe(res.headers['x-request-id']);
    });

    it('aplica cabeceras de seguridad y CORS con origen explícito', async () => {
      const res = await http().get('/v1/health').set('origin', 'http://localhost:3000');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      const denied = await http().get('/v1/health').set('origin', 'https://evil.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('GET /v1/health/ready', () => {
    it('401 sin token o con token inválido', async () => {
      app = await createApp({ ok: true, schemaApp: true });
      const none = await http().get('/v1/health/ready').expect(401);
      expect(none.body).toMatchObject({ statusCode: 401, error: 'UNAUTHORIZED' });
      await http().get('/v1/health/ready').set('x-health-token', 'incorrecto').expect(401);
    });

    it('200 con token y base de datos disponible', async () => {
      app = await createApp({ ok: true, schemaApp: true });
      const res = await http().get('/v1/health/ready').set('x-health-token', TOKEN).expect(200);
      expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', schemaApp: 'present' } });
    });

    it('503 genérico sin filtrar detalles si la base de datos falla', async () => {
      app = await createApp({ ok: false, schemaApp: false });
      const res = await http().get('/v1/health/ready').set('x-health-token', TOKEN).expect(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: 'Dependencias no disponibles',
      });
    });
  });

  describe('rate limiting', () => {
    it('429 con error estándar al exceder el tope (health liveness exento)', async () => {
      app = await createApp({ ok: true, schemaApp: true }, { RATE_LIMIT_MAX: '2' });
      await http().get('/v1/health/ready').set('x-health-token', TOKEN).expect(200);
      await http().get('/v1/health/ready').set('x-health-token', TOKEN).expect(200);
      const limited = await http().get('/v1/health/ready').set('x-health-token', TOKEN).expect(429);
      expect(limited.body).toMatchObject({ statusCode: 429 });
      for (let i = 0; i < 5; i++) await http().get('/v1/health').expect(200);
    });
  });
});

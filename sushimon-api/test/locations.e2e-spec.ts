import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestKeys } from './support/tokens.js';

const GT = 'd0000000-0000-4000-8000-000000000001';
const SM = 'd0000000-0000-4000-8000-000000000002';
const NONE = 'd0000000-0000-4000-8000-0000000000ff';
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

const departments = [
  { id: 'a2', name: 'Sololá' },
  { id: 'a1', name: 'Alta Verapaz' },
  { id: 'a4', name: 'Quiché' },
  { id: 'a3', name: 'Quetzaltenango' },
  { id: 'a5', name: 'Sacatepéquez' },
];
const municipalities: Record<string, { id: string; departmentId: string; name: string }[]> = {
  [GT]: [
    { id: 'm3', departmentId: GT, name: 'Villa Nueva' },
    { id: 'm1', departmentId: GT, name: 'Amatitlán' },
    { id: 'm2', departmentId: GT, name: 'Mixco' },
    { id: 'm4', departmentId: GT, name: 'San José Pinula' },
    { id: 'm5', departmentId: GT, name: 'San José del Golfo' },
    { id: 'm6', departmentId: GT, name: 'Santa Catarina Pinula' },
  ],
  [SM]: [],
};

describe('Catálogos geográficos (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const keys = await createTestKeys();
    Object.assign(process.env, {
      SUPABASE_URL: 'http://127.0.0.1:54341',
      HEALTH_READY_TOKEN: 'token-e2e-123456789',
      RATE_LIMIT_MAX: '1000',
    });
    vi.resetModules();
    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');
    const { PrismaService } = await import('../src/database/prisma.service.js');
    const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
    const { LocationsRepository } = await import('../src/locations/locations.repository.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $disconnect: () => Promise.resolve() })
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(LocationsRepository)
      .useValue({
        listDepartments: () => Promise.resolve([...departments]),
        listMunicipalities: (id: string) => Promise.resolve(municipalities[id] ?? null),
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /locations/departments: público, ordenado en español sin acentos, caché pública larga', async () => {
    const res = await http().get('/v1/locations/departments').expect(200);
    expect(res.headers['cache-control']).toBe(CACHE);
    expect((res.body as { items: { name: string }[] }).items.map((d) => d.name)).toEqual([
      'Alta Verapaz',
      'Quetzaltenango',
      'Quiché',
      'Sacatepéquez',
      'Sololá',
    ]);
  });

  it('GET /locations/municipalities: ordenado, solo id/departmentId/name, caché pública', async () => {
    const res = await http()
      .get('/v1/locations/municipalities')
      .query({ departmentId: GT })
      .expect(200);
    expect(res.headers['cache-control']).toBe(CACHE);
    const items = (res.body as { items: Record<string, string>[] }).items;
    expect(items.map((m) => m['name'])).toEqual([
      'Amatitlán',
      'Mixco',
      'San José del Golfo',
      'San José Pinula',
      'Santa Catarina Pinula',
      'Villa Nueva',
    ]);
    expect(Object.keys(items[0]!).sort()).toEqual(['departmentId', 'id', 'name']);
  });

  it('departamento existente sin municipios => 200 con items vacío (con caché)', async () => {
    const res = await http()
      .get('/v1/locations/municipalities')
      .query({ departmentId: SM })
      .expect(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.headers['cache-control']).toBe(CACHE);
  });

  it('departmentId inexistente => 404 DEPARTMENT_NOT_FOUND; ausente o no UUID => 400; errores NO se cachean', async () => {
    const nf = await http()
      .get('/v1/locations/municipalities')
      .query({ departmentId: NONE })
      .expect(404);
    expect(nf.body).toMatchObject({ statusCode: 404, code: 'DEPARTMENT_NOT_FOUND' });
    expect(nf.headers['cache-control']).toBe('no-store');
    for (const url of [
      '/v1/locations/municipalities',
      '/v1/locations/municipalities?departmentId=xx',
    ]) {
      const bad = await http().get(url).expect(400);
      expect(bad.headers['cache-control']).toBe('no-store');
    }
  });

  it('parámetros no declarados en la consulta => 400 (lista blanca)', async () => {
    await http()
      .get('/v1/locations/municipalities')
      .query({ departmentId: GT, q: 'x' })
      .expect(400);
  });
});

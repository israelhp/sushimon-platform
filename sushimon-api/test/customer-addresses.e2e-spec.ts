import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { fakeAddressesDb, MUNI, type AddressesDb } from './support/addresses-harness.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

/**
 * F05 · HTTP real de `/v1/me/addresses` con Prisma en memoria (sin PostgreSQL ni red). IDOR, límite y predeterminada
 * con SQL real: `customer-addresses.int-spec.ts`.
 */
const USER_B = '8c1e2d3f-4a5b-4c6d-8e7f-901234567890';
const USER_C = '9d2f3e40-5b6c-4d7e-9f80-a12345678901';
const COLLECTION = '/v1/me/addresses';
const MISSING = '99999999-9999-4999-8999-999999999999';

async function createApp(keys: TestKeys) {
  const db = fakeAddressesDb();
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return { app, db };
}

const idOf = (res: { body: unknown }): string => (res.body as { id: string }).id;

const input = (n: number, over: Record<string, unknown> = {}) => ({
  label: `Casa ${n}`,
  municipalityId: MUNI,
  addressLine: `Calle ${n} #1`,
  zone: 'Zona 10',
  ...over,
});

describe('F05 · direcciones del cliente (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: AddressesDb;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    ({ app, db } = await createApp(keys));
  });

  afterEach(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const as = async (sub: string) => `Bearer ${await keys.sign({ sub })}`;
  const create = async (sub: string, body: Record<string, unknown>) =>
    http()
      .post(COLLECTION)
      .set('Authorization', await as(sub))
      .send(body);

  describe('autenticación', () => {
    it('sin token => 401 en las seis operaciones y sin tocar la base', async () => {
      await http().get(COLLECTION).expect(401);
      await http().post(COLLECTION).send(input(1)).expect(401);
      await http().get(`${COLLECTION}/${MISSING}`).expect(401);
      await http().patch(`${COLLECTION}/${MISSING}`).send({ label: 'x' }).expect(401);
      await http().delete(`${COLLECTION}/${MISSING}`).expect(401);
      await http().patch(`${COLLECTION}/${MISSING}/default`).expect(401);
      expect(db.customer.create).not.toHaveBeenCalled();
      expect(db.rows).toHaveLength(0);
    });

    it('JWT firmado con otra clave => 401 y no escribe', async () => {
      const forged = await keys.signWithForeignKey();
      await http()
        .post(COLLECTION)
        .set('Authorization', `Bearer ${forged}`)
        .send(input(1))
        .expect(401);
      expect(db.rows).toHaveLength(0);
      expect(db.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('cabeceras', () => {
    it('Cache-Control: no-store en éxitos y errores', async () => {
      const auth = await as(USER_ID);
      const post = await http().post(COLLECTION).set('Authorization', auth).send(input(1));
      expect(post.status).toBe(201);
      expect(post.headers['cache-control']).toBe('no-store');
      const list = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      expect(list.headers['cache-control']).toBe('no-store');
      const notFound = await http()
        .get(`${COLLECTION}/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect(notFound.headers['cache-control']).toBe('no-store');
      const noAuth = await http().get(COLLECTION).expect(401);
      expect(noAuth.headers['cache-control']).toBe('no-store');
    });
  });

  describe('las lecturas no crean el cliente', () => {
    it('GET lista sin fila de cliente => 200 vacío y no se crea', async () => {
      const res = await http()
        .get(COLLECTION)
        .set('Authorization', await as(USER_ID))
        .expect(200);
      expect(res.body).toEqual({ items: [] });
      expect(db.customer.create).not.toHaveBeenCalled();
      expect(db.customers.size).toBe(0);
    });

    it('GET/PATCH/DELETE/default de un id sin fila de cliente => 404 y no se crea', async () => {
      const auth = await as(USER_ID);
      const url = `${COLLECTION}/${MISSING}`;
      for (const res of [
        await http().get(url).set('Authorization', auth),
        await http().patch(url).set('Authorization', auth).send({ label: 'Nueva' }),
        await http().delete(url).set('Authorization', auth),
        await http().patch(`${url}/default`).set('Authorization', auth),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
      }
      expect(db.customer.create).not.toHaveBeenCalled();
      expect(db.customers.size).toBe(0);
    });

    it('solo POST crea la fila de cliente', async () => {
      await create(USER_ID, input(1)).then((r) => expect(r.status).toBe(201));
      expect(db.customer.create).toHaveBeenCalledTimes(1);
      expect(db.customers.has(USER_ID)).toBe(true);
    });
  });

  describe('validación (400)', () => {
    it.each([
      ['sin label', { label: undefined }],
      ['municipalityId no UUID', { municipalityId: 'x' }],
      ['campo desconocido', { foo: 'bar' }],
      ['customerId en el cuerpo', { customerId: MISSING }],
      ['label no es texto', { label: 5 }],
      ['addressLine demasiado larga', { addressLine: 'x'.repeat(1001) }],
    ])('POST %s => 400 y no escribe', async (_n, over) => {
      const res = await create(USER_ID, { ...input(1), ...over });
      expect(res.status).toBe(400);
      expect(db.rows).toHaveLength(0);
    });

    it('municipio inexistente => 400 MUNICIPALITY_NOT_FOUND', async () => {
      const res = await create(USER_ID, input(1, { municipalityId: MISSING }));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'MUNICIPALITY_NOT_FOUND' });
    });

    it('id de ruta no UUID => 400; PATCH con isDefault => 400', async () => {
      const auth = await as(USER_ID);
      await http().get(`${COLLECTION}/no-uuid`).set('Authorization', auth).expect(400);
      await http().delete(`${COLLECTION}/no-uuid`).set('Authorization', auth).expect(400);
      const created = await create(USER_ID, input(1));
      await http()
        .patch(`${COLLECTION}/${idOf(created)}`)
        .set('Authorization', auth)
        .send({ isDefault: true })
        .expect(400);
    });
  });

  describe('IDOR por HTTP: la dirección de B es invisible para A', () => {
    it('A no ve, edita, borra ni marca la de B (404 ADDRESS_NOT_FOUND) y B la conserva intacta', async () => {
      const b = await create(USER_B, input(1));
      expect(b.status).toBe(201);
      const idB = idOf(b);
      await create(USER_ID, input(2)); // A existe como cliente

      const authA = await as(USER_ID);
      const url = `${COLLECTION}/${idB}`;
      const responses = [
        await http().get(url).set('Authorization', authA),
        await http().patch(url).set('Authorization', authA).send({ label: 'Robada' }),
        await http().delete(url).set('Authorization', authA),
        await http().patch(`${url}/default`).set('Authorization', authA),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
        expect(JSON.stringify(res.body)).not.toContain(idB);
      }
      const mine = await http().get(COLLECTION).set('Authorization', authA).expect(200);
      expect((mine.body as { items: unknown[] }).items).toHaveLength(1);

      const theirs = await http()
        .get(url)
        .set('Authorization', await as(USER_B))
        .expect(200);
      expect(theirs.body).toMatchObject({ id: idB, label: 'Casa 1' });
    });

    it('un customerId en el cuerpo se rechaza: el propietario es siempre el del JWT', async () => {
      const res = await create(USER_ID, { ...input(1), customerId: MISSING });
      expect(res.status).toBe(400);
      expect(db.rows).toHaveLength(0);
    });
  });

  describe('límite, duplicado y predeterminada', () => {
    it('la 11.ª dirección => 409 ADDRESS_LIMIT_REACHED', async () => {
      for (let n = 1; n <= 10; n++) {
        expect((await create(USER_ID, input(n))).status).toBe(201);
      }
      const res = await create(USER_ID, input(11));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ADDRESS_LIMIT_REACHED' });
      expect(db.rows).toHaveLength(10);
      // El límite es por cliente: otro cliente sigue pudiendo crear.
      expect((await create(USER_C, input(1))).status).toBe(201);
    });

    it('duplicado => 409 ADDRESS_DUPLICATE', async () => {
      await create(USER_ID, input(1));
      const res = await create(USER_ID, input(1, { label: 'Otra' }));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ADDRESS_DUPLICATE' });
    });

    it('la primera es predeterminada; isDefault y PATCH :id/default reasignan una sola', async () => {
      const auth = await as(USER_ID);
      const first = await create(USER_ID, input(1));
      const second = await create(USER_ID, input(2));
      expect(first.body).toMatchObject({ isDefault: true });
      expect(second.body).toMatchObject({ isDefault: false });

      const third = await create(USER_ID, input(3, { isDefault: true }));
      expect(third.body).toMatchObject({ isDefault: true });

      const set = await http()
        .patch(`${COLLECTION}/${idOf(second)}/default`)
        .set('Authorization', auth)
        .expect(200);
      expect(set.body).toMatchObject({ isDefault: true });
      const list = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      const items = (list.body as { items: { id: string; isDefault: boolean }[] }).items;
      expect(items.filter((i) => i.isDefault).map((i) => i.id)).toEqual([idOf(second)]);
      expect(items[0]?.isDefault).toBe(true); // la predeterminada va primero
    });

    it('borrar la predeterminada reasigna la más antigua restante; 204', async () => {
      const auth = await as(USER_ID);
      const a = await create(USER_ID, input(1));
      const b = await create(USER_ID, input(2));
      await http()
        .delete(`${COLLECTION}/${idOf(a)}`)
        .set('Authorization', auth)
        .expect(204);
      const got = await http()
        .get(`${COLLECTION}/${idOf(b)}`)
        .set('Authorization', auth)
        .expect(200);
      expect(got.body).toMatchObject({ isDefault: true });
    });
  });

  it('la auditoría de direcciones no guarda el contenido (PII)', async () => {
    const created = await create(USER_ID, input(1, { addressLine: 'Calle Secreta 123' }));
    await http()
      .patch(`${COLLECTION}/${idOf(created)}`)
      .set('Authorization', await as(USER_ID))
      .send({ addressLine: 'Otra Calle Privada 9' })
      .expect(200);
    expect(db.audit.map((e) => e['action'])).toEqual([
      'customer_address.created',
      'customer_address.updated',
    ]);
    expect(JSON.stringify(db.audit)).not.toMatch(/Secreta|Privada/);
  });
});

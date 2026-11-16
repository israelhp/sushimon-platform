import { Logger, type HttpException } from '@nestjs/common';
import {
  FakeCatalog,
  FakeFavoritesRepo,
  P1,
  P2,
  P3,
  P_MISSING,
  principal,
  product,
} from '../../test/support/favorites-harness.js';
import type { IdentityService } from '../identity/identity.service.js';
import { CATALOG_TIMEOUT_MS, MAX_FAVORITES_PER_CUSTOMER } from './favorites.constants.js';
import type { FavoritesRepository } from './favorites.repository.js';
import { FavoritesService } from './favorites.service.js';
import { UnavailableCatalogAdapter } from './unavailable-catalog.adapter.js';

const CUSTOMER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function harness(items = [product(P1), product(P2), product(P3)]) {
  const repo = new FakeFavoritesRepo();
  const catalog = new FakeCatalog(items);
  const identity = {
    ensureCustomer: vi.fn().mockResolvedValue(CUSTOMER),
    findCustomer: vi.fn().mockResolvedValue(CUSTOMER),
  };
  const service = new FavoritesService(
    repo as unknown as FavoritesRepository,
    identity as unknown as IdentityService,
    catalog,
  );
  return { repo, catalog, identity, service };
}

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const code = (e: HttpException) => (e.getResponse() as { code?: string }).code;

describe('FavoritesService', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('PUT (add)', () => {
    it('feliz: inserta, llama a ensureCustomer y consulta el catálogo UNA vez', async () => {
      const h = harness();
      const p = principal();
      await h.service.add(p, P1);
      expect(h.identity.ensureCustomer).toHaveBeenCalledWith(p);
      expect(h.repo.rows).toHaveLength(1);
      expect(h.repo.rows[0]).toMatchObject({ customerId: CUSTOMER.id, productId: P1 });
      expect(h.catalog.calls).toEqual([[P1]]);
    });

    it('repetido: no duplica ni cambia created_at', async () => {
      const h = harness();
      await h.service.add(principal(), P1);
      const first = h.repo.rows[0]?.createdAt;
      await h.service.add(principal(), P1);
      expect(h.repo.rows).toHaveLength(1);
      expect(h.repo.rows[0]?.createdAt).toBe(first);
    });

    it('UNAVAILABLE (publicado, no pedible ahora) SÍ se puede marcar (A4)', async () => {
      const h = harness([product(P1, { status: 'UNAVAILABLE' })]);
      await h.service.add(principal(), P1);
      expect(h.repo.rows).toHaveLength(1);
    });

    it.each([
      ['ausente', []],
      ['INACTIVE', [product(P1, { status: 'INACTIVE' })]],
      ['REMOVED', [product(P1, { status: 'REMOVED' })]],
    ])('producto %s => 404 PRODUCT_NOT_FOUND sin escribir', async (_n, items) => {
      const h = harness(items);
      const e = await failure(h.service.add(principal(), P1));
      expect(e.getStatus()).toBe(404);
      expect(code(e)).toBe('PRODUCT_NOT_FOUND');
      expect(h.repo.rows).toHaveLength(0);
      expect(h.repo.queries.add).toBe(0);
    });

    it.each(['unavailable', 'throws'] as const)(
      'catálogo %s => 503 CATALOG_UNAVAILABLE sin escribir ni filtrar la causa',
      async (mode) => {
        const h = harness();
        h.catalog.mode = mode;
        const e = await failure(h.service.add(principal(), P1));
        expect(e.getStatus()).toBe(503);
        expect(code(e)).toBe('CATALOG_UNAVAILABLE');
        expect(JSON.stringify(e.getResponse())).not.toContain('secreto');
        expect(h.repo.queries.add).toBe(0);
        expect(warn).toHaveBeenCalled();
      },
    );

    it('timeout del catálogo (3 s) => 503 sin escribir', async () => {
      vi.useFakeTimers();
      const h = harness();
      h.catalog.mode = 'hangs';
      const pending = failure(h.service.add(principal(), P1));
      await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS + 1);
      const e = await pending;
      expect(e.getStatus()).toBe(503);
      expect(h.repo.queries.add).toBe(0);
    });

    it('UnavailableCatalogAdapter (doble de prueba, ya no enlazado) => 503', async () => {
      const h = harness();
      const service = new FavoritesService(
        h.repo as unknown as FavoritesRepository,
        h.identity as unknown as IdentityService,
        new UnavailableCatalogAdapter(),
      );
      const e = await failure(service.add(principal(), P1));
      expect(code(e)).toBe('CATALOG_UNAVAILABLE');
      expect(h.repo.rows).toHaveLength(0);
    });

    it.each([
      ['55P03', { code: '55P03' }],
      ['P2028', { code: 'P2028' }],
      ['55P03 en cause', { cause: { originalCode: '55P03' } }],
    ])(
      'candado/tiempo agotado (%s) => 503 FAVORITES_BUSY sin filtrar la causa',
      async (_n, err) => {
        const h = harness();
        vi.spyOn(h.repo, 'add').mockRejectedValueOnce(
          Object.assign(new Error('lock secreto interno'), err),
        );
        const e = await failure(h.service.add(principal(), P1));
        expect(e.getStatus()).toBe(503);
        expect(code(e)).toBe('FAVORITES_BUSY');
        expect(JSON.stringify(e.getResponse())).not.toContain('secreto');
      },
    );

    it('otro error de BD se relanza sin traducir (500 genérico)', async () => {
      const h = harness();
      const boom = new Error('otro');
      vi.spyOn(h.repo, 'add').mockRejectedValueOnce(boom);
      await expect(h.service.add(principal(), P1)).rejects.toBe(boom);
    });

    describe('tope', () => {
      const fill = (h: ReturnType<typeof harness>) => {
        for (let i = 0; i < MAX_FAVORITES_PER_CUSTOMER; i++)
          h.repo.seed(CUSTOMER.id, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      };

      it('con 200: producto nuevo => 422 FAVORITES_LIMIT_REACHED', async () => {
        const h = harness();
        fill(h);
        const e = await failure(h.service.add(principal(), P1));
        expect(e.getStatus()).toBe(422);
        expect(code(e)).toBe('FAVORITES_LIMIT_REACHED');
        expect(h.repo.rows).toHaveLength(MAX_FAVORITES_PER_CUSTOMER);
      });

      it('con 200: ya favorito => 204 (idempotente)', async () => {
        const h = harness();
        fill(h);
        h.repo.rows.pop();
        h.repo.seed(CUSTOMER.id, P1);
        await expect(h.service.add(principal(), P1)).resolves.toBeUndefined();
        expect(h.repo.rows).toHaveLength(MAX_FAVORITES_PER_CUSTOMER);
      });

      it('con 199 se puede añadir uno y luego queda al tope', async () => {
        const h = harness();
        fill(h);
        h.repo.rows.pop();
        await h.service.add(principal(), P1);
        expect(h.repo.rows).toHaveLength(MAX_FAVORITES_PER_CUSTOMER);
        expect(code(await failure(h.service.add(principal(), P2)))).toBe('FAVORITES_LIMIT_REACHED');
      });

      it('404 antes que 422; el catálogo caído (503) antes que el tope', async () => {
        const h = harness();
        fill(h);
        expect(code(await failure(h.service.add(principal(), P_MISSING)))).toBe(
          'PRODUCT_NOT_FOUND',
        );
        h.catalog.mode = 'unavailable';
        expect(code(await failure(h.service.add(principal(), P1)))).toBe('CATALOG_UNAVAILABLE');
      });
    });
  });

  describe('DELETE (remove)', () => {
    it('quita el propio y no llama al catálogo', async () => {
      const h = harness();
      h.repo.seed(CUSTOMER.id, P1);
      await h.service.remove(principal(), P1);
      expect(h.repo.rows).toHaveLength(0);
      expect(h.catalog.calls).toHaveLength(0);
    });

    it('inexistente => éxito; con catálogo caído también', async () => {
      const h = harness();
      h.catalog.mode = 'unavailable';
      await expect(h.service.remove(principal(), P_MISSING)).resolves.toBeUndefined();
      expect(h.catalog.calls).toHaveLength(0);
    });

    it('solo borra del cliente del JWT (el favorito de otro cliente no se toca)', async () => {
      const h = harness();
      h.repo.seed(OTHER, P1);
      await h.service.remove(principal(), P1);
      expect(h.repo.rows).toHaveLength(1);
    });

    it('principal sin fila de cliente: 204 sin crear el perfil ni tocar el repositorio', async () => {
      const h = harness();
      h.identity.findCustomer.mockResolvedValue(null);
      await expect(h.service.remove(principal(), P1)).resolves.toBeUndefined();
      expect(h.identity.ensureCustomer).not.toHaveBeenCalled();
      expect(h.repo.queries.remove).toBe(0);
    });
  });

  describe('GET (list)', () => {
    it('principal sin fila de cliente: lista vacía, sin crear el perfil y sin consultar el catálogo', async () => {
      const h = harness();
      h.identity.findCustomer.mockResolvedValue(null);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(r).toMatchObject({
        items: [],
        total: 0,
        favoriteProductIds: [],
        catalogStatus: 'AVAILABLE',
        limit: MAX_FAVORITES_PER_CUSTOMER,
      });
      expect(h.identity.ensureCustomer).not.toHaveBeenCalled();
      expect(h.repo.queries.list).toBe(0);
      expect(h.catalog.calls).toHaveLength(0);
    });

    it('pageSize=0: ids y total reales, sin items y SIN consultar el catálogo', async () => {
      const h = harness();
      h.repo.seed(CUSTOMER.id, P1);
      h.repo.seed(CUSTOMER.id, P2);
      const r = await h.service.list(principal(), { page: 1, pageSize: 0 });
      expect(r).toMatchObject({
        items: [],
        total: 2,
        pageSize: 0,
        limit: MAX_FAVORITES_PER_CUSTOMER,
        favoriteProductIds: [P2, P1],
      });
      expect(h.catalog.calls).toHaveLength(0);
    });

    it('orden created_at DESC con desempate product_id ASC', async () => {
      const h = harness();
      const same = new Date('2026-11-01T00:00:00Z');
      h.repo.seed(CUSTOMER.id, P3, same);
      h.repo.seed(CUSTOMER.id, P1, same);
      h.repo.seed(CUSTOMER.id, P2, new Date('2026-11-02T00:00:00Z'));
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(r.favoriteProductIds).toEqual([P2, P1, P3]);
      expect(r.items.map((i) => i.productId)).toEqual([P2, P1, P3]);
    });

    it('paginación: segunda página y una sola consulta de catálogo con SOLO esa página', async () => {
      const h = harness();
      h.repo.seed(CUSTOMER.id, P1);
      h.repo.seed(CUSTOMER.id, P2);
      h.repo.seed(CUSTOMER.id, P3);
      const r = await h.service.list(principal(), { page: 2, pageSize: 2 });
      expect(r.items.map((i) => i.productId)).toEqual([P1]);
      expect(r.total).toBe(3);
      expect(r.favoriteProductIds).toHaveLength(3);
      expect(h.catalog.calls).toEqual([[P1]]);
    });

    it('página más allá del final: vacía y sin consultar el catálogo', async () => {
      const h = harness();
      h.repo.seed(CUSTOMER.id, P1);
      const r = await h.service.list(principal(), { page: 5, pageSize: 20 });
      expect(r.items).toEqual([]);
      expect(h.catalog.calls).toHaveLength(0);
    });

    it('estados: ACTIVE y UNAVAILABLE con resumen; INACTIVE, REMOVED y ausente sin resumen', async () => {
      const h = harness([
        product(P1, { status: 'ACTIVE', name: 'Roll' }),
        product(P2, { status: 'UNAVAILABLE' }),
        product(P3, { status: 'INACTIVE' }),
        product('44444444-4444-4444-8444-444444444444', { status: 'REMOVED' }),
      ]);
      for (const id of [P1, P2, P3, '44444444-4444-4444-8444-444444444444', P_MISSING])
        h.repo.seed(CUSTOMER.id, id);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      const by = Object.fromEntries(r.items.map((i) => [i.productId, i]));
      expect(r.catalogStatus).toBe('AVAILABLE');
      expect(by[P1]).toMatchObject({ status: 'ACTIVE', product: { id: P1, name: 'Roll' } });
      expect(by[P2]?.status).toBe('UNAVAILABLE');
      expect(by[P2]?.product).not.toBeNull();
      expect(by[P3]).toMatchObject({ status: 'INACTIVE', product: null });
      expect(by['44444444-4444-4444-8444-444444444444']).toMatchObject({
        status: 'REMOVED',
        product: null,
      });
      expect(by[P_MISSING]).toMatchObject({ status: 'REMOVED', product: null });
      expect(h.catalog.calls).toHaveLength(1);
    });

    it('estado desconocido del catálogo => UNKNOWN sin resumen', async () => {
      const h = harness([product(P1, { status: 'ARCHIVED' as never })]);
      h.repo.seed(CUSTOMER.id, P1);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(r.items[0]).toMatchObject({ status: 'UNKNOWN', product: null });
    });

    it.each(['unavailable', 'throws'] as const)(
      'catálogo %s => 200 degradado: UNAVAILABLE, items UNKNOWN con product null y datos reales',
      async (mode) => {
        const h = harness();
        h.catalog.mode = mode;
        h.repo.seed(CUSTOMER.id, P1);
        h.repo.seed(CUSTOMER.id, P2);
        const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
        expect(r.catalogStatus).toBe('UNAVAILABLE');
        expect(r.total).toBe(2);
        expect(r.favoriteProductIds).toEqual([P2, P1]);
        expect(r.items.map((i) => [i.productId, i.status, i.product])).toEqual([
          [P2, 'UNKNOWN', null],
          [P1, 'UNKNOWN', null],
        ]);
        expect(r.items[0]?.addedAt).toBeInstanceOf(Date);
      },
    );

    it('timeout del catálogo => degradado', async () => {
      vi.useFakeTimers();
      const h = harness();
      h.catalog.mode = 'hangs';
      h.repo.seed(CUSTOMER.id, P1);
      const pending = h.service.list(principal(), { page: 1, pageSize: 20 });
      await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS + 1);
      expect((await pending).catalogStatus).toBe('UNAVAILABLE');
    });

    it('lista blanca: los campos extra del puerto (precio, costo) no salen', async () => {
      const h = harness([
        product(P1, {
          price: '45.00',
          internalCost: '12.00',
          imageUrl: 'https://cdn.example/a.jpg',
        }),
      ]);
      h.repo.seed(CUSTOMER.id, P1);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(Object.keys(r.items[0]?.product ?? {}).sort()).toEqual([
        'categoryId',
        'id',
        'imageUrl',
        'name',
        'nameEn',
      ]);
      expect(JSON.stringify(r)).not.toContain('45.00');
      expect(JSON.stringify(r)).not.toContain('internalCost');
    });

    it('imageUrl que no es http(s) se anula', async () => {
      const h = harness([product(P1, { imageUrl: 'javascript:alert(1)' })]);
      h.repo.seed(CUSTOMER.id, P1);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(r.items[0]?.product?.imageUrl).toBeNull();
    });

    it('presupuesto de consultas: findCustomer + 1 listado + 1 lote; total = filas leídas (sin conteo)', async () => {
      const h = harness();
      h.repo.seed(CUSTOMER.id, P1);
      h.repo.seed(CUSTOMER.id, P2);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(h.identity.findCustomer).toHaveBeenCalledTimes(1);
      expect(h.repo.queries.list).toBe(1);
      expect(h.catalog.calls).toHaveLength(1);
      expect(r.total).toBe(2);
    });

    it('aislamiento: no lista favoritos de otro cliente', async () => {
      const h = harness();
      h.repo.seed(OTHER, P1);
      const r = await h.service.list(principal(), { page: 1, pageSize: 20 });
      expect(r.total).toBe(0);
      expect(r.favoriteProductIds).toEqual([]);
    });
  });
});

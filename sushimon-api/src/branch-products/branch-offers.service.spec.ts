import {
  bid,
  bpid,
  fakeProduct,
  FakeBranchProductsRepo,
} from '../../test/support/fake-branch-products-repo.js';
import { CAT, productsHarness } from '../../test/support/products-harness.js';
import { BranchOffersService } from './branch-offers.service.js';
import type { BranchProductsRepository } from './branch-products.repository.js';

const A = bid(1);
const B = bid(2);
const P1 = bpid(1);
const P2 = bpid(2);
const P3 = bpid(3);

function setup() {
  const repo = new FakeBranchProductsRepo();
  repo.seedBranch(A);
  repo.seedBranch(B);
  repo.seedBranch(bid(3), { active: false });
  repo.seedProduct(fakeProduct(1, { slug: 'b-roll', basePrice: '50.00' }));
  repo.seedProduct(fakeProduct(2, { slug: 'a-te', basePrice: '10.00', categoryId: CAT.calientes }));
  repo.seedProduct(fakeProduct(3, { slug: 'c-inactivo', active: false }));
  const { categoriesQuery } = productsHarness();
  const r = repo as unknown as BranchProductsRepository;
  return {
    repo,
    offers: new BranchOffersService(r, categoriesQuery),
  };
}

const violations = (e: unknown) =>
  (e as { response: { violations: { path: string; code: string }[] } }).response.violations;
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;

describe('BranchOffersService.resolve', () => {
  it('UNA consulta; ids duplicados se colapsan; inexistentes ausentes; precio efectivo por sucursal', async () => {
    const { offers, repo } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.00', available: false });
    const map = await offers.resolve(A, [P1, P1, P2, bpid(99)]);
    expect(repo.count('resolveMany')).toBe(1);
    expect([...map.keys()].sort()).toEqual([P1, P2].sort());
    expect(map.get(P1)).toEqual({ price: '45.00', basePrice: '50.00', available: false });
    expect(map.get(P2)).toEqual({ price: '10.00', basePrice: '10.00', available: true });
    const other = await offers.resolve(B, [P1]);
    expect(other.get(P1)).toEqual({ price: '50.00', basePrice: '50.00', available: true });
  });

  it('lista vacía => mapa vacío sin consultar', async () => {
    const { offers, repo } = setup();
    expect((await offers.resolve(A, [])).size).toBe(0);
    expect(repo.count('resolveMany')).toBe(0);
  });

  it('entradas malas: ids no UUID = ausentes (sin SQL); >200 o no arreglo => 422 de dominio, nunca 500', async () => {
    const { offers, repo } = setup();
    const map = await offers.resolve(A, [
      'no-uuid',
      5,
      null,
      "x' OR '1'='1",
      P1,
    ] as unknown as string[]);
    expect([...map.keys()]).toEqual([P1]);
    expect((await offers.resolve(A, ['zzz'])).size).toBe(0);
    expect(repo.count('resolveMany')).toBe(1); // 'zzz' solo no llega a la BD
    const tooMany = await failure(
      offers.resolve(
        A,
        Array.from({ length: 201 }, (_, i) => bpid(1000 + i)),
      ),
    );
    expect([(tooMany as { status: number }).status, code(tooMany)]).toEqual([
      422,
      'PRODUCT_NOT_AVAILABLE',
    ]);
    const notArray = await failure(offers.resolve(A, 'x' as unknown as string[]));
    expect((notArray as { status: number }).status).toBe(422);
    const badBranch = await failure(offers.resolve('no-uuid', [P1]));
    expect(code(badBranch)).toBe('BRANCH_NOT_AVAILABLE');
  });

  it('resolve es solo precio/disponibilidad: no aplica visibilidad ni expone `offered`', async () => {
    const { offers } = setup();
    const map = await offers.resolve(A, [P2, P3]); // categoría oculta e inactivo
    expect(map.get(P2)).toEqual({ price: '10.00', basePrice: '10.00', available: true });
    expect(Object.keys(map.get(P3) ?? {}).sort()).toEqual(['available', 'basePrice', 'price']);
  });
});

describe('BranchOffersService.assertOrderable', () => {
  it('productos visibles y disponibles pasan', async () => {
    const { offers } = setup();
    await expect(offers.assertOrderable(A, [P1])).resolves.toBeUndefined();
  });

  it('lista vacía => 422 PRODUCT_NOT_AVAILABLE con violación productIds (sin consultar la BD)', async () => {
    const { offers, repo } = setup();
    const e = await failure(offers.assertOrderable(A, []));
    expect([(e as { status: number }).status, code(e)]).toEqual([422, 'PRODUCT_NOT_AVAILABLE']);
    expect(violations(e)).toEqual([
      expect.objectContaining({ path: 'productIds', code: 'PRODUCT_UNKNOWN' }),
    ]);
    expect(repo.count('findBranchStatus')).toBe(0);
  });

  it('devuelve TODAS las violaciones con su código', async () => {
    const { offers, repo } = setup();
    repo.seedRow(A, P1, { available: false });
    const e = await failure(offers.assertOrderable(A, [P1, P2, P3, bpid(99)]));
    expect((e as { status: number }).status).toBe(422);
    expect(code(e)).toBe('PRODUCT_NOT_AVAILABLE');
    expect(violations(e)).toEqual([
      expect.objectContaining({ path: 'productIds[0]', code: 'PRODUCT_SOLD_OUT' }),
      expect.objectContaining({ path: 'productIds[1]', code: 'PRODUCT_HIDDEN' }),
      expect.objectContaining({ path: 'productIds[2]', code: 'PRODUCT_HIDDEN' }),
      expect.objectContaining({ path: 'productIds[3]', code: 'PRODUCT_UNKNOWN' }),
    ]);
  });

  it('un producto oculto con fila (override o disponible) NUNCA es ordenable', async () => {
    const { offers, repo } = setup();
    repo.seedRow(A, P2, { priceOverride: '5.00' });
    const e = await failure(offers.assertOrderable(A, [P2]));
    expect(violations(e)[0]?.code).toBe('PRODUCT_HIDDEN');
  });

  it('el agotamiento es por sucursal', async () => {
    const { offers, repo } = setup();
    repo.seedRow(A, P1, { available: false });
    await expect(offers.assertOrderable(B, [P1])).resolves.toBeUndefined();
    expect(code(await failure(offers.assertOrderable(A, [P1])))).toBe('PRODUCT_NOT_AVAILABLE');
  });

  it('sucursal inexistente, inactiva o mal formada => 422 BRANCH_NOT_AVAILABLE', async () => {
    const { offers, repo } = setup();
    for (const b of [bid(99), bid(3), 'no-uuid']) {
      const e = await failure(offers.assertOrderable(b, [P1]));
      expect([(e as { status: number }).status, code(e)]).toEqual([422, 'BRANCH_NOT_AVAILABLE']);
    }
    expect(repo.count('resolveMany')).toBe(2); // 'no-uuid' no llega a la BD
  });

  it('guardas defensivas: no arreglo, > 200 ids, ids mal formados => 422 sin TypeError ni SQL', async () => {
    const { offers, repo } = setup();
    const notArray = await failure(offers.assertOrderable(A, 'x' as unknown as string[]));
    expect(code(notArray)).toBe('PRODUCT_NOT_AVAILABLE');
    const tooMany = await failure(
      offers.assertOrderable(
        A,
        Array.from({ length: 201 }, (_, i) => bpid(1000 + i)),
      ),
    );
    expect(violations(tooMany)[0]?.path).toBe('productIds');
    const malformed = await failure(
      offers.assertOrderable(A, [P1, 'zzz', 5] as unknown as string[]),
    );
    expect(violations(malformed).map((v) => v.path)).toEqual(['productIds[1]', 'productIds[2]']);
    expect(repo.count('findBranchStatus')).toBe(1); // solo el caso de ids mal formados llegó a la BD
  });

  it('las violaciones se cortan en 50', async () => {
    const { offers } = setup();
    const ids = Array.from({ length: 120 }, (_, i) => bpid(2000 + i));
    const e = await failure(offers.assertOrderable(A, ids));
    expect(violations(e)).toHaveLength(50);
  });

  it('lecturas constantes (sucursal, visibilidad, resolve), sin N+1', async () => {
    const { offers, repo } = setup();
    await offers.assertOrderable(A, [P1]);
    expect(repo.count('findBranchStatus')).toBe(1);
    expect(repo.count('resolveMany')).toBe(1);
  });
});

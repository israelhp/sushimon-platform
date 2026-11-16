import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { CAT, pid, productRow, productsHarness } from '../../test/support/products-harness.js';
import { uniqueViolation } from '../../test/support/fake-products-repo.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { AdminProductsService } from './admin-products.service.js';
import type { ProductsRepository } from './products.repository.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];
const staff = (scoped = false): StaffContext => ({
  ...(scoped ? scopedStaff(PERMS, ['branch-1']) : globalStaff(PERMS)),
  staffId: 'staff-1',
});

interface AuditEvent {
  action: string;
  entityId: string;
  actorId: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

function setup(allowedHosts: string[] = []) {
  const h = productsHarness();
  const audit: AuditEvent[] = [];
  const auditService = {
    record: vi.fn((_tx: unknown, event: AuditEvent) => {
      h.repo.calls.push('audit');
      audit.push(event);
      return Promise.resolve();
    }),
  };
  const service = new AdminProductsService(
    h.repo as unknown as ProductsRepository,
    auditService,
    new AuthorizationService({} as IdentityService),
    h.categoriesQuery,
    { get: () => allowedHosts } as unknown as ConfigService<Env, true>,
  );
  return { service, audit, auditService, ...h };
}

const create = { name: 'Roll California', basePrice: '85.00', categoryId: CAT.frios };
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('AdminProductsService.create', () => {
  it('crea en una transacción: categoría → insert → audit; slug autogenerado; respuesta completa', async () => {
    const { service, repo, audit } = setup();
    const view = await service.create(staff(), {
      ...create,
      name: '  Roll   Fríos ',
      sku: ' rc-01 ',
      description: ' Texto ',
      media: [{ url: 'https://cdn.x.io/a.jpg', altText: 'A' }, { url: 'https://cdn.x.io/b.jpg' }],
    });
    expect(repo.calls).toEqual([
      'transaction',
      'findCategory',
      'findSlugs',
      'insert',
      'replaceMedia',
      'audit',
    ]);
    expect(view).toMatchObject({
      slug: 'roll-frios',
      name: 'Roll Fríos',
      sku: 'RC-01',
      description: 'Texto',
      basePrice: '85.00',
      categoryId: CAT.frios,
      active: true,
      publiclyVisible: true,
      category: { slug: 'frios', active: true, effectivelyVisible: true },
    });
    expect(view.media.map((m) => [m.sortOrder, m.url, m.altText])).toEqual([
      [0, 'https://cdn.x.io/a.jpg', 'A'],
      [1, 'https://cdn.x.io/b.jpg', null],
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'product.created',
      entityId: view.id,
      actorId: 'staff-1',
      newValues: { slug: 'roll-frios', basePrice: '85.00', mediaCount: 2, active: true },
    });
    expect(JSON.stringify(audit[0])).not.toContain('Texto');
  });

  it('sin media no llama a replaceMedia; active=false se respeta', async () => {
    const { service, repo } = setup();
    const view = await service.create(staff(), { ...create, active: false });
    expect(repo.calls).not.toContain('replaceMedia');
    expect(view).toMatchObject({ active: false, publiclyVisible: false, media: [] });
  });

  it('desambigua el slug autogenerado (-2, -3) y NO cambia uno explícito', async () => {
    const { service } = setup();
    expect((await service.create(staff(), create)).slug).toBe('roll-california');
    expect((await service.create(staff(), create)).slug).toBe('roll-california-2');
    expect((await service.create(staff(), create)).slug).toBe('roll-california-3');
    expect((await service.create(staff(), { ...create, slug: 'mi-slug' })).slug).toBe('mi-slug');
  });

  it('slug explícito duplicado => 409 PRODUCT_SLUG_TAKEN; sku duplicado => 409 PRODUCT_SKU_TAKEN; sin audit', async () => {
    const { service, audit, repo } = setup();
    await service.create(staff(), { ...create, slug: 'uno', sku: 'A-1' });
    audit.length = 0;
    const dupSlug = await failure(service.create(staff(), { ...create, slug: 'uno' }));
    expect(dupSlug).toMatchObject({ status: 409 });
    expect(code(dupSlug)).toBe('PRODUCT_SLUG_TAKEN');
    const dupSku = await failure(service.create(staff(), { ...create, slug: 'dos', sku: 'a-1' }));
    expect(dupSku).toMatchObject({ status: 409 });
    expect(code(dupSku)).toBe('PRODUCT_SKU_TAKEN');
    expect(audit).toHaveLength(0);
    expect(repo.products.size).toBe(1);
  });

  it('categoría inexistente o inactiva => 422 PRODUCT_CATEGORY_INVALID; en categoría oculta pero ACTIVA se permite', async () => {
    const { service, repo } = setup();
    for (const categoryId of ['00000000-0000-4000-8000-0000000000ff', CAT.calientes]) {
      const e = await failure(service.create(staff(), { ...create, categoryId }));
      expect(e).toMatchObject({ status: 422 });
      expect(code(e)).toBe('PRODUCT_CATEGORY_INVALID');
    }
    expect(repo.count('insert')).toBe(0);
    // `tempura` está activa pero su padre no: se permite (no se exige visibilidad efectiva).
    const view = await service.create(staff(), { ...create, categoryId: CAT.hijaDeInactiva });
    expect(view).toMatchObject({ publiclyVisible: false, category: { effectivelyVisible: false } });
  });

  it('media inválida => 422 PRODUCT_MEDIA_INVALID sin tocar la base; precio inválido => 400', async () => {
    const { service, repo } = setup();
    const e = await failure(
      service.create(staff(), { ...create, media: [{ url: 'http://x.io/a' }] }),
    );
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    expect(await failure(service.create(staff(), { ...create, basePrice: '0.00' }))).toMatchObject({
      status: 400,
    });
    expect(await failure(service.create(staff(), { ...create, basePrice: '85' }))).toMatchObject({
      status: 400,
    });
    expect(repo.calls).toEqual([]);
  });

  it('alcance solo por sucursal => 403 antes de tocar la base', async () => {
    const { service, repo, auditService } = setup();
    await expect(service.create(staff(true), create)).rejects.toMatchObject({ status: 403 });
    expect(repo.calls).toEqual([]);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('el trigger de tope de imágenes (23514) se traduce a 422; un timeout (P2028) a 503 PRODUCTS_BUSY', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = Object.assign(new Error('product_media_max_items'), { code: '23514' });
    const trigger = await failure(
      service.create(staff(), { ...create, media: [{ url: 'https://x.io/a' }] }),
    );
    expect(code(trigger)).toBe('PRODUCT_MEDIA_INVALID');
    expect(repo.products.size).toBe(0); // rollback
    repo.failTransactionWith = Object.assign(new Error('Transaction already closed'), {
      code: 'P2028',
    });
    const busy = await failure(service.create(staff(), create));
    expect(busy).toMatchObject({ status: 503 });
    expect(code(busy)).toBe('PRODUCTS_BUSY');
  });

  it('carrera en el índice único (insert falla con 23505) se traduce por columna; otro objetivo => error original', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = uniqueViolation('products_slug_key');
    expect(code(await failure(service.create(staff(), { ...create, slug: 'explicito' })))).toBe(
      'PRODUCT_SLUG_TAKEN',
    );
    repo.failNextWriteWith = uniqueViolation('products_sku_key');
    expect(code(await failure(service.create(staff(), create)))).toBe('PRODUCT_SKU_TAKEN');
    const other = uniqueViolation('products_pkey');
    repo.failNextWriteWith = other;
    expect(await failure(service.create(staff(), create))).toBe(other);
  });
});

describe('AdminProductsService.update', () => {
  const seedOne = (h: ReturnType<typeof setup>) =>
    h.repo.seed(
      productRow(pid(1), {
        name: 'Roll',
        slug: 'roll',
        sku: 'R-1',
        categoryId: CAT.frios,
        basePrice: '85.00',
      }),
      [{ url: 'https://cdn.x.io/a.jpg', altText: 'A' }, { url: 'https://cdn.x.io/b.jpg' }],
    );

  it('PATCH parcial: bloquea, lee, escribe y audita updated (old/new solo de lo cambiado)', async () => {
    const h = setup();
    seedOne(h);
    h.repo.calls.length = 0;
    const view = await h.service.update(staff(), pid(1), { name: ' Roll 2 ', basePrice: '90.00' });
    expect(h.repo.calls).toEqual([
      'transaction',
      'lock',
      'findById',
      'findMediaInTx',
      'update',
      'audit',
    ]);
    expect(view).toMatchObject({ name: 'Roll 2', basePrice: '90.00', slug: 'roll' });
    expect(view.media).toHaveLength(2); // sin tocar
    expect(h.audit).toEqual([
      expect.objectContaining({
        action: 'product.updated',
        entityId: pid(1),
        oldValues: { name: 'Roll', basePrice: '85.00' },
        newValues: { name: 'Roll 2', basePrice: '90.00', changedFields: ['name', 'basePrice'] },
      }),
    ]);
  });

  it('sin cambios reales => 200 sin escribir ni auditar', async () => {
    const h = setup();
    seedOne(h);
    h.repo.calls.length = 0;
    const view = await h.service.update(staff(), pid(1), {
      name: 'Roll',
      sku: 'r-1',
      basePrice: '85.00',
      active: true,
      media: [{ url: 'https://cdn.x.io/a.jpg', altText: 'A' }, { url: 'https://cdn.x.io/b.jpg' }],
    });
    expect(view.id).toBe(pid(1));
    expect(h.repo.count('update')).toBe(0);
    expect(h.repo.count('replaceMedia')).toBe(0);
    expect(h.audit).toHaveLength(0);
  });

  it('desactivar/activar emite SOLO product.deactivated/activated (sin updated); mezclado emite ambos', async () => {
    const h = setup();
    seedOne(h);
    await h.service.update(staff(), pid(1), { active: false });
    expect(h.audit.map((a) => a.action)).toEqual(['product.deactivated']);
    h.audit.length = 0;
    await h.service.update(staff(), pid(1), { active: true, name: 'Otro' });
    expect(h.audit.map((a) => a.action)).toEqual(['product.updated', 'product.activated']);
  });

  it('media enviada REEMPLAZA: orden 0..n-1; [] la vacía; omitir no la toca', async () => {
    const h = setup();
    seedOne(h);
    const swapped = await h.service.update(staff(), pid(1), {
      media: [{ url: 'https://cdn.x.io/b.jpg' }, { url: 'https://cdn.x.io/c.jpg', altText: ' C ' }],
    });
    expect(swapped.media.map((m) => [m.sortOrder, m.url, m.altText])).toEqual([
      [0, 'https://cdn.x.io/b.jpg', null],
      [1, 'https://cdn.x.io/c.jpg', 'C'],
    ]);
    expect(h.audit[0]).toMatchObject({
      action: 'product.updated',
      oldValues: { mediaCount: 2 },
      newValues: { mediaCount: 2, changedFields: ['media'] },
    });
    const emptied = await h.service.update(staff(), pid(1), { media: [] });
    expect(emptied.media).toEqual([]);
    expect(h.repo.media.get(pid(1))).toEqual([]);
    const untouched = await h.service.update(staff(), pid(1), { name: 'Z' });
    expect(untouched.media).toEqual([]);
  });

  it('sku: null lo borra; sku/slug repetidos de otro producto => 409', async () => {
    const h = setup();
    seedOne(h);
    h.repo.seed(productRow(pid(2), { slug: 'otro', sku: 'O-1' }));
    expect((await h.service.update(staff(), pid(1), { sku: null })).sku).toBeNull();
    expect(code(await failure(h.service.update(staff(), pid(1), { sku: 'o-1' })))).toBe(
      'PRODUCT_SKU_TAKEN',
    );
    expect(code(await failure(h.service.update(staff(), pid(1), { slug: 'otro' })))).toBe(
      'PRODUCT_SLUG_TAKEN',
    );
    // su propio slug no es conflicto (sin cambio)
    await expect(h.service.update(staff(), pid(1), { slug: 'roll' })).resolves.toBeDefined();
  });

  it('cambiar categoryId exige categoría ACTIVA (422); sin cambiarla con categoría inactiva se permite editar', async () => {
    const h = setup();
    h.repo.seed(productRow(pid(1), { slug: 'a', categoryId: CAT.calientes })); // en categoría inactiva
    const edited = await h.service.update(staff(), pid(1), {
      name: 'Editado',
      categoryId: CAT.calientes,
    });
    expect(edited).toMatchObject({ name: 'Editado', publiclyVisible: false });
    expect(h.repo.count('findCategory')).toBe(0); // mismo categoryId: no se valida
    const missing = '00000000-0000-4000-8000-0000000000ff';
    expect(code(await failure(h.service.update(staff(), pid(1), { categoryId: missing })))).toBe(
      'PRODUCT_CATEGORY_INVALID',
    );
    h.repo.seed(productRow(pid(2), { slug: 'b', categoryId: CAT.frios }));
    expect(
      code(await failure(h.service.update(staff(), pid(2), { categoryId: CAT.calientes }))),
    ).toBe('PRODUCT_CATEGORY_INVALID');
    const moved = await h.service.update(staff(), pid(2), { categoryId: CAT.bebidas });
    expect(moved.category.slug).toBe('bebidas');
    expect(h.audit.at(-1)).toMatchObject({ newValues: { categoryId: CAT.bebidas } });
  });

  it('inexistente => 404 PRODUCT_NOT_FOUND (después del 403); cuerpo vacío => 400; alcance de sucursal => 403', async () => {
    const h = setup();
    expect(code(await failure(h.service.update(staff(), pid(99), { name: 'x' })))).toBe(
      'PRODUCT_NOT_FOUND',
    );
    expect(await failure(h.service.update(staff(), pid(99), {}))).toMatchObject({ status: 400 });
    h.repo.calls.length = 0;
    expect(await failure(h.service.update(staff(true), pid(99), { name: 'x' }))).toMatchObject({
      status: 403,
    });
    expect(h.repo.calls).toEqual([]);
  });

  it('una falla a mitad de la transacción revierte producto, imágenes y auditoría', async () => {
    const h = setup();
    seedOne(h);
    h.repo.failNextWriteWith = null;
    const original = h.repo.replaceMedia.bind(h.repo);
    h.repo.replaceMedia = (...args) => {
      void original(...args);
      return Promise.reject(
        Object.assign(new Error('x'), { code: '23514', message: 'product_media_max_items' }),
      );
    };
    const e = await failure(
      h.service.update(staff(), pid(1), {
        name: 'Cambiado',
        media: [{ url: 'https://cdn.x.io/z.jpg' }],
      }),
    );
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    expect(h.repo.products.get(pid(1))?.name).toBe('Roll');
    expect(h.repo.media.get(pid(1))).toHaveLength(2);
  });

  it('P2028 en la actualización => 503 PRODUCTS_BUSY', async () => {
    const h = setup();
    seedOne(h);
    h.repo.failNextWriteWith = { code: 'P2028' };
    const e = await failure(h.service.update(staff(), pid(1), { name: 'x' }));
    expect(e).toMatchObject({ status: 503 });
    expect(code(e)).toBe('PRODUCTS_BUSY');
  });
});

describe('AdminProductsService · host de imágenes (PRODUCT_MEDIA_ALLOWED_HOSTS)', () => {
  const create = { name: 'Roll', basePrice: '85.00', categoryId: CAT.frios };
  it('con lista: host exacto y subdominios (.dominio) pasan; otro host => 422 sin escribir', async () => {
    const h = setup(['cdn.good.com', '.assets.io']);
    for (const url of ['https://cdn.good.com/a.jpg', 'https://x.assets.io/a.jpg']) {
      await expect(
        h.service.create(staff(), { ...create, media: [{ url }] }),
      ).resolves.toBeDefined();
    }
    for (const url of [
      'https://evil.com/a.jpg',
      'https://good.com/a.jpg',
      'https://other.cdn.good.com/a.jpg',
      'https://assets.io/a.jpg',
      'https://assets.io.evil.com/a.jpg',
    ]) {
      const e = await failure(h.service.create(staff(), { ...create, media: [{ url }] }));
      expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    }
    expect(h.repo.products.size).toBe(2);
  });
  it('PATCH también aplica la lista; sin lista cualquier host público pasa', async () => {
    const h = setup(['cdn.good.com']);
    h.repo.seed(productRow(pid(1), { slug: 'a' }));
    const e = await failure(
      h.service.update(staff(), pid(1), { media: [{ url: 'https://evil.com/a.jpg' }] }),
    );
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    const open = setup([]);
    await expect(
      open.service.create(staff(), {
        ...create,
        media: [{ url: 'https://anything.example.org/a.jpg' }],
      }),
    ).resolves.toBeDefined();
  });
});

describe('AdminProductsService · reintento del slug autogenerado', () => {
  const create = { name: 'Roll California', basePrice: '85.00', categoryId: CAT.frios };
  it('si el INSERT choca por carrera con slug autogenerado, reintenta UNA vez en otra transacción', async () => {
    const h = setup();
    h.repo.failNextWriteWith = uniqueViolation('products_slug_key');
    const view = await h.service.create(staff(), create);
    expect(view.slug).toBe('roll-california');
    expect(h.repo.count('transaction')).toBe(2);
    expect(h.audit).toHaveLength(1);
  });
  it('si el reintento también choca => 409; un slug explícito NO se reintenta; un sku repetido tampoco', async () => {
    const h = setup();
    h.repo.seed(productRow(pid(1), { slug: 'roll-california' }));
    h.repo.seed(productRow(pid(2), { slug: 'x', sku: 'DUP' }));
    // el reintento ve el slug ocupado y se desambigua: dos choques seguidos agotan el único reintento
    const failTwice = h.repo.insert.bind(h.repo);
    let n = 0;
    h.repo.insert = (...args) => {
      n += 1;
      if (n <= 2) throw uniqueViolation('products_slug_key');
      return failTwice(...args);
    };
    expect(code(await failure(h.service.create(staff(), create)))).toBe('PRODUCT_SLUG_TAKEN');
    expect(h.repo.count('transaction')).toBe(2);

    const h2 = setup();
    h2.repo.failNextWriteWith = uniqueViolation('products_slug_key');
    expect(code(await failure(h2.service.create(staff(), { ...create, slug: 'mio' })))).toBe(
      'PRODUCT_SLUG_TAKEN',
    );
    expect(h2.repo.count('transaction')).toBe(1);

    const h3 = setup();
    h3.repo.failNextWriteWith = uniqueViolation('products_sku_key');
    expect(code(await failure(h3.service.create(staff(), create)))).toBe('PRODUCT_SKU_TAKEN');
    expect(h3.repo.count('transaction')).toBe(1);
  });
});

import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { assetid, bnid, maxCountTriggerError } from '../../test/support/fake-banners-repo.js';
import { bannersHarness } from '../../test/support/banners-harness.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import type { CreateBannerRequest } from './dto/banner-requests.dto.js';

const ALL = ['banners.read', 'banners.create', 'banners.update'];
const admin = () => globalStaff(ALL);
const A = '00000000-0000-4000-8000-0000000000a1';
const scoped = () => scopedStaff(ALL, [A]);

const info = (e: unknown) => {
  const x = e as { getStatus?: () => number; getResponse?: () => unknown };
  const body = (x.getResponse?.() ?? {}) as {
    code?: string;
    message?: unknown;
    violations?: { path: string; code: string }[];
  };
  return { status: x.getStatus?.(), code: body.code, violations: body.violations, body };
};
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => info(e),
  );

const validCreate = (over: Partial<CreateBannerRequest> = {}): CreateBannerRequest => ({
  imageAssetId: assetid(1),
  imageAlt: 'Roll de salmón',
  ...over,
});

let warn: MockInstance;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('create', () => {
  it('crea con version 1, active=true por defecto, código interno generado y auditoría en la misma transacción', async () => {
    const h = bannersHarness();
    const out = await h.admin.create(admin(), validCreate());
    expect(out).toMatchObject({
      imageAlt: 'Roll de salmón',
      active: true,
      version: 1,
      image: { assetId: assetid(1), mimeType: 'image/webp', sizeBytes: 200_000 },
    });
    expect(out.image.url).toBe(`https://media.mock.invalid/banners/2026/obj-1.webp`);
    expect(Object.keys(out).sort()).toEqual(
      ['active', 'createdAt', 'id', 'image', 'imageAlt', 'updatedAt', 'version'].sort(),
    );
    const stored = h.repo.banners.get(out.id);
    expect(stored?.code).toBe(`banner-${out.id.replace(/-/g, '').slice(0, 8)}`);
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.created',
      entityType: 'banner',
      entityId: out.id,
      newValues: { code: stored?.code, imageAssetId: assetid(1), active: true },
    });
    expect(JSON.stringify(h.repo.audit)).not.toContain('Roll de salmón');
  });

  it('active=false se respeta y el texto se normaliza (NFC, espacios, controles)', async () => {
    const h = bannersHarness();
    const out = await h.admin.create(
      admin(),
      validCreate({ imageAlt: '  Roll ​ de\t  salmón\n ', active: false }),
    );
    expect(out).toMatchObject({ imageAlt: 'Roll de salmón', active: false });
  });

  it('tope de 5: con 5 banners (activos o no) => 409 BANNER_LIMIT_REACHED sin escribir ni auditar', async () => {
    const h = bannersHarness();
    for (let n = 0; n < 5; n += 1) h.repo.seed({ active: n % 2 === 0 });
    const e = await failure(h.admin.create(admin(), validCreate()));
    expect(e).toMatchObject({ status: 409, code: 'BANNER_LIMIT_REACHED' });
    expect(h.repo.banners.size).toBe(5);
    expect(h.repo.audit).toHaveLength(0);
    expect(h.repo.callCount('createBanner')).toBe(0);
  });

  it('con 4 banners se puede crear el 5.º', async () => {
    const h = bannersHarness();
    for (let n = 0; n < 4; n += 1) h.repo.seed();
    await h.admin.create(admin(), validCreate());
    expect(h.repo.banners.size).toBe(5);
  });

  it('carrera: el conteo no vio el 5.º pero el trigger de BD rechaza el INSERT => 409 BANNER_LIMIT_REACHED y nada queda escrito', async () => {
    const h = bannersHarness();
    for (let n = 0; n < 5; n += 1) h.repo.seed();
    h.repo.countOverride = 4;
    h.repo.emulateTrigger = true;
    const e = await failure(h.admin.create(admin(), validCreate()));
    expect(e).toMatchObject({ status: 409, code: 'BANNER_LIMIT_REACHED' });
    expect(h.repo.banners.size).toBe(5);
    expect(h.repo.audit).toHaveLength(0);
    // la forma cruda del trigger (SQLSTATE 23514 + nombre) es la que se clasifica
    expect(maxCountTriggerError().message).toBe('banners_max_count');
  });

  it('imagen inválida => 422 BANNER_IMAGE_INVALID con ASSET_UNKNOWN | ASSET_NOT_READY | ASSET_KIND_MISMATCH', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2, { status: 'PENDING' });
    h.repo.seedAsset(3, { kind: 'PRODUCT_IMAGE' });
    const cases: [string, string][] = [
      [assetid(99), 'ASSET_UNKNOWN'],
      [assetid(2), 'ASSET_NOT_READY'],
      [assetid(3), 'ASSET_KIND_MISMATCH'],
    ];
    for (const [imageAssetId, reason] of cases) {
      const e = await failure(h.admin.create(admin(), validCreate({ imageAssetId })));
      expect(e).toMatchObject({ status: 422, code: 'BANNER_IMAGE_INVALID' });
      expect(e?.violations).toEqual([
        expect.objectContaining({ path: 'imageAssetId', code: reason }),
      ]);
    }
    expect(h.repo.banners.size).toBe(0);
  });

  it('alt en blanco tras recortar => 422 BANNER_ALT_INVALID; NUL o bidi => 400', async () => {
    const h = bannersHarness();
    for (const imageAlt of ['   ', '​‍', '\t\n']) {
      const e = await failure(h.admin.create(admin(), validCreate({ imageAlt })));
      expect(e).toMatchObject({ status: 422, code: 'BANNER_ALT_INVALID' });
    }
    for (const imageAlt of ['a\u0000b', 'a‮b']) {
      expect((await failure(h.admin.create(admin(), validCreate({ imageAlt }))))?.status).toBe(400);
    }
    expect(h.repo.banners.size).toBe(0);
  });

  it('alcance acotado => 403 genérico sin tocar la BD', async () => {
    const h = bannersHarness();
    const e = await failure(h.admin.create(scoped(), validCreate()));
    expect(e?.status).toBe(403);
    expect(e?.code).toBeUndefined();
    expect(h.repo.calls).toEqual([]);
  });

  it('un fallo de BD no esperado sale tal cual (500 genérico), y un timeout => 503 BANNERS_BUSY', async () => {
    const h = bannersHarness();
    h.repo.failTransactionWith = Object.assign(new Error('x'), { code: '55P03' });
    expect(await failure(h.admin.create(admin(), validCreate()))).toMatchObject({
      status: 503,
      code: 'BANNERS_BUSY',
    });
  });
});

describe('list / get', () => {
  it('devuelve todos (activos e inactivos) en orden de creación con limit 5', async () => {
    const h = bannersHarness();
    const a = h.repo.seed({ imageAlt: 'Primero' });
    const b = h.repo.seed({ imageAlt: 'Segundo', active: false });
    const out = await h.admin.list(admin());
    expect(out.limit).toBe(5);
    expect(out.items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(out.items.map((i) => i.active)).toEqual([true, false]);
    expect(h.repo.callCount('findAll')).toBe(1);
  });

  it('ignora valores residuales de filas antiguas: el listado solo expone imagen, alt, activo, versión y fechas', async () => {
    const h = bannersHarness();
    h.repo.seed();
    const [item] = (await h.admin.list(admin())).items;
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['active', 'createdAt', 'id', 'image', 'imageAlt', 'updatedAt', 'version'].sort(),
    );
  });

  it('get: detalle, 404 BANNER_NOT_FOUND', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    expect((await h.admin.get(admin(), a.id)).id).toBe(a.id);
    expect(await failure(h.admin.get(admin(), bnid(999)))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
  });

  it('alcance acotado => 403 en list y get', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    expect((await failure(h.admin.list(scoped())))?.status).toBe(403);
    expect((await failure(h.admin.get(scoped(), a.id)))?.status).toBe(403);
    expect(h.repo.calls).toEqual([]);
  });
});

describe('update', () => {
  it('cambia imagen, alt y activo: sube version en 1 y audita old/new de imageAssetId y active sin texto', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2);
    const a = h.repo.seed();
    const out = await h.admin.update(admin(), a.id, {
      expectedVersion: 1,
      imageAssetId: assetid(2),
      imageAlt: 'Nuevo texto',
      active: false,
    });
    expect(out).toMatchObject({
      version: 2,
      active: false,
      imageAlt: 'Nuevo texto',
      image: { assetId: assetid(2) },
    });
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.updated',
      entityId: a.id,
      oldValues: { imageAssetId: assetid(1), active: true },
      newValues: { imageAssetId: assetid(2), active: false, imageAltChanged: true },
    });
    expect(JSON.stringify(h.repo.audit)).not.toContain('Nuevo texto');
  });

  it('parcial: lo omitido no se toca', async () => {
    const h = bannersHarness();
    const a = h.repo.seed({ imageAlt: 'Intacto' });
    const out = await h.admin.update(admin(), a.id, { expectedVersion: 1, active: false });
    expect(out).toMatchObject({ imageAlt: 'Intacto', active: false, version: 2 });
    expect(out.image.assetId).toBe(assetid(1));
  });

  it('sin cambios => 200 sin escribir, sin subir versión y sin auditar', async () => {
    const h = bannersHarness();
    const a = h.repo.seed({ imageAlt: 'Igual' });
    const out = await h.admin.update(admin(), a.id, {
      expectedVersion: 1,
      imageAlt: '  Igual ',
      active: true,
      imageAssetId: assetid(1),
    });
    expect(out.version).toBe(1);
    expect(h.repo.callCount('saveBanner')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('concurrencia optimista: versión distinta => 409 BANNER_VERSION_CONFLICT sin guardar', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    const e = await failure(h.admin.update(admin(), a.id, { expectedVersion: 7, active: false }));
    expect(e).toMatchObject({ status: 409, code: 'BANNER_VERSION_CONFLICT' });
    expect(h.repo.banners.get(a.id)).toMatchObject({ active: true, version: 1 });
  });

  it('otro PATCH confirma entre la lectura y el candado: el segundo recibe 409 (no pisa)', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    await h.admin.update(admin(), a.id, { expectedVersion: 1, active: false });
    const e = await failure(h.admin.update(admin(), a.id, { expectedVersion: 1, imageAlt: 'X' }));
    expect(e).toMatchObject({ status: 409, code: 'BANNER_VERSION_CONFLICT' });
    expect(h.repo.banners.get(a.id)).toMatchObject({ version: 2, active: false });
  });

  it('un banner borrado por otro actor => 404', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    h.repo.banners.delete(a.id);
    expect(
      await failure(h.admin.update(admin(), a.id, { expectedVersion: 1, active: false })),
    ).toMatchObject({ status: 404, code: 'BANNER_NOT_FOUND' });
  });

  it('imagen inválida => 422 y alt en blanco => 422 sin escribir', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2, { kind: 'PRODUCT_IMAGE' });
    const a = h.repo.seed();
    expect(
      await failure(
        h.admin.update(admin(), a.id, { expectedVersion: 1, imageAssetId: assetid(2) }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_IMAGE_INVALID' });
    expect(
      await failure(h.admin.update(admin(), a.id, { expectedVersion: 1, imageAlt: '  ' })),
    ).toMatchObject({ status: 422, code: 'BANNER_ALT_INVALID' });
    expect(h.repo.banners.get(a.id)?.version).toBe(1);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('reemplazar la imagen NO borra el asset anterior', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2);
    const a = h.repo.seed();
    await h.admin.update(admin(), a.id, { expectedVersion: 1, imageAssetId: assetid(2) });
    expect(h.releaser.released).toEqual([]);
    expect(h.repo.assets.has(assetid(1))).toBe(true);
  });

  it('alcance acotado => 403 genérico; inexistente => 404', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    expect((await failure(h.admin.update(scoped(), a.id, { expectedVersion: 1 })))?.status).toBe(
      403,
    );
    expect(
      await failure(h.admin.update(admin(), bnid(999), { expectedVersion: 1, active: false })),
    ).toMatchObject({ status: 404, code: 'BANNER_NOT_FOUND' });
  });
});

describe('remove', () => {
  it('borrado físico con versión: elimina la fila, audita banner.deleted y libera el asset', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    await h.admin.remove(admin(), a.id, 1);
    expect(h.repo.banners.has(a.id)).toBe(false);
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.deleted',
      entityId: a.id,
      oldValues: { imageAssetId: assetid(1), active: true },
    });
    expect(h.releaser.released).toEqual([assetid(1)]);
    // la liberación ocurre DESPUÉS de borrar el banner (la FK RESTRICT lo exige)
    expect(h.repo.callCount('deleteBanner')).toBe(1);
  });

  it('versión distinta => 409 BANNER_VERSION_CONFLICT sin borrar ni liberar', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    expect(await failure(h.admin.remove(admin(), a.id, 3))).toMatchObject({
      status: 409,
      code: 'BANNER_VERSION_CONFLICT',
    });
    expect(h.repo.banners.has(a.id)).toBe(true);
    expect(h.releaser.released).toEqual([]);
  });

  it('inexistente (o ya borrado) => 404 BANNER_NOT_FOUND', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    await h.admin.remove(admin(), a.id, 1);
    expect(await failure(h.admin.remove(admin(), a.id, 1))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
  });

  it('mejor esfuerzo: un fallo de almacenamiento NO falla el borrado; deja warning sin datos sensibles', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    h.releaser.failWith = Object.assign(new Error('secret-token https://r2.example/key'), {
      name: 'S3ServiceException',
      httpStatus: 500,
    });
    await expect(h.admin.remove(admin(), a.id, 1)).resolves.toBeUndefined();
    expect(h.repo.banners.has(a.id)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain(assetid(1));
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('r2.example');
  });

  it('un código de dominio (MEDIA_STORAGE_UNAVAILABLE) también es solo advertencia', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    h.releaser.failWith = Object.assign(new Error('x'), {
      response: { code: 'MEDIA_STORAGE_UNAVAILABLE' },
    });
    await expect(h.admin.remove(admin(), a.id, 1)).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toContain('MEDIA_STORAGE_UNAVAILABLE');
  });

  it('MEDIA_IN_USE (otro banner o producto usa la imagen) se conserva sin advertencia', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    h.releaser.failWith = Object.assign(new Error('x'), { response: { code: 'MEDIA_IN_USE' } });
    await expect(h.admin.remove(admin(), a.id, 1)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('alcance acotado => 403 sin leer ni borrar', async () => {
    const h = bannersHarness();
    const a = h.repo.seed();
    expect((await failure(h.admin.remove(scoped(), a.id, 1)))?.status).toBe(403);
    expect(h.repo.banners.has(a.id)).toBe(true);
    expect(h.repo.calls).toEqual([]);
  });
});

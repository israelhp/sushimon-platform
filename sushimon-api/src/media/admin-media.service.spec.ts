import { MediaStorageError } from './media-storage-error.js';
import { Logger } from '@nestjs/common';
import {
  JPEG_HEAD,
  mediaHarness,
  pngBytes,
  sha256Hex,
  type AuditEvent,
} from '../../test/support/media-harness.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import {
  MEDIA_CACHE_CONTROL,
  PENDING_LIMIT_PER_STAFF,
  PURGE_BATCH,
  PURGE_GRACE_MS,
} from './media-policy.js';
import type { StaffContext } from '../identity/identity.types.js';
import type { MediaAssetRow } from './media.types.js';

const staff = (id = 'staff-1'): StaffContext => ({
  ...globalStaff(['catalog.read', 'catalog.update']),
  staffId: id,
});
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const actions = (audit: { record: { mock: { calls: unknown[][] } } }) =>
  audit.record.mock.calls.map((c) => (c[1] as AuditEvent).action);

let warn: { mock: { calls: unknown[][] } };
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

const png = pngBytes(3);
const intent = (bytes = png, mimeType = 'image/png') => ({
  kind: 'PRODUCT_IMAGE' as const,
  mimeType,
  sizeBytes: bytes.length,
  checksumSha256: sha256Hex(bytes),
});

/** Crea el intent y simula el PUT del navegador al almacenamiento. */
async function uploaded(
  h: ReturnType<typeof mediaHarness>,
  bytes = png,
  contentType = 'image/png',
) {
  const res = await h.service.createUpload(staff(), intent(bytes, contentType));
  const row = h.repo.assets.get(res.assetId);
  if (row) h.mock.simulateUpload(row.objectKey, bytes, contentType);
  return res;
}

describe('createUpload', () => {
  it('crea PENDING con clave inmutable, firma con checksum/Content-Type/Cache-Control y audita sin URL', async () => {
    const h = mediaHarness();
    const res = await h.service.createUpload(staff(), intent());
    expect(res.deduplicated).toBe(false);
    expect(res.storageMode).toBe('MOCK');
    expect(res.uploadUrl).toMatch(/^https:\/\/upload\.mock\.invalid\//);
    expect(res.headers).toMatchObject({
      'Content-Type': 'image/png',
      'Cache-Control': MEDIA_CACHE_CONTROL,
    });
    expect(res.headers?.['x-amz-checksum-sha256']).toBe(
      Buffer.from(sha256Hex(png), 'hex').toString('base64'),
    );
    const row = h.repo.assets.get(res.assetId);
    expect(row).toMatchObject({
      status: 'PENDING',
      mimeType: 'image/png',
      sizeBytes: png.length,
      createdByStaffId: 'staff-1',
      bucket: 'sushimon-media-mock',
    });
    expect(row?.objectKey).toMatch(/^products\/\d{4}\/[0-9a-f-]{36}\.png$/);
    // expira en TTL segundos
    expect(res.expiresAt && new Date(res.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      300_000,
    );
    expect(res.asset).toMatchObject({ status: 'PENDING', url: null, usageCount: 0 });
    // auditoría: solo ids/mime/tamaño; la URL firmada no aparece en ningún lado
    expect(h.repo.audit).toEqual([
      expect.objectContaining({
        action: 'media.upload_intent_created',
        entityId: res.assetId,
        actorId: 'staff-1',
        newValues: { assetId: res.assetId, mimeType: 'image/png', sizeBytes: png.length },
      }),
    ]);
    const stored = JSON.stringify([...h.repo.assets.values()]) + JSON.stringify(h.repo.audit);
    expect(stored).not.toContain(res.uploadUrl as string);
    expect(stored).not.toContain('upload.mock.invalid');
  });

  it('la extensión sale del MIME, no del cliente: jpeg => .jpg', async () => {
    const h = mediaHarness();
    const bytes = Uint8Array.from([...JPEG_HEAD, 1, 2, 3]);
    const res = await h.service.createUpload(staff(), intent(bytes, 'image/jpeg'));
    expect(h.repo.assets.get(res.assetId)?.objectKey).toMatch(/\.jpg$/);
  });

  it('scoped (sin alcance global) => 403 antes de tocar nada', async () => {
    const h = mediaHarness();
    const scoped = scopedStaff(['catalog.update'], ['b1']);
    const e = await failure(h.service.createUpload(scoped, intent()));
    expect(status(e)).toBe(403);
    expect(h.repo.calls).toEqual([]);
  });

  it('almacenamiento no disponible => 503 MEDIA_STORAGE_UNAVAILABLE antes de validar o tocar la BD', async () => {
    const { UnavailableMediaStorageAdapter } =
      await import('./unavailable-media-storage.adapter.js');
    const h = mediaHarness({
      storage: new UnavailableMediaStorageAdapter(),
      config: { mode: 'UNAVAILABLE', bucket: null, publicBaseUrl: null },
    });
    const e = await failure(h.service.createUpload(staff(), intent(png, 'image/gif')));
    expect(status(e)).toBe(503);
    expect(code(e)).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(h.repo.calls).toEqual([]);
  });

  it('MIME no permitido => 422 MEDIA_TYPE_NOT_ALLOWED; tamaño excedido => 422 MEDIA_TOO_LARGE; sin escribir', async () => {
    const h = mediaHarness({ config: { maxBytes: 100 } });
    expect(code(await failure(h.service.createUpload(staff(), intent(png, 'image/svg+xml'))))).toBe(
      'MEDIA_TYPE_NOT_ALLOWED',
    );
    const big = await failure(h.service.createUpload(staff(), { ...intent(), sizeBytes: 101 }));
    expect(status(big)).toBe(422);
    expect(code(big)).toBe('MEDIA_TOO_LARGE');
    expect(h.repo.count('insertPending')).toBe(0);
  });

  it('dedup: un asset READY con el mismo checksum => deduplicated sin uploadUrl/headers/expiresAt y sin fila nueva', async () => {
    const h = mediaHarness();
    const ready = h.repo.seed({ id: 'a-ready', checksumSha256: sha256Hex(png) });
    const res = await h.service.createUpload(staff(), intent());
    expect(res).toMatchObject({
      assetId: 'a-ready',
      deduplicated: true,
      uploadUrl: null,
      headers: null,
      expiresAt: null,
    });
    expect(res.asset.url).toBe(`https://media.mock.invalid/${ready.objectKey}`);
    expect(h.repo.count('insertPending')).toBe(0);
    expect(h.repo.audit).toEqual([]);
  });

  it('un PENDING con el mismo checksum no deduplica (solo cuentan los READY)', async () => {
    const h = mediaHarness();
    h.repo.seed({
      id: 'a-pend',
      status: 'PENDING',
      confirmedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      checksumSha256: sha256Hex(png),
    });
    expect((await h.service.createUpload(staff(), intent())).deduplicated).toBe(false);
  });

  it(`tope de ${PENDING_LIMIT_PER_STAFF} PENDING vigentes por empleado => 422 MEDIA_PENDING_LIMIT_REACHED`, async () => {
    const h = mediaHarness();
    for (let i = 0; i < PENDING_LIMIT_PER_STAFF; i++) {
      h.repo.seed({
        id: `p-${i}`,
        status: 'PENDING',
        confirmedAt: null,
        createdByStaffId: 'staff-1',
        expiresAt: new Date(Date.now() + 60_000),
        checksumSha256: String(i).padStart(64, 'c'),
      });
    }
    const e = await failure(h.service.createUpload(staff(), intent()));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MEDIA_PENDING_LIMIT_REACHED');
    // otro empleado no se ve afectado
    expect((await h.service.createUpload(staff('staff-2'), intent())).deduplicated).toBe(false);
  });

  it('los PENDING caducados no cuentan para el tope; la purga perezosa es acotada (20) y solo borra los de hace más de 5 min', async () => {
    const h = mediaHarness();
    const seedOld = (id: string, ageMs: number, checksum: string) => {
      h.repo.seed({
        id,
        objectKey: `products/2020/${id}.png`,
        status: 'PENDING',
        confirmedAt: null,
        createdByStaffId: 'staff-1',
        expiresAt: new Date(Date.now() - ageMs),
        checksumSha256: checksum,
      });
      h.mock.simulateUpload(`products/2020/${id}.png`, png, 'image/png');
    };
    for (let i = 0; i < PENDING_LIMIT_PER_STAFF; i++)
      seedOld(`old-${i}`, 10 * 60_000, String(i).padStart(64, 'd'));
    seedOld('recent', 60_000, 'e'.repeat(64)); // caducó hace 1 min: su PUT firmado podría seguir vigente
    await h.service.createUpload(staff(), intent());
    const olds = [...h.repo.assets.keys()].filter((k) => k.startsWith('old-'));
    expect(olds).toHaveLength(PENDING_LIMIT_PER_STAFF - PURGE_BATCH); // un lote de 20
    expect(h.repo.assets.has('recent')).toBe(true);
    expect(h.mock.objects.has('products/2020/recent.png')).toBe(true);
  });

  it('la purga perezosa corre DESPUÉS de crear el intent: un fallo del tope (422) no la ejecuta', async () => {
    const h = mediaHarness();
    for (let i = 0; i < PENDING_LIMIT_PER_STAFF; i++)
      h.repo.seed({
        id: `p-${i}`,
        status: 'PENDING',
        confirmedAt: null,
        createdByStaffId: 'staff-1',
        expiresAt: new Date(Date.now() + 60_000),
        checksumSha256: String(i).padStart(64, 'c'),
      });
    await failure(h.service.createUpload(staff(), intent()));
    expect(h.repo.count('findExpiredPending')).toBe(0);
    await h.service.createUpload(staff('otro'), intent());
    expect(h.repo.count('findExpiredPending')).toBe(1);
    const order = h.repo.calls.filter((c) => ['insertPending', 'findExpiredPending'].includes(c));
    expect(order).toEqual(['insertPending', 'findExpiredPending']);
  });

  it('serializa por empleado: lock -> count -> insert dentro de la misma transacción', async () => {
    const h = mediaHarness();
    await h.service.createUpload(staff(), intent());
    const seq = h.repo.calls.filter((c) =>
      ['transaction', 'lockStaffIntents', 'countPending', 'insertPending'].includes(c),
    );
    expect(seq).toEqual(['transaction', 'lockStaffIntents', 'countPending', 'insertPending']);
  });

  it('si firmar falla: 503 sin detalles, y no queda un PENDING sin URL', async () => {
    const h = mediaHarness();
    vi.spyOn(h.mock, 'presignPut').mockRejectedValue(
      new Error('clave secreta https://x?X-Amz-Signature=zzz'),
    );
    const e = await failure(h.service.createUpload(staff(), intent()));
    expect(code(e)).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(JSON.stringify((e as { response: unknown }).response)).not.toContain('Signature');
    expect([...h.repo.assets.values()].filter((a) => a.status === 'PENDING')).toHaveLength(0);
  });

  it('timeout de BD (P2028) => 503 MEDIA_BUSY', async () => {
    const h = mediaHarness();
    h.repo.failTransactionWith = Object.assign(new Error('x'), { code: 'P2028' });
    expect(code(await failure(h.service.createUpload(staff(), intent())))).toBe('MEDIA_BUSY');
  });
});

describe('complete', () => {
  it('confirma: HeadObject + firma real => READY con url pública, confirmedAt, sin expiresAt y auditoría', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    const out = await h.service.complete(staff(), assetId);
    expect(out).toMatchObject({ id: assetId, status: 'READY', expiresAt: null, usageCount: 0 });
    expect(out.url).toBe(`https://media.mock.invalid/${h.repo.assets.get(assetId)?.objectKey}`);
    expect(out.confirmedAt).not.toBeNull();
    expect(actions(h.audit)).toEqual(['media.upload_intent_created', 'media.confirmed']);
    expect(h.mock.objects.size).toBe(1);
  });

  it('idempotente: repetir sobre READY => 200 sin tocar el almacenamiento ni auditar de nuevo', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    await h.service.complete(staff(), assetId);
    const head = vi.spyOn(h.mock, 'headObject');
    const again = await h.service.complete(staff(), assetId);
    expect(again.status).toBe('READY');
    expect(head).not.toHaveBeenCalled();
    expect(actions(h.audit).filter((a) => a === 'media.confirmed')).toHaveLength(1);
  });

  it('READY es idempotente incluso sin almacenamiento disponible', async () => {
    const { UnavailableMediaStorageAdapter } =
      await import('./unavailable-media-storage.adapter.js');
    const h = mediaHarness({
      storage: new UnavailableMediaStorageAdapter(),
      config: { mode: 'UNAVAILABLE', bucket: null, publicBaseUrl: null },
    });
    h.repo.seed({ id: 'r1' });
    expect((await h.service.complete(staff(), 'r1')).status).toBe('READY');
  });

  it('asset inexistente => 404 MEDIA_NOT_FOUND', async () => {
    const e = await failure(mediaHarness().service.complete(staff(), 'nope'));
    expect(status(e)).toBe(404);
    expect(code(e)).toBe('MEDIA_NOT_FOUND');
  });

  it('PENDING caducado => 410 MEDIA_UPLOAD_EXPIRED (aunque el objeto exista)', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    h.repo.assets.set(assetId, {
      ...(h.repo.assets.get(assetId) as MediaAssetRow),
      expiresAt: new Date(Date.now() - 1000),
    });
    const e = await failure(h.service.complete(staff(), assetId));
    expect(status(e)).toBe(410);
    expect(code(e)).toBe('MEDIA_UPLOAD_EXPIRED');
  });

  it('objeto no subido => 422 MEDIA_OBJECT_MISSING y el asset sigue PENDING (reintentable)', async () => {
    const h = mediaHarness();
    const { assetId } = await h.service.createUpload(staff(), intent());
    const e = await failure(h.service.complete(staff(), assetId));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MEDIA_OBJECT_MISSING');
    expect(h.repo.assets.get(assetId)?.status).toBe('PENDING');
    const row = h.repo.assets.get(assetId);
    h.mock.simulateUpload(row?.objectKey as string, png, 'image/png');
    expect((await h.service.complete(staff(), assetId)).status).toBe('READY');
  });

  it('MIME falso (bytes de HTML declarados como image/png con checksum correcto) => objeto borrado y asset no confirmable, 422 MEDIA_CONTENT_MISMATCH', async () => {
    const h = mediaHarness();
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
    const { assetId } = await uploaded(h, html, 'image/png');
    const key = h.repo.assets.get(assetId)?.objectKey as string;
    const e = await failure(h.service.complete(staff(), assetId));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MEDIA_CONTENT_MISMATCH');
    expect(h.mock.objects.has(key)).toBe(false);
    // la fila PENDING se conserva, ya caducada: la purga (tras el margen) volverá a borrar el objeto si el PUT lo recrea
    expect(h.repo.assets.get(assetId)).toMatchObject({ status: 'PENDING' });
    expect(h.repo.assets.get(assetId)?.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(code(await failure(h.service.complete(staff(), assetId)))).toBe('MEDIA_UPLOAD_EXPIRED');
    h.mock.simulateUpload(key, html, 'image/png'); // re-PUT con la URL firmada aún vigente
    expect(await h.cleanup.purgeExpired(20, new Date(Date.now() + PURGE_GRACE_MS + 1000))).toBe(1);
    expect(h.mock.objects.has(key)).toBe(false);
    expect(h.repo.assets.has(assetId)).toBe(false);
    const rejected = h.repo.audit.find((a) => a['action'] === 'media.rejected');
    expect(rejected).toMatchObject({ newValues: { assetId, reason: 'signature' } });
  });

  it.each([
    ['tamaño distinto', 'size'],
    ['Content-Type distinto', 'type'],
    ['checksum distinto', 'checksum'],
  ])(
    '%s => borra el objeto, asset no confirmable, 422 y auditoría con motivo %s',
    async (_name, reason) => {
      const h = mediaHarness();
      const { assetId } = await h.service.createUpload(staff(), intent());
      const key = h.repo.assets.get(assetId)?.objectKey as string;
      if (reason === 'size') h.mock.simulateUpload(key, pngBytes(3, 80), 'image/png');
      else if (reason === 'type') h.mock.simulateUpload(key, png, 'image/jpeg');
      else h.mock.simulateUpload(key, pngBytes(9, png.length), 'image/png'); // mismo tamaño, otros bytes
      const e = await failure(h.service.complete(staff(), assetId));
      expect(code(e)).toBe('MEDIA_CONTENT_MISMATCH');
      expect(h.repo.assets.get(assetId)?.status).toBe('PENDING');
      expect(h.mock.objects.has(key)).toBe(false);
      expect(h.repo.audit.find((a) => a['action'] === 'media.rejected')).toMatchObject({
        newValues: { reason },
      });
    },
  );

  it('sin checksum informado por el proveedor => falla cerrado (MEDIA_CONTENT_MISMATCH)', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    vi.spyOn(h.mock, 'headObject').mockResolvedValue({
      sizeBytes: png.length,
      contentType: 'image/png',
      checksumSha256Base64: null,
    });
    expect(code(await failure(h.service.complete(staff(), assetId)))).toBe(
      'MEDIA_CONTENT_MISMATCH',
    );
  });

  it('Content-Type con parámetros (image/png; charset) cuenta como image/png', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    const real = (await h.mock.headObject(h.repo.assets.get(assetId)?.objectKey as string))!;
    vi.spyOn(h.mock, 'headObject').mockResolvedValue({ ...real, contentType: 'IMAGE/PNG; x=y' });
    expect((await h.service.complete(staff(), assetId)).status).toBe('READY');
  });

  it('carrera por checksum (23505): borra el duplicado propio y responde 200 con el asset ganador', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    const key = h.repo.assets.get(assetId)?.objectKey as string;
    // Otro complete ganó entre la lectura y el UPDATE: aparece un READY con el mismo checksum y el UPDATE choca.
    h.repo.failNextMarkReadyWith = Object.assign(new Error('dup'), {
      code: 'P2002',
      meta: { target: ['media_assets_ready_checksum_key'] },
    });
    const winner = h.repo.seed({ id: 'winner', checksumSha256: sha256Hex(png) });
    const out = await h.service.complete(staff(), assetId);
    expect(out.id).toBe(winner.id);
    expect(out.status).toBe('READY');
    expect(h.repo.assets.has(assetId)).toBe(false);
    expect(h.mock.objects.has(key)).toBe(false);
  });

  it('carrera real: el UNIQUE parcial del doble también reutiliza al ganador', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    h.repo.seed({ id: 'winner', checksumSha256: sha256Hex(png) });
    const out = await h.service.complete(staff(), assetId);
    expect(out.id).toBe('winner');
  });

  it('error del proveedor en HeadObject => 503 MEDIA_STORAGE_UNAVAILABLE sin fugas y el asset sigue PENDING', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    vi.spyOn(h.mock, 'headObject').mockRejectedValue(
      new MediaStorageError('headObject', 'AccessDenied', 403),
    );
    const e = await failure(h.service.complete(staff(), assetId));
    expect(status(e)).toBe(503);
    expect(code(e)).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(JSON.stringify((e as { response: unknown }).response)).not.toMatch(/AccessDenied|403/);
    expect(h.repo.assets.get(assetId)?.status).toBe('PENDING');
    // el aviso solo lleva nombre/código/estado, nunca mensajes del proveedor
    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /headObject \(MediaStorageError code=AccessDenied http=403\)/,
    );
  });

  it('scoped => 403', async () => {
    const h = mediaHarness();
    const e = await failure(h.service.complete(scopedStaff(['catalog.update'], ['b1']), 'x'));
    expect(status(e)).toBe(403);
    expect(h.repo.calls).toEqual([]);
  });
});

describe('remove', () => {
  it('elimina fila (auditada) y luego el objeto', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    await h.service.complete(staff(), assetId);
    await h.service.remove(staff(), assetId);
    expect(h.repo.assets.has(assetId)).toBe(false);
    expect(h.mock.objects.size).toBe(0);
    expect(actions(h.audit)).toContain('media.deleted');
  });

  it('en uso => 409 MEDIA_IN_USE sin borrar nada', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'used' });
    h.repo.usageOf = () => [{ productId: 'p', productName: 'P', productMediaId: 'm' }];
    h.mock.simulateUpload(h.repo.assets.get('used')?.objectKey as string, png, 'image/png');
    const e = await failure(h.service.remove(staff(), 'used'));
    expect(status(e)).toBe(409);
    expect(code(e)).toBe('MEDIA_IN_USE');
    expect(h.repo.assets.has('used')).toBe(true);
    expect(h.mock.objects.size).toBe(1);
  });

  it('carrera con un adjuntar (la FK RESTRICT dispara 23503) => 409 MEDIA_IN_USE', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'raced' });
    // La lectura no ve usos, pero al borrar ya hay uno confirmado.
    let reads = 0;
    h.repo.usageOf = () =>
      reads++ < 1 ? [] : [{ productId: 'p', productName: 'P', productMediaId: 'm' }];
    expect(code(await failure(h.service.remove(staff(), 'raced')))).toBe('MEDIA_IN_USE');
    expect(h.repo.assets.has('raced')).toBe(true);
  });

  it('si el borrado del objeto falla: 204 (sin error), la fila ya no existe y hay un aviso con la clave y sin secretos', async () => {
    const h = mediaHarness();
    const row = h.repo.seed({ id: 'x1', objectKey: 'products/2026/x1.png' });
    vi.spyOn(h.mock, 'deleteObject').mockRejectedValue(
      new MediaStorageError('deleteObject', 'InternalError', 500),
    );
    await expect(h.service.remove(staff(), 'x1')).resolves.toBeUndefined();
    expect(h.repo.assets.has('x1')).toBe(false);
    const text = warn.mock.calls.flat().join(' ');
    expect(text).toContain(row.objectKey);
    expect(text).toContain('InternalError');
  });

  it('inexistente / repetido => 404 MEDIA_NOT_FOUND', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'once' });
    await h.service.remove(staff(), 'once');
    const e = await failure(h.service.remove(staff(), 'once'));
    expect(status(e)).toBe(404);
    expect(code(e)).toBe('MEDIA_NOT_FOUND');
  });

  it('sin almacenamiento => 503 sin tocar la fila', async () => {
    const { UnavailableMediaStorageAdapter } =
      await import('./unavailable-media-storage.adapter.js');
    const h = mediaHarness({
      storage: new UnavailableMediaStorageAdapter(),
      config: { mode: 'UNAVAILABLE', bucket: null, publicBaseUrl: null },
    });
    h.repo.seed({ id: 'keep' });
    const e = await failure(h.service.remove(staff(), 'keep'));
    expect(code(e)).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(h.repo.assets.has('keep')).toBe(true);
    expect(h.repo.calls).toEqual([]);
  });

  it('scoped => 403', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'a' });
    expect(
      status(await failure(h.service.remove(scopedStaff(['catalog.update'], ['b']), 'a'))),
    ).toBe(403);
  });
});

describe('MediaCleanupService.purgeExpired', () => {
  const old = (h: ReturnType<typeof mediaHarness>, id: string, ageMs: number) =>
    h.repo.seed({
      id,
      objectKey: `products/2020/${id}.png`,
      status: 'PENDING',
      confirmedAt: null,
      expiresAt: new Date(Date.now() - ageMs),
      checksumSha256: id.padStart(64, '0'),
    });

  it('borra objeto y fila de los caducados hace más de 5 min; deja vigentes, recién caducados y READY; acota por lote', async () => {
    const h = mediaHarness();
    for (let i = 0; i < 5; i++) old(h, `e${i}`, 10 * 60_000 + 1000 * (i + 1));
    old(h, 'fresh', 60_000); // caducó hace 1 min: dentro del margen
    h.repo.seed({
      id: 'live',
      status: 'PENDING',
      confirmedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    h.repo.seed({ id: 'ready' });
    expect(await h.cleanup.purgeExpired(3)).toBe(3);
    expect(await h.cleanup.purgeExpired()).toBe(2);
    expect([...h.repo.assets.keys()].sort()).toEqual(['fresh', 'live', 'ready']);
    expect(await h.cleanup.purgeExpired()).toBe(0);
  });

  it('el lote por petición nunca pasa de 20 aunque se pida más', async () => {
    const h = mediaHarness();
    for (let i = 0; i < 30; i++) old(h, `b${i}`, 10 * 60_000 + i);
    expect(await h.cleanup.purgeExpired(500)).toBe(PURGE_BATCH);
  });

  it('respeta el presupuesto de tiempo: con 0 ms procesa solo el primer bloque y deja el resto', async () => {
    const h = mediaHarness();
    for (let i = 0; i < 20; i++) old(h, `t${i}`, 10 * 60_000 + i);
    expect(await h.cleanup.purgeExpired(20, new Date(), 0)).toBe(10);
    expect(h.repo.assets.size).toBe(10);
  });

  it('si el objeto no se puede borrar: aviso con la clave y la fila se elimina igualmente', async () => {
    const h = mediaHarness();
    old(h, 'x', 10 * 60_000);
    vi.spyOn(h.mock, 'deleteObject').mockRejectedValue(
      new MediaStorageError('deleteObject', 'Boom', 500),
    );
    expect(await h.cleanup.purgeExpired()).toBe(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('products/2020/x.png');
  });
});

describe('carrera complete / purga', () => {
  it('si el intent caduca entre la lectura y el UPDATE, markReady no actualiza y responde 410 sin auditar confirmed', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    const real = h.mock.readRange.bind(h.mock);
    // entre la verificación del objeto y el UPDATE el intent vence
    vi.spyOn(h.mock, 'readRange').mockImplementation(async (key, n) => {
      const row = h.repo.assets.get(assetId) as MediaAssetRow;
      h.repo.assets.set(assetId, { ...row, expiresAt: new Date(Date.now() - 1) });
      return real(key, n);
    });
    const e = await failure(h.service.complete(staff(), assetId));
    expect(status(e)).toBe(410);
    expect(code(e)).toBe('MEDIA_UPLOAD_EXPIRED');
    expect(h.repo.assets.get(assetId)?.status).toBe('PENDING');
    expect(h.repo.audit.some((a) => a['action'] === 'media.confirmed')).toBe(false);
  });

  it('doble complete concurrente: ambos 200 (idempotente) y una sola auditoría media.confirmed', async () => {
    const h = mediaHarness();
    const { assetId } = await uploaded(h);
    const [a, b] = await Promise.all([
      h.service.complete(staff(), assetId),
      h.service.complete(staff(), assetId),
    ]);
    expect(a.status).toBe('READY');
    expect(b.status).toBe('READY');
    expect(a.id).toBe(b.id);
    expect(h.repo.audit.filter((x) => x['action'] === 'media.confirmed')).toHaveLength(1);
  });
});

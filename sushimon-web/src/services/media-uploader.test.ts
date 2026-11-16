import { beforeEach, describe, expect, it } from 'vitest';
import { hexToBase64, sha256HexOfBlob } from '@/lib/media-optimize';
import { clearSimulatedObjects, displayMediaSrc } from '@/lib/media-simulated';
import { createHarness } from '@/mocks/testing';
import * as media from './media';
import {
  createMediaUploader,
  createMockMediaUploader,
  createXhrMediaUploader,
} from './media-uploader';

/** Doble mínimo de XMLHttpRequest: registra todo lo que el uploader hace. */
class FakeXhr {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = true;
  sent: unknown = undefined;
  status = 0;
  aborted = false;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  finish(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const signed = {
  'Content-Type': 'image/webp',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'x-amz-checksum-sha256': 'abc=',
};
const upload = (
  xhr: FakeXhr,
  o: Parameters<ReturnType<typeof createXhrMediaUploader>['upload']>[1] = {},
) =>
  createXhrMediaUploader(() => xhr as unknown as XMLHttpRequest).upload(
    {
      assetId: 'a1',
      uploadUrl: 'https://almacen.example.test/products/2026/a1.webp?firma=1',
      headers: signed,
      body: new Blob(['x']),
    },
    o,
  );

describe('F14 · MediaUploader http (XMLHttpRequest)', () => {
  it('PUT con los headers EXACTOS firmados, sin credenciales ni cabeceras añadidas', async () => {
    const xhr = new FakeXhr();
    const done = upload(xhr);
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://almacen.example.test/products/2026/a1.webp?firma=1');
    expect(xhr.headers).toEqual(signed);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.sent).toBeInstanceOf(Blob);
    xhr.finish(200);
    await expect(done).resolves.toBeUndefined();
  });

  it('no fija Content-Length ni cabeceras prohibidas del navegador (las calcula él del Blob firmado)', async () => {
    const xhr = new FakeXhr();
    const done = createXhrMediaUploader(() => xhr as unknown as XMLHttpRequest).upload({
      assetId: 'a1',
      uploadUrl: 'https://almacen.example.test/products/2026/a1.webp?firma=1',
      headers: { ...signed, 'Content-Length': '1', Host: 'almacen.example.test' },
      body: new Blob(['x']),
    });
    expect(xhr.headers).toEqual(signed);
    expect(Object.keys(xhr.headers).map((n) => n.toLowerCase())).not.toContain('content-length');
    xhr.finish(200);
    await expect(done).resolves.toBeUndefined();
  });

  it('progreso 0..1 (solo si es computable) y 1 al terminar', async () => {
    const xhr = new FakeXhr();
    const seen: number[] = [];
    const done = upload(xhr, { onProgress: (f) => seen.push(f) });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.finish(200);
    await done;
    expect(seen).toEqual([0.25, 1, 1]);
  });

  it('estado no 2xx => uploadRejected con el estado; error de red => network', async () => {
    const a = new FakeXhr();
    const rejected = upload(a);
    a.finish(403);
    await expect(rejected).rejects.toMatchObject({ kind: 'uploadRejected', status: 403 });
    const b = new FakeXhr();
    const network = upload(b);
    b.onerror?.();
    await expect(network).rejects.toMatchObject({ kind: 'network' });
    const c = new FakeXhr();
    const timeout = upload(c);
    c.ontimeout?.();
    await expect(timeout).rejects.toMatchObject({ kind: 'network' });
  });

  it('cancelable con AbortSignal => aborted (y el XHR se aborta); ya abortado ni envía', async () => {
    const xhr = new FakeXhr();
    const ctrl = new AbortController();
    const pending = upload(xhr, { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(xhr.aborted).toBe(true);
    const never = new FakeXhr();
    const already = new AbortController();
    already.abort();
    await expect(upload(never, { signal: already.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(never.sent).toBeUndefined();
  });

  it('solo https: otra URL se rechaza sin enviar nada', async () => {
    for (const uploadUrl of ['http://almacen.example.test/x', 'no es url', 'javascript:alert(1)']) {
      const xhr = new FakeXhr();
      await expect(
        createXhrMediaUploader(() => xhr as unknown as XMLHttpRequest).upload({
          assetId: 'a',
          uploadUrl,
          headers: signed,
          body: new Blob(['x']),
        }),
      ).rejects.toMatchObject({ kind: 'invalid' });
      expect(xhr.sent).toBeUndefined();
    }
  });
});

describe('F14 · MediaUploader mock (almacén simulado, sin red)', () => {
  beforeEach(() => clearSimulatedObjects());

  it('createMediaUploader elige por tipo de cliente', () => {
    const h = createHarness();
    expect(createMediaUploader(h.client).kind).toBe('mock');
  });

  it('«sube» al almacén simulado y complete confirma; la URL pública usa el blob local', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const body = new Blob(['contenido-de-prueba'], { type: 'image/webp' });
    const checksum = await sha256HexOfBlob(body);
    const intent = await media.createMediaUploadIntent(h.client, {
      kind: 'PRODUCT_IMAGE',
      mimeType: 'image/webp',
      sizeBytes: body.size,
      checksumSha256: checksum,
    });
    const seen: number[] = [];
    await createMockMediaUploader(h.client).upload(
      {
        assetId: intent.assetId,
        uploadUrl: intent.uploadUrl as string,
        headers: intent.headers as Record<string, string>,
        body,
      },
      { onProgress: (f) => seen.push(f) },
    );
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(h.store.mediaObjects[intent.assetId]).toEqual({
      sizeBytes: body.size,
      contentType: 'image/webp',
      checksumSha256: checksum,
    });
    const asset = await media.completeMediaUpload(h.client, intent.assetId);
    expect(asset.status).toBe('READY');
    // Sin URL.createObjectURL (node) la vista local no existe, pero NUNCA se devuelve el host .invalid.
    expect(displayMediaSrc(asset.url)).not.toBe(asset.url);
  });

  it('checksum firmado distinto del cuerpo => uploadRejected (como R2) y no registra el objeto', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const body = new Blob(['otro-contenido']);
    const intent = await media.createMediaUploadIntent(h.client, {
      kind: 'PRODUCT_IMAGE',
      mimeType: 'image/webp',
      sizeBytes: body.size,
      checksumSha256: 'b'.repeat(64),
    });
    await expect(
      createMockMediaUploader(h.client).upload({
        assetId: intent.assetId,
        uploadUrl: intent.uploadUrl as string,
        headers: { ...(intent.headers as Record<string, string>) },
        body,
      }),
    ).rejects.toMatchObject({ kind: 'uploadRejected', status: 400 });
    expect(h.store.mediaObjects[intent.assetId]).toBeUndefined();
    // Cabecera ausente también se rechaza.
    const checksum = await sha256HexOfBlob(body);
    await expect(
      createMockMediaUploader(h.client).upload({
        assetId: intent.assetId,
        uploadUrl: intent.uploadUrl as string,
        headers: {
          'Content-Type': 'image/webp',
          'x-amz-checksum-sha256': hexToBase64(checksum).slice(1),
        },
        body,
      }),
    ).rejects.toMatchObject({ kind: 'uploadRejected' });
  });

  it('cancelable', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      createMockMediaUploader(h.client).upload(
        { assetId: 'x', uploadUrl: 'https://a.invalid/x', headers: {}, body: new Blob(['x']) },
        { signal: ctrl.signal },
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

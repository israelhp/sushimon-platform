import { MediaUrlService } from './media-url.service.js';
import type { MediaConfig } from './media-config.js';

const cfg = (publicBaseUrl: string | null): MediaConfig => ({
  mode: publicBaseUrl ? 'R2' : 'UNAVAILABLE',
  maxBytes: 5_242_880,
  uploadTtlSeconds: 300,
  bucket: publicBaseUrl ? 'b' : null,
  publicBaseUrl,
});

describe('MediaUrlService', () => {
  const urls = new MediaUrlService(cfg('https://cdn.ejemplo.com'));

  it('publicUrl = base + "/" + clave (estable; nunca firmada)', () => {
    expect(urls.publicUrl('products/2026/x.png')).toBe(
      'https://cdn.ejemplo.com/products/2026/x.png',
    );
    expect(urls.publicUrl('products/2026/x.png')).not.toMatch(/X-Amz|[?]/);
  });

  it('sin base: publicUrl lanza 503 MEDIA_STORAGE_UNAVAILABLE y tryPublicUrl devuelve null', () => {
    const none = new MediaUrlService(cfg(null));
    expect(none.configured).toBe(false);
    expect(none.tryPublicUrl('k')).toBeNull();
    try {
      none.publicUrl('k');
      expect.unreachable();
    } catch (e) {
      expect((e as { response: { code: string } }).response.code).toBe('MEDIA_STORAGE_UNAVAILABLE');
    }
  });

  it('classify: URL de otro host = externa; bajo el host de medios = clave; con query/otra ruta = clave null', () => {
    expect(urls.classify('https://otro.com/a.png')).toEqual({ kind: 'external' });
    expect(urls.classify('https://cdn.ejemplo.com/products/2026/x.png')).toEqual({
      kind: 'media',
      objectKey: 'products/2026/x.png',
    });
    expect(urls.classify('https://cdn.ejemplo.com/products/2026/x.png?v=1')).toEqual({
      kind: 'media',
      objectKey: 'products/2026/x.png?v=1', // no es una clave válida: no coincidirá con ningún asset
    });
    expect(urls.classify('https://cdn.ejemplo.com')).toEqual({ kind: 'media', objectKey: null });
    expect(new MediaUrlService(cfg(null)).classify('https://cdn.ejemplo.com/x.png')).toEqual({
      kind: 'external',
    });
  });

  it('con una base con ruta, solo las URL bajo esa ruta dan clave', () => {
    const withPath = new MediaUrlService(cfg('https://cdn.ejemplo.com/media'));
    expect(withPath.publicUrl('a.png')).toBe('https://cdn.ejemplo.com/media/a.png');
    expect(withPath.classify('https://cdn.ejemplo.com/media/a.png')).toEqual({
      kind: 'media',
      objectKey: 'a.png',
    });
    expect(withPath.classify('https://cdn.ejemplo.com/otra/a.png')).toEqual({
      kind: 'media',
      objectKey: null,
    });
  });

  it('effectiveAllowedHosts: vacía no cambia; no vacía añade el host una sola vez', () => {
    expect(urls.effectiveAllowedHosts([])).toEqual([]);
    expect(urls.effectiveAllowedHosts(['a.com'])).toEqual(['a.com', 'cdn.ejemplo.com']);
    expect(urls.effectiveAllowedHosts(['cdn.ejemplo.com'])).toEqual(['cdn.ejemplo.com']);
    expect(new MediaUrlService(cfg(null)).effectiveAllowedHosts(['a.com'])).toEqual(['a.com']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSimulatedObjects,
  displayMediaSrc,
  registerSimulatedObject,
  simulatedPublicUrl,
} from './media-simulated';

afterEach(() => {
  clearSimulatedObjects();
  vi.unstubAllGlobals();
});

describe('F14 · URLs y bytes simulados', () => {
  it('la URL pública simulada usa el host reservado .invalid', () => {
    const url = simulatedPublicUrl('media-asset-4', 'webp', 2026);
    expect(url).toBe('https://media-simulado.invalid/products/2026/media-asset-4.webp');
  });

  it('https normal se devuelve tal cual; otros esquemas, null', () => {
    expect(displayMediaSrc('https://cdn.example.test/a.webp')).toBe(
      'https://cdn.example.test/a.webp',
    );
    expect(displayMediaSrc('http://cdn.example.test/a.webp')).toBeNull();
    expect(displayMediaSrc('javascript:alert(1)')).toBeNull();
    expect(displayMediaSrc(null)).toBeNull();
    expect(displayMediaSrc('')).toBeNull();
  });

  it('URL simulada sin bytes => null (no se pide por red); con bytes => blob: local, estable y liberable', () => {
    const url = simulatedPublicUrl('media-asset-9', 'webp', 2026);
    expect(displayMediaSrc(url)).toBeNull();
    const create = vi.fn(() => 'blob:local-1');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    registerSimulatedObject('media-asset-9', new Blob(['x']));
    expect(displayMediaSrc(url)).toBe('blob:local-1');
    expect(displayMediaSrc(url)).toBe('blob:local-1');
    expect(create).toHaveBeenCalledTimes(1);
    clearSimulatedObjects();
    expect(revoke).toHaveBeenCalledWith('blob:local-1');
    expect(displayMediaSrc(url)).toBeNull();
  });
});

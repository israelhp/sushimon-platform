import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { MediaClientError } from '@/lib/media-optimize';
import {
  displayFileName,
  isActive,
  isAuthKind,
  mediaErrorKind,
  progressPercent,
  queuedSlots,
  type QueueItem,
} from './media-view';

const api = (status: number, code?: string) =>
  new ApiError(status, 'x', 'mensaje cualquiera', undefined, undefined, code);

describe('F14 · errores de medios por code (nunca por message)', () => {
  it.each([
    ['MEDIA_TYPE_NOT_ALLOWED', 422, 'typeNotAllowed'],
    ['MEDIA_TOO_LARGE', 422, 'tooLarge'],
    ['MEDIA_CONTENT_MISMATCH', 422, 'contentMismatch'],
    ['MEDIA_OBJECT_MISSING', 422, 'objectMissing'],
    ['MEDIA_UPLOAD_EXPIRED', 410, 'uploadExpired'],
    ['MEDIA_PENDING_LIMIT_REACHED', 422, 'pendingLimit'],
    ['MEDIA_ALREADY_ATTACHED', 409, 'alreadyAttached'],
    ['MEDIA_IN_USE', 409, 'inUse'],
    ['PRODUCT_MEDIA_INVALID', 422, 'productMediaInvalid'],
    ['MEDIA_ASSET_NOT_READY', 422, 'assetNotReady'],
    ['MEDIA_REORDER_MISMATCH', 422, 'reorderMismatch'],
    ['MEDIA_NOT_FOUND', 404, 'notFound'],
    ['PRODUCT_MEDIA_NOT_FOUND', 404, 'notFound'],
    ['PRODUCT_NOT_FOUND', 404, 'productNotFound'],
    ['MEDIA_BUSY', 503, 'busy'],
    ['PRODUCTS_BUSY', 503, 'busy'],
    ['MEDIA_STORAGE_UNAVAILABLE', 503, 'storageUnavailable'],
  ] as const)('%s', (code, status, kind) => {
    expect(mediaErrorKind(api(status, code))).toBe(kind);
  });

  it('sin code decide el estado HTTP; errores del cliente conservan su clase', () => {
    expect(mediaErrorKind(api(0))).toBe('network');
    expect(mediaErrorKind(api(401))).toBe('unauthorized');
    expect(mediaErrorKind(api(403))).toBe('forbidden');
    expect(mediaErrorKind(api(400))).toBe('invalid');
    expect(mediaErrorKind(api(409))).toBe('other');
    expect(mediaErrorKind(new Error('x'))).toBe('other');
    expect(mediaErrorKind(new MediaClientError('tooLarge', 'x'))).toBe('tooLarge');
    expect(isAuthKind('forbidden')).toBe(true);
    expect(isAuthKind('busy')).toBe(false);
  });
});

describe('F14 · cola', () => {
  const item = (status: QueueItem['status']): QueueItem => ({
    id: status,
    name: 'a.png',
    previewUrl: null,
    status,
    progress: 0,
  });

  it('queuedSlots cuenta todo menos los fallidos; isActive excluye done y error', () => {
    expect(queuedSlots([item('queued'), item('uploading'), item('done'), item('error')])).toBe(3);
    expect(isActive('uploading')).toBe(true);
    expect(isActive('done')).toBe(false);
    expect(isActive('error')).toBe(false);
  });

  it('nombre sin controles y recortado; porcentaje acotado', () => {
    expect(displayFileName('a\u0000b\nc.png')).toBe('abc.png');
    expect(displayFileName('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(displayFileName('   ')).toBe('—');
    expect(progressPercent(0.456)).toBe(46);
    expect(progressPercent(2)).toBe(100);
    expect(progressPercent(-1)).toBe(0);
  });
});

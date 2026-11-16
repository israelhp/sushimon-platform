import { isApiError } from '@/lib/data-access/errors';
import { isMediaClientError } from '@/lib/media-optimize';
import { mediaErrorKindForCode, type MediaErrorKind } from '@/lib/media-rules';

/**
 * F14 — Lógica pura de la UI de medios (sin React ni red). Los errores se ramifican por `businessCode` (nunca por `message`):
 * cada clase tiene su texto en `backoffice.media.error.<kind>`.
 */

/** Clase de mensaje de un error del servidor o del cliente (optimización, PUT directo). */
export function mediaErrorKind(error: unknown): MediaErrorKind {
  if (isMediaClientError(error)) return error.kind;
  if (isApiError(error)) {
    const byCode = mediaErrorKindForCode(error.businessCode);
    if (byCode) return byCode;
    if (error.status === 0) return 'network';
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return 'forbidden';
    if (error.status === 400) return 'invalid';
  }
  return 'other';
}

/** ¿La clase exige permisos/sesión (no se puede resolver reintentando)? */
export const isAuthKind = (kind: MediaErrorKind): boolean =>
  kind === 'forbidden' || kind === 'unauthorized';

// ── Cola de subida ─────────────────────────────────────────────────────────────────────────

export type QueueStatus =
  'queued' | 'optimizing' | 'uploading' | 'confirming' | 'attaching' | 'done' | 'error';

export interface QueueItem {
  id: string;
  /** Nombre del archivo (texto plano; solo se muestra, nunca se envía). */
  name: string;
  previewUrl: string | null;
  status: QueueStatus;
  /** 0..1 (solo `uploading`). */
  progress: number;
  error?: MediaErrorKind;
}

/** Elementos que ocupan un lugar del producto: todo lo que no falló. */
export const queuedSlots = (items: readonly QueueItem[]): number =>
  items.filter((i) => i.status !== 'error').length;

export const isActive = (status: QueueStatus): boolean =>
  status === 'queued' ||
  status === 'optimizing' ||
  status === 'uploading' ||
  status === 'confirming' ||
  status === 'attaching';

/** Nombre corto y sin controles para mostrar. */
export function displayFileName(name: string, max = 60): string {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim() || '—';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export const progressPercent = (fraction: number): number =>
  Math.round(Math.min(1, Math.max(0, fraction)) * 100);

import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException } from '../common/errors/coded-exception.js';
import { assertCleanText } from '../promotions/promotion-policy.js';
import { MAX_BANNERS, type BannerState } from './banners.types.js';

/** Reglas puras de banners simplificados (spec F16 «Simplificación (0023)», ADR-0033): sin I/O ni reloj. */

export const IMAGE_ALT_MAX = 120;

export const PERMISSION_READ = 'banners.read';
export const PERMISSION_CREATE = 'banners.create';
export const PERMISSION_UPDATE = 'banners.update';

// ---------- errores ----------

export const bannerNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BANNER_NOT_FOUND', 'Banner no encontrado');
/** 403 genérico: los banners no tienen sucursal, así que se exige alcance GLOBAL del permiso. */
export const scopeForbidden = () => new ForbiddenException('Acceso denegado');
export const versionConflict = () =>
  codedException(
    HttpStatus.CONFLICT,
    'BANNER_VERSION_CONFLICT',
    'El banner cambió desde que se leyó; recarga e inténtalo de nuevo',
  );
export const limitReached = () =>
  codedException(
    HttpStatus.CONFLICT,
    'BANNER_LIMIT_REACHED',
    `Ya existen ${MAX_BANNERS} banners; elimina uno antes de crear otro`,
  );
export const busy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'BANNERS_BUSY',
    'Los banners se están modificando; reintenta en unos segundos',
  );

export const imageInvalid = (reason: 'ASSET_UNKNOWN' | 'ASSET_NOT_READY' | 'ASSET_KIND_MISMATCH') =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BANNER_IMAGE_INVALID',
    'La imagen del banner no es válida',
    [
      {
        path: 'imageAssetId',
        code: reason,
        message:
          reason === 'ASSET_UNKNOWN'
            ? 'El medio no existe'
            : reason === 'ASSET_NOT_READY'
              ? 'El medio aún no está confirmado'
              : 'El medio no es una imagen de banner',
      },
    ],
  );

export const altInvalid = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BANNER_ALT_INVALID',
    'El texto alternativo no puede quedar en blanco',
    [
      {
        path: 'imageAlt',
        code: 'BANNER_ALT_INVALID',
        message: 'El texto alternativo no puede quedar en blanco',
      },
    ],
  );

// ---------- normalización ----------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Invisibles que no aportan texto (ancho cero, unión, word joiner, guion blando, BOM): se eliminan. */
const INVISIBLE_CHARS = /\u200B|\u200C|\u200D|\u2060|\u00AD|\uFEFF/g;

/**
 * Texto alternativo de una línea: rechaza NUL y controles bidireccionales (400), NFC, controles a espacio, espacios
 * colapsados, invisibles eliminados y recorte. En blanco tras normalizar => 422 `BANNER_ALT_INVALID`. La longitud
 * (1..120 sobre lo enviado) ya la validó el DTO (400); normalizar solo acorta.
 */
export function normalizeAlt(raw: string): string {
  assertCleanText('imageAlt', raw);
  const text = raw
    .normalize('NFC')
    .replace(INVISIBLE_CHARS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') throw altInvalid();
  if (text.length > IMAGE_ALT_MAX) {
    throw new BadRequestException([`imageAlt supera ${IMAGE_ALT_MAX} caracteres`]);
  }
  return text;
}

/** Código interno `banner-<8 hex del id>`: la API lo genera (la columna y su UNIQUE se conservan). */
export const bannerCodeOf = (id: string): string => `banner-${id.replace(/-/g, '').slice(0, 8)}`;

// ---------- diff y auditoría (sin PII ni texto) ----------

export interface StateDiff {
  scalars: { imageAssetId?: string; imageAlt?: string; active?: boolean };
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Cambios entre el estado actual y el nuevo; `null` si no hay ninguno (idempotente: sin versión ni auditoría). */
export function diffState(before: BannerState, after: BannerState): StateDiff | null {
  const diff: StateDiff = { scalars: {}, oldValues: {}, newValues: {} };
  if (before.imageAssetId !== after.imageAssetId) {
    diff.scalars.imageAssetId = after.imageAssetId;
    diff.oldValues['imageAssetId'] = before.imageAssetId;
    diff.newValues['imageAssetId'] = after.imageAssetId;
  }
  if (before.active !== after.active) {
    diff.scalars.active = after.active;
    diff.oldValues['active'] = before.active;
    diff.newValues['active'] = after.active;
  }
  if (before.imageAlt !== after.imageAlt) {
    diff.scalars.imageAlt = after.imageAlt;
    // El texto no se audita (podría contener datos libres): solo que cambió.
    diff.newValues['imageAltChanged'] = true;
  }
  return Object.keys(diff.scalars).length > 0 ? diff : null;
}

export const createdAudit = (code: string, state: BannerState): AuditValues => ({
  code,
  imageAssetId: state.imageAssetId,
  active: state.active,
});

export const deletedAudit = (code: string, state: Omit<BannerState, 'imageAlt'>): AuditValues => ({
  code,
  imageAssetId: state.imageAssetId,
  active: state.active,
});

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Valor que las rutas privadas (cotización de checkout) fijan en TODA respuesta, también en errores. */
export const PRIVATE_NO_STORE = 'private, no-store';

/** Forma estándar de error (ver packages/contracts/openapi/openapi.yaml → ErrorResponse). */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  /** Detalle por campo en errores de validación (400). */
  details?: string[];
  /** Código de negocio estable (opcional; p. ej. `HOURS_VERSION_CONFLICT`). */
  code?: string;
  /** Violaciones estructuradas de reglas de negocio (opcional; F08). */
  violations?: { path: string; code: string; message: string }[];
  /** F20: cuerpo extra de 409 `QUOTE_CHANGED`/`QUOTE_EXPIRED` y 422 `CHECKOUT_BLOCKED` (ver `EXTRA_BODY_KEYS`). */
  changes?: unknown;
  quote?: unknown;
  blockers?: unknown;
}

/**
 * Únicos `code` que se exponen en respuestas 5xx (F06 D9). El resto de 5xx nunca lleva `code` ni `violations`.
 * Añadir uno exige justificarlo en la spec: es un contrato público.
 */
const PUBLIC_5XX_CODES: ReadonlySet<string> = new Set([
  'CATALOG_UNAVAILABLE',
  'FAVORITES_BUSY',
  'CATEGORIES_BUSY',
  'PRODUCTS_BUSY',
  'MODIFIERS_BUSY',
  'BRANCH_PRODUCTS_BUSY',
  'PROMOTIONS_BUSY',
  'BANNERS_BUSY',
  'STORE_BUSY',
  'MEDIA_BUSY',
  'MEDIA_STORAGE_UNAVAILABLE',
  'MFA_RESET_UNAVAILABLE',
  'MFA_RESET_FAILED',
  // F19 (ADR-0025 D7): semáforo del cotizador de checkout saturado o sin conexión; reintentable, mensaje fijo.
  'CHECKOUT_BUSY',
  // F20 (spec 021 §2.3, ADR-0026 D7): semáforo de pedidos saturado o sin conexión (reintentable con la MISMA clave de
  // idempotencia) y servidor sin `CHECKOUT_QUOTE_SECRET` (configuración, fail-closed). Mensaje fijo; contrato público.
  'ORDERS_BUSY',
  'ORDERS_UNAVAILABLE',
]);

/**
 * Campos adicionales del cuerpo de error que una excepción puede declarar en `extra` (F20): `changes` + `quote` (409
 * `QUOTE_CHANGED`/`QUOTE_EXPIRED`, esquema `OrderQuoteConflict`) y `blockers` (422 `CHECKOUT_BLOCKED`, `OrderBlocked`).
 * Lista blanca y solo en 4xx: nunca se propaga otra clave ni un 5xx con datos.
 */
const EXTRA_BODY_KEYS: readonly string[] = ['changes', 'quote', 'blockers'];

function pickExtra(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EXTRA_BODY_KEYS) if (key in source) out[key] = source[key];
  return out;
}

/** Solo propaga violaciones bien formadas; descarta cualquier otro campo (nunca filtra datos internos). */
function pickViolations(value: unknown): ErrorBody['violations'] {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: NonNullable<ErrorBody['violations']> = [];
  for (const v of value as unknown[]) {
    if (typeof v !== 'object' || v === null) return undefined;
    const { path, code, message } = v as Record<string, unknown>;
    if (typeof path !== 'string' || typeof code !== 'string' || typeof message !== 'string')
      return undefined;
    out.push({ path, code, message });
  }
  return out;
}

/** `name` y `code` de un error de Prisma (nunca su mensaje ni argumentos). */
function prismaErrorLabel(error: Error): string {
  const code = (error as unknown as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} code=${code}` : error.name;
}

/** Nunca filtra trazas ni detalles internos en errores 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Los errores nunca se guardan en caché. Respeta `private, no-store` si una ruta privada (F19, checkout) ya lo fijó
   * por middleware: es MÁS estricto para intermediarios compartidos, así que no se rebaja a `no-store`.
   */
  private noStore(res: Response): void {
    if (res.getHeader('Cache-Control') === PRIVATE_NO_STORE) return;
    res.setHeader('Cache-Control', 'no-store');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = ctx.getRequest<Request>().id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const payload = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
      const details =
        Array.isArray(payload['message']) && payload['message'].every((m) => typeof m === 'string')
          ? payload['message']
          : undefined;
      const code = typeof payload['code'] === 'string' ? payload['code'] : undefined;
      // 5xx con `code` fuera de la lista blanca: mensaje fijo genérico (nunca texto interno de una causa codificada).
      // Un 5xx sin `code` conserva su mensaje deliberado (p. ej. el 503 de `/v1/health/ready`, F00).
      const publicFailure = status >= 500 && code !== undefined && PUBLIC_5XX_CODES.has(code);
      const message =
        status >= 500 && code !== undefined && !publicFailure
          ? 'Error interno del servidor'
          : details
            ? 'Solicitud inválida'
            : typeof payload['message'] === 'string'
              ? payload['message']
              : exception.message;
      const violations = pickViolations(payload['violations']);
      const body: ErrorBody = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        ...(requestId ? { requestId } : {}),
        ...(details ? { details } : {}),
        ...(code && (status < 500 || PUBLIC_5XX_CODES.has(code)) ? { code } : {}),
        ...(violations && status < 500 ? { violations } : {}),
        ...(status < 500 ? pickExtra(payload['extra']) : {}),
      };
      // `Retry-After` (segundos) de una excepción que lo declare (F20: 409 `IDEMPOTENCY_IN_PROGRESS`).
      const retryAfter = payload['retryAfter'];
      if (typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0) {
        res.setHeader('Retry-After', String(retryAfter));
      }
      if (status >= 500) this.logger.error(`[${requestId ?? '-'}] ${exception.message}`);
      this.noStore(res);
      res.status(status).json(body);
      return;
    }

    // Errores de Prisma: solo `name` y `code`. Su mensaje/argumentos pueden incluir datos de la consulta (p. ej. `reason`).
    const prismaError =
      exception instanceof Error && exception.name.startsWith('PrismaClient')
        ? prismaErrorLabel(exception)
        : null;
    this.logger.error(
      `[${requestId ?? '-'}] ${
        prismaError ?? (exception instanceof Error ? exception.stack : String(exception))
      }`,
    );
    this.noStore(res);
    res.status(500).json({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Error interno del servidor',
      ...(requestId ? { requestId } : {}),
    } satisfies ErrorBody);
  }
}

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { codedException } from '../errors/coded-exception.js';
import { AllExceptionsFilter } from './http-exception.filter.js';

function hostWith(res: unknown, id?: string): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id }) }),
  } as unknown as ArgumentsHost;
}

function fakeRes(existingCacheControl?: string) {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    getHeader: vi.fn((name: string) =>
      name === 'Cache-Control' ? existingCacheControl : undefined,
    ),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('AllExceptionsFilter', () => {
  it('mapea HttpException a la forma estándar', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(new BadRequestException('dato inválido'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: 'dato inválido' }),
    );
  });

  it('incluye requestId y details de validación', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      new BadRequestException(['name must be a string', 'qty must be positive']),
      hostWith(res, 'req-12345678'),
    );
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Solicitud inválida',
      requestId: 'req-12345678',
      details: ['name must be a string', 'qty must be positive'],
    });
  });

  it('oculta el detalle de errores inesperados', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    new AllExceptionsFilter().catch(new Error('password=hunter2'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0])).not.toContain('hunter2');
  });

  it('propaga code y violations (solo campos conocidos) sin romper el formato', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(422, 'SCHEDULE_INVALID', 'Horario inválido', [
        { path: 'days[0].intervals[1]', code: 'INTERVAL_OVERLAP', message: 'Se solapa' },
      ]),
      hostWith(res, 'req-1'),
    );
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 422,
      error: 'UNPROCESSABLE_ENTITY',
      code: 'SCHEDULE_INVALID',
      message: 'Horario inválido',
      requestId: 'req-1',
      violations: [
        { path: 'days[0].intervals[1]', code: 'INTERVAL_OVERLAP', message: 'Se solapa' },
      ],
    });
  });

  it('sin code ni violations el cuerpo no cambia; violations mal formadas se descartan', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(codedException(409, 'CLOSURE_OVERLAP', 'x'), hostWith(res));
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'CONFLICT',
      code: 'CLOSURE_OVERLAP',
      message: 'x',
    });
    const res2 = fakeRes();
    new AllExceptionsFilter().catch(
      new BadRequestException({ message: 'm', violations: [{ path: 1, secret: 'x' }] }),
      hostWith(res2),
    );
    expect(JSON.stringify(res2.json.mock.calls[0])).not.toContain('secret');
    expect(res2.json.mock.calls[0]?.[0]).not.toHaveProperty('violations');
  });

  it('toda respuesta de error lleva Cache-Control: no-store (4xx y 5xx)', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (const error of [
      new BadRequestException('x'),
      codedException(409, 'C', 'm'),
      new Error('boom'),
    ]) {
      const res = fakeRes();
      new AllExceptionsFilter().catch(error, hostWith(res));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    }
  });

  it('errores de Prisma: el log solo lleva name y code, nunca mensaje ni argumentos', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = Object.assign(
      new Error('Invalid prisma.branchClosure.create() invocation: { reason: "dato sensible" }'),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const res = fakeRes();
    new AllExceptionsFilter().catch(error, hostWith(res, 'req-9'));
    const logged = String(log.mock.calls.at(-1)?.[0]);
    expect(logged).toBe('[req-9] PrismaClientValidationError code=P2009');
    expect(logged).not.toContain('sensible');
    expect(JSON.stringify(res.json.mock.calls[0])).not.toContain('sensible');
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('5xx: solo CATALOG_UNAVAILABLE conserva `code`; otro code y las violations se descartan', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'CATALOG_UNAVAILABLE', 'Catálogo no disponible', [
        { path: 'x', code: 'Y', message: 'detalle interno' },
      ]),
      hostWith(res, 'req-3'),
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 503,
      error: 'SERVICE_UNAVAILABLE',
      code: 'CATALOG_UNAVAILABLE',
      message: 'Catálogo no disponible',
      requestId: 'req-3',
    });

    for (const [status, code] of [
      [503, 'OTHER_UNAVAILABLE'],
      [500, 'INTERNAL_DETAIL'],
      [502, 'CATALOG_UNAVAILABLE_X'],
    ] as const) {
      const other = fakeRes();
      new AllExceptionsFilter().catch(codedException(status, code, 'm'), hostWith(other));
      expect(other.json.mock.calls[0]?.[0]).not.toHaveProperty('code');
    }
  });

  it('5xx: CATEGORIES_BUSY es público (F10)', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'CATEGORIES_BUSY', 'reintenta'),
      hostWith(res),
    );
    expect(res.json.mock.calls[0]?.[0]).toMatchObject({
      code: 'CATEGORIES_BUSY',
      message: 'reintenta',
    });
  });

  it('5xx: PRODUCTS_BUSY es público (F11)', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'PRODUCTS_BUSY', 'reintenta'),
      hostWith(res),
    );
    expect(res.json.mock.calls[0]?.[0]).toMatchObject({
      code: 'PRODUCTS_BUSY',
      message: 'reintenta',
    });
  });

  it('5xx: MEDIA_BUSY y MEDIA_STORAGE_UNAVAILABLE son públicos (F14) con su mensaje fijo y sin fugas', () => {
    for (const code of ['MEDIA_BUSY', 'MEDIA_STORAGE_UNAVAILABLE']) {
      const res = fakeRes();
      new AllExceptionsFilter().catch(codedException(503, code, 'mensaje fijo'), hostWith(res));
      expect(res.json.mock.calls[0]?.[0]).toMatchObject({ code, message: 'mensaje fijo' });
    }
  });

  it('5xx: un error del proveedor NO codificado nunca expone su mensaje (URL firmada, credenciales)', () => {
    const res = fakeRes();
    const leak = 'https://acct.r2.cloudflarestorage.com/b/k?X-Amz-Signature=abcdef&secret=XYZ';
    new AllExceptionsFilter().catch(new Error(`fallo ${leak}`), hostWith(res));
    expect(JSON.stringify(res.json.mock.calls[0]?.[0])).not.toMatch(/Signature|secret|XYZ|r2\./);
  });

  it('5xx: BANNERS_BUSY es público (F16) con su mensaje fijo y sin violaciones internas', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'BANNERS_BUSY', 'reintenta', [
        { path: 'interno', code: 'X', message: 'detalle' },
      ]),
      hostWith(res),
    );
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'BANNERS_BUSY', message: 'reintenta' });
    expect(body).not.toHaveProperty('violations');
  });

  it('5xx: MODIFIERS_BUSY es público (F12)', () => {
    const res = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'MODIFIERS_BUSY', 'reintenta'),
      hostWith(res),
    );
    expect(res.json.mock.calls[0]?.[0]).toMatchObject({ code: 'MODIFIERS_BUSY' });
  });

  it('5xx: FAVORITES_BUSY es público; un 503 fuera de la lista no expone code ni mensaje interno', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const busy = fakeRes();
    new AllExceptionsFilter().catch(
      codedException(503, 'FAVORITES_BUSY', 'ocupado'),
      hostWith(busy),
    );
    expect(busy.json.mock.calls[0]?.[0]).toMatchObject({
      code: 'FAVORITES_BUSY',
      message: 'ocupado',
    });

    for (const status of [500, 502, 503] as const) {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        codedException(status, 'INTERNAL_DETAIL', 'host db-prod:5432 password=x'),
        hostWith(res, 'req-5'),
      );
      const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body).not.toHaveProperty('code');
      expect(body['message']).toBe('Error interno del servidor');
      expect(JSON.stringify(body)).not.toContain('password');
    }
    // Sin `code` se conserva el mensaje deliberado del 5xx (p. ej. el 503 de /v1/health/ready, F00).
    const plain = fakeRes();
    new AllExceptionsFilter().catch(
      new HttpException('Dependencias no disponibles', 503),
      hostWith(plain),
    );
    const plainBody = plain.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(plainBody['message']).toBe('Dependencias no disponibles');
    expect(plainBody).not.toHaveProperty('code');
  });
  it('5xx: MFA_RESET_UNAVAILABLE (503) y MFA_RESET_FAILED (502) son públicos y descartan violations', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (const [status, code] of [
      [503, 'MFA_RESET_UNAVAILABLE'],
      [502, 'MFA_RESET_FAILED'],
    ] as const) {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        codedException(status, code, 'mensaje fijo', [
          { path: 'x', code: 'Y', message: 'interno' },
        ]),
        hostWith(res, 'req-7'),
      );
      expect(res.json).toHaveBeenCalledWith({
        statusCode: status,
        error: HttpStatus[status],
        code,
        message: 'mensaje fijo',
        requestId: 'req-7',
      });
    }
  });

  describe('Cache-Control de errores (F19)', () => {
    it('sin valor previo => no-store', () => {
      const res = fakeRes();
      new AllExceptionsFilter().catch(new BadRequestException('x'), hostWith(res));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('respeta `private, no-store` fijado por la ruta privada (no lo rebaja)', () => {
      const res = fakeRes('private, no-store');
      new AllExceptionsFilter().catch(new BadRequestException('x'), hostWith(res));
      expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('un valor público previo se sustituye por no-store', () => {
      const res = fakeRes('public, max-age=60');
      new AllExceptionsFilter().catch(new BadRequestException('x'), hostWith(res));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('también en 500 inesperados', () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const res = fakeRes('private, no-store');
      new AllExceptionsFilter().catch(new Error('boom'), hostWith(res));
      expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('CHECKOUT_BUSY (503) es un código público; otros 5xx codificados siguen genéricos', () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        codedException(HttpStatus.SERVICE_UNAVAILABLE, 'CHECKOUT_BUSY', 'ocupado'),
        hostWith(res),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503, code: 'CHECKOUT_BUSY', message: 'ocupado' }),
      );
      const other = fakeRes();
      new AllExceptionsFilter().catch(
        codedException(HttpStatus.SERVICE_UNAVAILABLE, 'INTERNAL_THING', 'secreto interno'),
        hostWith(other),
      );
      const body = other.json.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body['code']).toBeUndefined();
      expect(body['message']).toBe('Error interno del servidor');
    });
  });

  describe('F20: pedidos', () => {
    it('ORDERS_BUSY y ORDERS_UNAVAILABLE son públicos en 503 (mensaje fijo y `code`)', () => {
      for (const code of ['ORDERS_BUSY', 'ORDERS_UNAVAILABLE']) {
        const res = fakeRes();
        new AllExceptionsFilter().catch(
          codedException(HttpStatus.SERVICE_UNAVAILABLE, code, 'mensaje público'),
          hostWith(res),
        );
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 503, code, message: 'mensaje público' }),
        );
      }
    });

    it('un 5xx con otro `code` sigue sin exponerlo', () => {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        codedException(HttpStatus.SERVICE_UNAVAILABLE, 'ORDERS_INTERNAL', 'detalle interno'),
        hostWith(res),
      );
      const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body['code']).toBeUndefined();
      expect(body['message']).toBe('Error interno del servidor');
    });

    it('propaga `changes`, `quote` y `blockers` (lista blanca) en 409/422 y descarta cualquier otra clave', () => {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        new HttpException(
          {
            message: 'cambió',
            code: 'QUOTE_CHANGED',
            extra: {
              changes: [{ field: 'total' }],
              quote: { total: '1.00' },
              secreto: 'x',
              stack: 'y',
            },
          },
          HttpStatus.CONFLICT,
        ),
        hostWith(res),
      );
      const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'QUOTE_CHANGED',
        changes: [{ field: 'total' }],
        quote: { total: '1.00' },
      });
      expect(body).not.toHaveProperty('secreto');
      expect(body).not.toHaveProperty('stack');
      expect(body).not.toHaveProperty('extra');
    });

    it('F22: propaga `current` en 409 y 422 junto a `violations`, sin otras claves; en 5xx no', () => {
      for (const status of [HttpStatus.CONFLICT, HttpStatus.UNPROCESSABLE_ENTITY]) {
        const res = fakeRes();
        new AllExceptionsFilter().catch(
          new HttpException(
            {
              message: 'x',
              code: 'ORDER_STATE_CONFLICT',
              extra: {
                current: { status: 'accepted', updatedAt: '2026-11-18T18:00:00.000Z' },
                otra: 1,
              },
            },
            status,
          ),
          hostWith(res),
        );
        const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(body['current']).toEqual({
          status: 'accepted',
          updatedAt: '2026-11-18T18:00:00.000Z',
        });
        expect(body).not.toHaveProperty('otra');
        expect(body).not.toHaveProperty('extra');
      }
      const busy = fakeRes();
      new AllExceptionsFilter().catch(
        new HttpException(
          { message: 'x', code: 'ORDERS_BUSY', extra: { current: { status: 'x' } } },
          503,
        ),
        hostWith(busy),
      );
      expect(busy.json.mock.calls[0]?.[0]).not.toHaveProperty('current');
    });

    it('un 5xx NUNCA propaga `extra`', () => {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        new HttpException(
          { message: 'x', code: 'ORDERS_BUSY', extra: { quote: { secreto: 1 } } },
          HttpStatus.SERVICE_UNAVAILABLE,
        ),
        hostWith(res),
      );
      expect(res.json.mock.calls[0]?.[0]).not.toHaveProperty('quote');
    });

    it('`retryAfter` fija la cabecera Retry-After; un valor no entero positivo se ignora', () => {
      const res = fakeRes();
      new AllExceptionsFilter().catch(
        new HttpException(
          { message: 'espera', code: 'IDEMPOTENCY_IN_PROGRESS', retryAfter: 1 },
          409,
        ),
        hostWith(res),
      );
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '1');
      const bad = fakeRes();
      new AllExceptionsFilter().catch(
        new HttpException({ message: 'x', retryAfter: '1; evil' }, 409),
        hostWith(bad),
      );
      expect(bad.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    });
  });
});

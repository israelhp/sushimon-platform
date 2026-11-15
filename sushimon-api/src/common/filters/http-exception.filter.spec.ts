import { BadRequestException, HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { codedException } from '../errors/coded-exception.js';
import { AllExceptionsFilter } from './http-exception.filter.js';

function hostWith(res: unknown, id?: string): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id }) }),
  } as unknown as ArgumentsHost;
}

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
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
});

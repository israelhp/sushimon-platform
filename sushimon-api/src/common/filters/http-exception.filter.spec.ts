import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
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
});

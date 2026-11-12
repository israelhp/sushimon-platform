import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';

function hostWith(res: unknown, id?: string): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id }) }),
  } as unknown as ArgumentsHost;
}

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
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
});

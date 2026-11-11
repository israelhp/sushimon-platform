import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';

function hostWith(res: unknown): ArgumentsHost {
  return { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
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

  it('oculta el detalle de errores inesperados', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    new AllExceptionsFilter().catch(new Error('password=hunter2'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0])).not.toContain('hunter2');
  });
});

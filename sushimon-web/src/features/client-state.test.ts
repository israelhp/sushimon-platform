import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_MODE, parseOrderMode } from './order-mode/order-mode';

describe('modo de pedido', () => {
  it('lee preferencias válidas y descarta basura', () => {
    expect(parseOrderMode(null)).toEqual(DEFAULT_ORDER_MODE);
    expect(parseOrderMode('{"type":"x"}')).toEqual(DEFAULT_ORDER_MODE);
    expect(parseOrderMode('no es json')).toEqual(DEFAULT_ORDER_MODE);
    expect(
      parseOrderMode(
        '{"type":"delivery","branchId":"sucursal-1","address":{"department":"Guatemala","municipality":"Guatemala","zone":"10"}}',
      ),
    ).toEqual({
      type: 'delivery',
      branchId: 'sucursal-1',
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '',
        references: '',
      },
    });
  });

  it('ADR-0036: un modo guardado «pickup» se descarta sin error y vuelve a «sin elegir»', () => {
    expect(
      parseOrderMode(
        '{"type":"pickup","when":{"kind":"now"},"branchId":"sucursal-1","address":null}',
      ),
    ).toEqual(DEFAULT_ORDER_MODE);
  });

  it('ADR-0036: un `when` programado guardado se ignora (siempre inmediato) y el resto se conserva', () => {
    const mode = parseOrderMode(
      '{"type":"delivery","when":{"kind":"scheduled","date":"2026-11-12","time":"13:00"},"branchId":"sucursal-1","address":null}',
    );
    expect(mode).toEqual({ type: 'delivery', branchId: 'sucursal-1', address: null });
    expect(mode).not.toHaveProperty('when');
  });
});

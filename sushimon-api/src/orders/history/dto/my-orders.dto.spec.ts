import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMyOrdersQuery } from './my-orders.dto.js';

const parse = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListMyOrdersQuery, query);
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('ListMyOrdersQuery.status (spec 024 §11 #5)', () => {
  it('los repetidos se DEDUPLICAN en lugar de rechazarse (csv y parámetro repetido)', async () => {
    const a = await parse({ status: 'pending,accepted,pending' });
    expect(a.errors).toEqual([]);
    expect(a.dto.status).toEqual(['pending', 'accepted']);
    const b = await parse({ status: ['rejected', 'rejected', 'cancelled'] });
    expect(b.errors).toEqual([]);
    expect(b.dto.status).toEqual(['rejected', 'cancelled']);
    const many = await parse({ status: Array.from({ length: 30 }, () => 'pending').join(',') });
    expect(many.errors).toEqual([]);
    expect(many.dto.status).toEqual(['pending']);
  });

  it('un estado fuera del catálogo sigue siendo 400', async () => {
    expect((await parse({ status: 'pending,paid' })).errors).not.toEqual([]);
  });
});

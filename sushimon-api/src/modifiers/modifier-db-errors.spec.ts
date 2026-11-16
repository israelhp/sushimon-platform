import { translateModifierDbError } from './modifier-db-errors.js';

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { status?: number }).status;
const unique = (target: string, c = 'P2002') => ({ code: c, meta: { target: [target] } });

describe('translateModifierDbError', () => {
  it('P2028 y 55P03 => 503 MODIFIERS_BUSY', () => {
    for (const c of ['P2028', '55P03']) {
      const e = translateModifierDbError({ code: c });
      expect(status(e)).toBe(503);
      expect(code(e)).toBe('MODIFIERS_BUSY');
    }
    expect(code(translateModifierDbError({ cause: { code: '55P03' } }))).toBe('MODIFIERS_BUSY');
  });
  it('UNIQUE por constraint', () => {
    expect(code(translateModifierDbError(unique('modifier_groups_name_lower_key')))).toBe(
      'MODIFIER_GROUP_NAME_TAKEN',
    );
    expect(code(translateModifierDbError(unique('modifiers_group_name_lower_key', '23505')))).toBe(
      'MODIFIER_NAME_TAKEN',
    );
    expect(
      status(
        translateModifierDbError({
          code: 'P2002',
          message: 'constraint "modifiers_group_name_lower_key"',
        }),
      ),
    ).toBe(409);
  });
  it('UNIQUE de otro objetivo o desconocido => mismo error (500 genérico)', () => {
    const a = unique('alguna_otra_restriccion_key');
    expect(translateModifierDbError(a)).toBe(a);
    const b = { code: 'P2002' };
    expect(translateModifierDbError(b)).toBe(b);
  });
  it('triggers de tope (23514) => 422 MODIFIER_LIMIT_REACHED; otro CHECK => 400', () => {
    for (const m of ['modifier_group_max_options', 'product_max_modifier_groups']) {
      const e = translateModifierDbError({ code: '23514', message: m });
      expect(status(e)).toBe(422);
      expect(code(e)).toBe('MODIFIER_LIMIT_REACHED');
    }
    expect(status(translateModifierDbError({ code: 'P2004', message: 'otro_chk' }))).toBe(400);
  });
  it('FK', () => {
    expect(
      code(
        translateModifierDbError({
          code: '23503',
          message: 'product_modifier_groups_group_id_fkey',
        }),
      ),
    ).toBe('MODIFIER_GROUP_INVALID');
    expect(
      code(
        translateModifierDbError({
          code: '23503',
          message: 'product_modifier_groups_product_id_fkey',
        }),
      ),
    ).toBe('PRODUCT_NOT_FOUND');
  });
  it('deadlock (40P01) y fallo de serialización (40001) => 503 MODIFIERS_BUSY', () => {
    for (const c of ['40P01', '40001']) {
      expect(code(translateModifierDbError({ code: c }))).toBe('MODIFIERS_BUSY');
      expect(code(translateModifierDbError({ cause: { originalCode: c } }))).toBe('MODIFIERS_BUSY');
    }
  });
  it('UNIQUE *_sort_key (incluida la diferida al COMMIT) => 503, aun con contexto', () => {
    for (const t of ['modifiers_group_sort_key', 'product_modifier_groups_product_sort_key']) {
      const e = translateModifierDbError(unique(t, '23505'), 'option');
      expect(status(e)).toBe(503);
      expect(code(e)).toBe('MODIFIERS_BUSY');
    }
    expect(
      code(
        translateModifierDbError(
          { code: '23505', message: 'violates "modifiers_group_sort_key"' },
          'group',
        ),
      ),
    ).toBe('MODIFIERS_BUSY');
  });
  it('UNIQUE SIN target/constraint/message: se traduce por contexto de la operación', () => {
    for (const c of ['P2002', '23505']) {
      expect(code(translateModifierDbError({ code: c }, 'group'))).toBe(
        'MODIFIER_GROUP_NAME_TAKEN',
      );
      expect(code(translateModifierDbError({ code: c }, 'option'))).toBe('MODIFIER_NAME_TAKEN');
      const bare = { code: c };
      expect(translateModifierDbError(bare)).toBe(bare); // sin contexto => 500
    }
  });
  it('la restricción identificada manda sobre el contexto', () => {
    expect(code(translateModifierDbError(unique('modifiers_group_name_lower_key'), 'group'))).toBe(
      'MODIFIER_NAME_TAKEN',
    );
  });
  it('errores no esperados y valores no objeto pasan intactos', () => {
    const e = new Error('x');
    expect(translateModifierDbError(e)).toBe(e);
    expect(translateModifierDbError('x')).toBe('x');
  });
});

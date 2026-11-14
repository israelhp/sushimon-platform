import {
  buildProfilePatch,
  normalizeFullName,
  normalizePhone,
  safeAvatarUrl,
  suggestedFullName,
} from './customer-profile.policy.js';

describe('normalizeFullName', () => {
  it('recorta y colapsa espacios', () => {
    expect(normalizeFullName('   Ana    López  ')).toEqual({ ok: true, value: 'Ana López' });
  });

  it('acepta caracteres internacionales, apóstrofos, guiones y puntos', () => {
    for (const name of ['José Ñandú', "D'Angelo Ruiz", 'Ana-María Pérez', 'J. Smith', 'Zoë Ähm']) {
      expect(normalizeFullName(name).ok).toBe(true);
    }
  });

  it('rechaza vacío, muy corto y muy largo', () => {
    expect(normalizeFullName('   ').ok).toBe(false);
    expect(normalizeFullName('A').ok).toBe(false);
    expect(normalizeFullName('A'.repeat(121)).ok).toBe(false);
    expect(normalizeFullName('A'.repeat(120)).ok).toBe(true);
  });

  it('rechaza dígitos, símbolos y cadenas sin letras', () => {
    expect(normalizeFullName('Ana 2').ok).toBe(false);
    expect(normalizeFullName('<script>').ok).toBe(false);
    expect(normalizeFullName('--..').ok).toBe(false);
  });

  it('elimina caracteres de control antes de validar', () => {
    expect(normalizeFullName('Ana\u0000López')).toEqual({ ok: true, value: 'Ana López' });
  });
});

describe('normalizePhone', () => {
  it('normaliza números de Guatemala con o sin prefijo a +502', () => {
    expect(normalizePhone('5555-9999')).toEqual({ ok: true, value: '+50255559999' });
    expect(normalizePhone('+502 5555 9999')).toEqual({ ok: true, value: '+50255559999' });
    expect(normalizePhone('(502) 5555.9999')).toEqual({ ok: true, value: '+50255559999' });
    expect(normalizePhone('50255559999')).toEqual({ ok: true, value: '+50255559999' });
  });

  it('no asume prefijo local: cualquier 8 dígitos son válidos', () => {
    expect(normalizePhone('12345678')).toEqual({ ok: true, value: '+50212345678' });
  });

  it('acepta E.164 internacional', () => {
    expect(normalizePhone('+15555550123')).toEqual({ ok: true, value: '+15555550123' });
  });

  it('vacío o null significa sin teléfono', () => {
    expect(normalizePhone(null)).toEqual({ ok: true, value: null });
    expect(normalizePhone('   ')).toEqual({ ok: true, value: null });
  });

  it('rechaza longitudes y formatos inválidos', () => {
    for (const bad of [
      '12',
      '5555-999',
      'abc',
      '+0123456789',
      '+1234',
      '1'.repeat(21),
      '+502555555',
    ]) {
      expect(normalizePhone(bad).ok).toBe(false);
    }
  });
});

describe('buildProfilePatch', () => {
  it('no incluye campos omitidos (sin inventar valores)', () => {
    expect(buildProfilePatch({ phone: '5555-9999' })).toEqual({
      ok: true,
      patch: { phone: '+50255559999' },
    });
  });

  it('phone: null borra el teléfono', () => {
    expect(buildProfilePatch({ phone: null })).toEqual({ ok: true, patch: { phone: null } });
  });

  it('un PATCH vacío es válido y no modifica nada', () => {
    expect(buildProfilePatch({})).toEqual({ ok: true, patch: {} });
  });

  it('acumula los errores de todos los campos', () => {
    const result = buildProfilePatch({ fullName: '1', phone: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('suggestedFullName / safeAvatarUrl', () => {
  it('usa el nombre de Google solo si es utilizable', () => {
    expect(suggestedFullName('Ana López')).toBe('Ana López');
    expect(suggestedFullName('x')).toBeNull();
    expect(suggestedFullName(null)).toBeNull();
  });

  it('solo permite https en dominios de Google conocidos', () => {
    expect(safeAvatarUrl('https://lh3.googleusercontent.com/a/abc=s96')).toBe(
      'https://lh3.googleusercontent.com/a/abc=s96',
    );
    expect(safeAvatarUrl('http://lh3.googleusercontent.com/a/abc')).toBeNull();
    expect(safeAvatarUrl('https://evil.example.com/x.png')).toBeNull();
    expect(safeAvatarUrl('https://user:pw@lh3.googleusercontent.com/a')).toBeNull();
    expect(safeAvatarUrl('javascript:alert(1)')).toBeNull();
    expect(safeAvatarUrl(null)).toBeNull();
  });
});

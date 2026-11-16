import { slugifyText, uniqueSlug } from './slug.js';

describe('slug compartido', () => {
  it('slugifyText: sin acentos, kebab, ≤ 80 y respaldo configurable', () => {
    expect(slugifyText('  Rolls Fríos  Ñandú! ', 'x')).toBe('rolls-frios-nandu');
    expect(slugifyText('***', 'producto')).toBe('producto');
    const long = slugifyText('a'.repeat(70) + ' ' + 'b'.repeat(70), 'x');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('-')).toBe(false);
  });
  it('uniqueSlug: -2, -3 y respeta el máximo recortando la base', () => {
    expect(uniqueSlug('sushi', new Set())).toBe('sushi');
    expect(uniqueSlug('sushi', new Set(['sushi', 'sushi-2']))).toBe('sushi-3');
    const base = 'a'.repeat(80);
    const out = uniqueSlug(base, new Set([base]));
    expect(out).toHaveLength(80);
    expect(out.endsWith('-2')).toBe(true);
  });
});

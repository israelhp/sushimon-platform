import type { PublicCategoryView } from '../categories/categories.types.js';
import {
  buildSearchPattern,
  diffProduct,
  escapeLike,
  fold,
  formatCents,
  indexVisibleTree,
  isUnused,
  normalizeDescription,
  normalizeMedia,
  normalizeName,
  normalizePrice,
  normalizeSku,
  normalizeSlug,
  normalizeUpdate,
  parsePriceCents,
  productInUse,
  slugify,
  slugSearchPrefix,
  SQL_ACCENTS_FROM,
  SQL_ACCENTS_TO,
  subtreeIdsBySlug,
  toAdminView,
  uniqueSlug,
} from './product-policy.js';
import type { MediaRow, ProductRow } from './products.types.js';

const status = (e: unknown) => (e as { getStatus(): number }).getStatus();
const payload = (e: unknown) => (e as { getResponse(): Record<string, unknown> }).getResponse();
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('no lanzó');
};

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  sku: 'ROLL-01',
  categoryId: 'c1',
  slug: 'roll',
  name: 'Roll',
  description: null,
  basePrice: '85.00',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...over,
});
const media = (url: string, sortOrder: number, altText: string | null = null): MediaRow => ({
  id: `m${sortOrder}`,
  productId: 'p1',
  url,
  altText,
  sortOrder,
});

describe('precio (aritmética entera, sin Number decimal)', () => {
  it('acepta formas válidas y las deja canónicas', () => {
    expect(normalizePrice('85.00')).toBe('85.00');
    expect(normalizePrice('0.01')).toBe('0.01');
    expect(normalizePrice('007.50')).toBe('7.50');
    expect(normalizePrice('999999.99')).toBe('999999.99');
    expect(parsePriceCents('0.10')).toBe(10);
  });
  it('rechaza forma o rango inválidos con 400', () => {
    for (const bad of [
      '85',
      '85.5',
      '85.000',
      '-1.00',
      '0.00',
      '000000.00',
      '1000000.00',
      '1e3',
      ' 85.00',
      '85,00',
      '',
      85,
      null,
      undefined,
    ]) {
      expect(status(thrown(() => normalizePrice(bad)))).toBe(400);
    }
  });
  it('formatCents es exacto', () => {
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(99_999_999)).toBe('999999.99');
    expect(formatCents(1000)).toBe('10.00');
  });
});

describe('normalización de texto', () => {
  it('name: NFC, recorte, colapso, sin control; vacío o > 120 => 400', () => {
    expect(normalizeName('  Roll \t California\n ')).toBe('Roll California');
    expect(normalizeName('Café')).toBe('Café');
    expect(status(thrown(() => normalizeName('   ')))).toBe(400);
    expect(status(thrown(() => normalizeName('a'.repeat(121))))).toBe(400);
    expect(normalizeName('a'.repeat(120))).toHaveLength(120);
  });
  it('description: texto plano, vacío = null, conserva saltos de línea, > 2000 => 400', () => {
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription('  \n ')).toBeNull();
    expect(normalizeDescription(' a\nb\u0000c ')).toBe('a\nbc');
    expect(status(thrown(() => normalizeDescription('a'.repeat(2001))))).toBe(400);
  });
  it('slug y sku', () => {
    expect(normalizeSlug(' Roll-2 ')).toBe('roll-2');
    expect(status(thrown(() => normalizeSlug('a--b')))).toBe(400);
    expect(status(thrown(() => normalizeSlug('a'.repeat(81))))).toBe(400);
    expect(normalizeSku(' roll-01.a_b ')).toBe('ROLL-01.A_B');
    expect(normalizeSku(null)).toBeNull();
    for (const bad of ['', '-x', 'a b', 'a'.repeat(41), 'ñ']) {
      expect(status(thrown(() => normalizeSku(bad)))).toBe(400);
    }
  });
  it('slugify con respaldo "producto" y desambiguación -2, -3', () => {
    expect(slugify('Roll Fríos Ñandú')).toBe('roll-frios-nandu');
    expect(slugify('***')).toBe('producto');
    expect(uniqueSlug('roll', new Set(['roll', 'roll-2']))).toBe('roll-3');
  });
  it('slugSearchPrefix cubre los candidatos de uniqueSlug incluso con bases largas', () => {
    const base = 'x'.repeat(80);
    const taken = new Set([base]);
    const candidate = uniqueSlug(base, taken);
    expect(candidate.startsWith(slugSearchPrefix(base))).toBe(true);
    expect(uniqueSlug('roll', new Set()).startsWith(slugSearchPrefix('roll'))).toBe(true);
  });
});

describe('imágenes (PRODUCT_MEDIA_INVALID 422)', () => {
  const code = (e: unknown) => payload(e)['code'];
  it('acepta https y deja el orden; altText vacío => null', () => {
    expect(
      normalizeMedia([
        { url: 'https://cdn.example.com/a.jpg', altText: '  Roll  ' },
        { url: 'https://x.io/b' },
      ]),
    ).toEqual([
      { url: 'https://cdn.example.com/a.jpg', altText: 'Roll' },
      { url: 'https://x.io/b', altText: null },
    ]);
    expect(normalizeMedia([{ url: 'https://x.io/b', altText: '  ' }])[0]?.altText).toBeNull();
    expect(normalizeMedia([])).toEqual([]);
  });
  it.each([
    ['http', 'http://x.io/a.jpg'],
    ['data', 'data:image/png;base64,AAAA'],
    ['javascript', 'javascript:alert(1)'],
    ['relativa', '/img/a.jpg'],
    ['protocolo relativo', '//x.io/a.jpg'],
    ['espacio', 'https://x.io/a b.jpg'],
    ['control', 'https://x.io/a\u0001.jpg'],
    ['sin host', 'https://'],
    ['credenciales', 'https://user:pw@x.io/a.jpg'],
    ['> 2048', `https://x.io/${'a'.repeat(2048)}`],
    ['vacía', ''],
    ['IPv4 literal', 'https://192.168.1.10/a.jpg'],
    ['IPv4 de metadatos', 'https://169.254.169.254/latest'],
    ['IPv4 hexadecimal', 'https://0x7f.1/a.jpg'],
    ['IPv4 entero', 'https://2130706433/a.jpg'],
    ['IPv6 literal', 'https://[::1]/a.jpg'],
    ['localhost', 'https://localhost/a.jpg'],
    ['subdominio de localhost', 'https://app.localhost/a.jpg'],
    ['host sin punto', 'https://intranet/a.jpg'],
  ])('URL %s => 422', (_name, url) => {
    const e = thrown(() => normalizeMedia([{ url }]));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
  });
  it('2048 caracteres exactos es válida', () => {
    const url = `https://x.io/${'a'.repeat(2048 - 'https://x.io/'.length)}`;
    expect(url).toHaveLength(2048);
    expect(normalizeMedia([{ url }])).toHaveLength(1);
  });
  it('altText > 200 => 422; no-cadena => 422; más de 8 => 422', () => {
    expect(
      status(thrown(() => normalizeMedia([{ url: 'https://x.io/a', altText: 'a'.repeat(201) }]))),
    ).toBe(422);
    expect(status(thrown(() => normalizeMedia([{ url: 'https://x.io/a', altText: 5 }])))).toBe(422);
    const nine = Array.from({ length: 9 }, (_, i) => ({ url: `https://x.io/${i}` }));
    expect(status(thrown(() => normalizeMedia(nine)))).toBe(422);
    expect(normalizeMedia(nine.slice(0, 8))).toHaveLength(8);
  });
});

describe('imágenes: host y normalización', () => {
  it('lista de hosts: exacto (cdn.x.com) o subdominios (.x.com); vacía = cualquiera público', () => {
    const ok = (url: string, list: string[]) => normalizeMedia([{ url }], list).length === 1;
    expect(ok('https://cdn.x.com/a', ['cdn.x.com'])).toBe(true);
    expect(ok('https://CDN.X.com/a', ['cdn.x.com'])).toBe(true);
    expect(ok('https://a.b.x.com/a', ['.x.com'])).toBe(true);
    expect(ok('https://anything.org/a', [])).toBe(true);
    for (const [url, list] of [
      ['https://x.com/a', ['.x.com']],
      ['https://evilx.com/a', ['.x.com']],
      ['https://a.cdn.x.com/a', ['cdn.x.com']],
      ['https://cdn.x.com.evil.io/a', ['cdn.x.com']],
    ] as const) {
      expect(status(thrown(() => normalizeMedia([{ url }], [...list])))).toBe(422);
    }
  });
  it('guarda el href normalizado y exige href <= 2048', () => {
    expect(normalizeMedia([{ url: 'https://CDN.Example.com' }])[0]?.url).toBe(
      'https://cdn.example.com/',
    );
    expect(normalizeMedia([{ url: 'https://x.io/a/../b.jpg' }])[0]?.url).toBe('https://x.io/b.jpg');
    // el href normalizado crece (p. ej. `{` => `%7B`): el original cabe, el normalizado no
    const grow = `https://x.io/${'{'.repeat(700)}`;
    expect(grow.length).toBeLessThanOrEqual(2048);
    expect(status(thrown(() => normalizeMedia([{ url: grow }])))).toBe(422);
  });
});

describe('búsqueda', () => {
  it('escapa \\ % _ como literales y pliega mayúsculas/acentos', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(buildSearchPattern('  50%_Off\\ ')).toBe('%50\\%\\_off\\\\%');
    expect(buildSearchPattern('Fríó Ñandú')).toBe('%frio nandu%');
  });
  it('vacío o ausente => null; > 80 => 400; quita caracteres de control (NUL)', () => {
    expect(buildSearchPattern(undefined)).toBeNull();
    expect(buildSearchPattern('   ')).toBeNull();
    expect(buildSearchPattern('\u0000')).toBeNull();
    expect(buildSearchPattern('a\u0000b')).toBe('%a b%');
    expect(status(thrown(() => buildSearchPattern('a'.repeat(81))))).toBe(400);
    expect(buildSearchPattern('a'.repeat(80))).toBe(`%${'a'.repeat(80)}%`);
  });
  it('la tabla de acentos de SQL tiene el mismo largo y coincide con fold()', () => {
    expect([...SQL_ACCENTS_FROM]).toHaveLength([...SQL_ACCENTS_TO].length);
    [...SQL_ACCENTS_FROM].forEach((ch, i) => {
      expect(SQL_ACCENTS_TO.charAt(i).toLowerCase()).toBe(fold(ch));
    });
  });
});

describe('categorías visibles', () => {
  const node = (id: string, children: PublicCategoryView[] = []): PublicCategoryView => ({
    id,
    slug: id,
    name: id.toUpperCase(),
    description: null,
    children,
  });
  const tree = [node('a', [node('b', [node('c')]), node('d')]), node('e')];
  it('indexVisibleTree: referencias y ancestros raíz → padre', () => {
    const index = indexVisibleTree(tree);
    expect([...index.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(index.get('c')?.ancestors.map((a) => a.id)).toEqual(['a', 'b']);
    expect(index.get('a')?.ancestors).toEqual([]);
    expect(index.get('b')?.ref).toEqual({ id: 'b', slug: 'b', name: 'B' });
  });
  it('subtreeIdsBySlug: la categoría y sus descendientes; inexistente => null', () => {
    expect(subtreeIdsBySlug(tree, 'a')?.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(subtreeIdsBySlug(tree, 'c')).toEqual(['c']);
    expect(subtreeIdsBySlug(tree, 'nada')).toBeNull();
  });
});

describe('diffProduct', () => {
  const current = product();
  const currentMedia = [media('https://x.io/a', 0, 'A')];
  it('sin cambios reales => null (incluye media igual y active igual)', () => {
    expect(
      diffProduct(
        current,
        currentMedia,
        normalizeUpdate({
          name: 'Roll',
          sku: 'roll-01',
          basePrice: '85.0' + '0',
          active: true,
          media: [{ url: 'https://x.io/a', altText: 'A' }],
        }),
      ),
    ).toBeNull();
  });
  it('solo cambios reales; sin descripción ni PII en old/new; active no entra en old/new', () => {
    const diff = diffProduct(
      current,
      currentMedia,
      normalizeUpdate({
        name: 'Roll 2',
        description: 'secreto largo',
        basePrice: '90.00',
        active: false,
        media: [],
      }),
    );
    expect(diff?.changes).toEqual({
      name: 'Roll 2',
      description: 'secreto largo',
      basePrice: '90.00',
      active: false,
    });
    expect(diff?.oldValues).toEqual({ name: 'Roll', basePrice: '85.00', mediaCount: 1 });
    expect(diff?.newValues).toEqual({
      name: 'Roll 2',
      basePrice: '90.00',
      mediaCount: 0,
      changedFields: ['name', 'basePrice', 'description', 'media'],
    });
    expect(JSON.stringify([diff?.oldValues, diff?.newValues])).not.toContain('secreto');
    expect(diff?.hasFieldChanges).toBe(true);
  });
  it('solo active => hasFieldChanges=false', () => {
    const diff = diffProduct(current, currentMedia, normalizeUpdate({ active: false }));
    expect(diff).toMatchObject({ changes: { active: false }, hasFieldChanges: false });
  });
  it('un cambio de orden de imágenes cuenta como cambio; sku null borra', () => {
    const two = [media('https://x.io/a', 0), media('https://x.io/b', 1)];
    const diff = diffProduct(
      current,
      two,
      normalizeUpdate({ sku: null, media: [{ url: 'https://x.io/b' }, { url: 'https://x.io/a' }] }),
    );
    expect(diff?.media).toHaveLength(2);
    expect(diff?.changes).toEqual({ sku: null });
  });
  it('cuerpo vacío => 400', () => {
    expect(status(thrown(() => normalizeUpdate({})))).toBe(400);
  });
});

describe('toAdminView', () => {
  it('publiclyVisible = activo Y categoría visible; media ordenada', () => {
    const category = { id: 'c1', slug: 'c', name: 'C', active: true, effectivelyVisible: false };
    const view = toAdminView(
      product(),
      [media('https://x.io/b', 1), media('https://x.io/a', 0)],
      category,
    );
    expect(view.publiclyVisible).toBe(false);
    expect(view.media.map((m) => m.sortOrder)).toEqual([0, 1]);
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(
      toAdminView(product(), [], { ...category, effectivelyVisible: true }).publiclyVisible,
    ).toBe(true);
  });
});

describe('borrado: isUnused y productInUse (ADR-0035)', () => {
  const body = (e: unknown) =>
    (
      e as { getResponse(): { message: string; code: string; extra: { usage: unknown } } }
    ).getResponse();

  it('isUnused solo con los tres conteos en cero', () => {
    expect(isUnused({ orders: 0, promotions: 0, banners: 0 })).toBe(true);
    expect(isUnused({ orders: 0, promotions: 0, banners: 1 })).toBe(false);
    expect(isUnused({ orders: 0, promotions: 1, banners: 0 })).toBe(false);
    expect(isUnused({ orders: 1, promotions: 0, banners: 0 })).toBe(false);
  });

  it('409 PRODUCT_IN_USE: singular/plural, solo conteos presentes, sugerencia según haya pedidos', () => {
    const one = productInUse({ orders: 1, promotions: 0, banners: 0 });
    expect(one.getStatus()).toBe(409);
    expect(body(one).code).toBe('PRODUCT_IN_USE');
    expect(body(one).message).toBe(
      'El producto está en uso (1 pedido). El historial de pedidos se conserva: desactívalo en su lugar',
    );
    const many = productInUse({ orders: 0, promotions: 2, banners: 1 });
    expect(body(many).message).toBe(
      'El producto está en uso (2 promociones, 1 banner). Quítalo de esas promociones o banners, o desactívalo en su lugar',
    );
    expect(body(many).extra.usage).toEqual({ orders: 0, promotions: 2, banners: 1 });
    expect(body(productInUse({ orders: 4, promotions: 1, banners: 1 })).message).toContain(
      '4 pedidos, 1 promoción, 1 banner',
    );
  });
});

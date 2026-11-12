import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * Arnés de comparación visual (ADR-0007). Abre los prototipos de `docs/references/` por `file://`
 * con TODA la red bloqueada: las fuentes de Google que pide la tienda se sirven desde @fontsource
 * (mismas familias), nada sale a Internet. El reloj se congela en la fecha base de la demo.
 */
const repoRoot = resolve(__dirname, '../../..');

export const PROTOTYPES = {
  store: join(repoRoot, 'docs/references/public-store-prototype.html'),
  backoffice: join(repoRoot, 'docs/references/backoffice-prototype.html'),
} as const;

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const FONT_FILES: Record<string, string> = {
  'archivo-black.woff2': '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2',
  'dela-gothic-one.woff2':
    '@fontsource/dela-gothic-one/files/dela-gothic-one-latin-400-normal.woff2',
  'dm-sans.woff2': '@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2',
};

const LOCAL_FONT_CSS = `
@font-face{font-family:'Archivo Black';font-weight:400;src:url(https://fonts.local/archivo-black.woff2) format('woff2')}
@font-face{font-family:'Dela Gothic One';font-weight:400;src:url(https://fonts.local/dela-gothic-one.woff2) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:100 1000;src:url(https://fonts.local/dm-sans.woff2) format('woff2')}
`;

/** Bloquea toda la red salvo file:// y la app local; sirve fuentes locales. */
export async function isolateNetwork(page: Page, allowOrigin?: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    if (allowOrigin && url.startsWith(allowOrigin)) return route.continue();
    if (url.startsWith('https://fonts.googleapis.com/')) {
      return route.fulfill({ contentType: 'text/css', body: LOCAL_FONT_CSS });
    }
    const local = url.match(/^https:\/\/fonts\.local\/(.+)$/)?.[1];
    if (local && FONT_FILES[local]) {
      return route.fulfill({
        contentType: 'font/woff2',
        body: readFileSync(require.resolve(FONT_FILES[local])),
      });
    }
    return route.abort('blockedbyclient');
  });
}

export interface ScreenOptions {
  theme: 'light' | 'dark';
  viewport: keyof typeof VIEWPORTS;
  /** Fecha fija (ISO) para congelar el reloj en ambas páginas. */
  frozenAt: string;
}

export async function preparePage(page: Page, opts: ScreenOptions, allowOrigin?: string) {
  await page.setViewportSize(VIEWPORTS[opts.viewport]);
  await page.emulateMedia({ colorScheme: opts.theme, reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date(opts.frozenAt) });
  await isolateNetwork(page, allowOrigin);
}

/** Estabiliza la captura: sin animaciones, carets ni scrollbars. */
export async function capture(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide' });
}

export interface DiffResult {
  ratio: number;
  diffPixels: number;
  totalPixels: number;
}

/** Compara dos capturas (se recortan al área común) y adjunta prototipo/app/diff al reporte. */
export async function compareAndAttach(
  name: string,
  prototype: Buffer,
  app: Buffer,
  testInfo: TestInfo,
): Promise<DiffResult> {
  const a = PNG.sync.read(prototype);
  const b = PNG.sync.read(app);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img: PNG) => {
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out;
  };
  const ca = crop(a);
  const cb = crop(b);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold: 0.15 });
  const dir = testInfo.outputPath('visual');
  mkdirSync(dir, { recursive: true });
  const files = {
    prototype: join(dir, `${name}.prototype.png`),
    app: join(dir, `${name}.app.png`),
    diff: join(dir, `${name}.diff.png`),
  };
  writeFileSync(files.prototype, prototype);
  writeFileSync(files.app, app);
  writeFileSync(files.diff, PNG.sync.write(diff));
  for (const [kind, path] of Object.entries(files)) {
    await testInfo.attach(`${name} · ${kind}`, { path, contentType: 'image/png' });
  }
  const ratio = diffPixels / (width * height);
  mkdirSync(dirname(files.diff), { recursive: true });
  return { ratio, diffPixels, totalPixels: width * height };
}

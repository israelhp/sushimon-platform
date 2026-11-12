#!/usr/bin/env node
// Extrae recursos de los prototipos HTML (docs/references) SIN ejecutar su código:
// solo decodifica base64/gzip y recorta texto. Salida en docs/ui/extracted/ (ignorado por git).
// Uso: node scripts/prototype-extract.mjs [outDir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const refs = join(root, 'docs/references');

/** Contenido de un <script type="..."> concreto. */
export function scriptByType(html, type) {
  const re = new RegExp(`<script type="${type.replace(/[/]/g, '\\/')}"[^>]*>([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) throw new Error(`No se encontró <script type="${type}">`);
  return m[1];
}

/** Desempaqueta el bundle del backoffice: manifest (base64[/gzip]) + template (JSON string). */
export function extractBackoffice(html) {
  const manifest = JSON.parse(scriptByType(html, '__bundler/manifest'));
  const template = JSON.parse(scriptByType(html, '__bundler/template'));
  const assets = Object.entries(manifest).map(([uuid, entry]) => {
    let bytes = Buffer.from(entry.data, 'base64');
    if (entry.compressed) bytes = gunzipSync(bytes);
    return { uuid, mime: entry.mime, bytes };
  });
  const styles = [...template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const logic = template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  return { assets, template, styles, logic };
}

/** Separa el bundle Vite de la tienda: script module, CSS e inline head. */
export function extractStore(html) {
  const js = html.match(/<script type="module" crossorigin>([\s\S]*?)<\/script>/)?.[1];
  const css = html.match(/<style rel="stylesheet" crossorigin>([\s\S]*?)<\/style>/)?.[1];
  if (!js || !css) throw new Error('Bundle de la tienda con estructura inesperada');
  const logos = [...js.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) =>
    Buffer.from(m[1], 'base64'),
  );
  return { js, css, logos };
}

function main(outDir = join(root, 'docs/ui/extracted')) {
  const bo = extractBackoffice(readFileSync(join(refs, 'backoffice-prototype.html'), 'utf8'));
  const boDir = join(outDir, 'backoffice');
  mkdirSync(boDir, { recursive: true });
  writeFileSync(join(boDir, 'template.html'), bo.template);
  bo.styles.forEach((css, i) => writeFileSync(join(boDir, `styles-${i}.css`), css));
  writeFileSync(join(boDir, 'logic.js'), bo.logic);
  for (const a of bo.assets) {
    const ext = a.mime === 'font/woff2' ? 'woff2' : 'js';
    writeFileSync(join(boDir, `${a.uuid}.${ext}`), a.bytes);
  }

  const st = extractStore(readFileSync(join(refs, 'public-store-prototype.html'), 'utf8'));
  const stDir = join(outDir, 'store');
  mkdirSync(stDir, { recursive: true });
  writeFileSync(join(stDir, 'bundle.js'), st.js);
  writeFileSync(join(stDir, 'styles.css'), st.css);
  st.logos.forEach((png, i) => writeFileSync(join(stDir, `logo-${i}.png`), png));

  console.log(`prototype-extract: OK → ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv[2]);

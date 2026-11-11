import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { IGNORED, scanText } from './secrets.mjs';

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((f) => !IGNORED.some((re) => re.test(f)));

let total = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue; // archivo borrado pero aún en el índice
  }
  for (const hit of scanText(text)) {
    console.error(`${f}:${hit.line}  ${hit.rule}`);
    total++;
  }
}
if (total) {
  console.error(
    `\nsecrets:scan → ${total} posible(s) secreto(s). Elimínalos y rota la credencial si fue real.`,
  );
  process.exit(1);
}
console.log(`secrets:scan OK (${files.length} archivos revisados)`);

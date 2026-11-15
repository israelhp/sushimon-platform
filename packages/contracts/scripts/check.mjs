// Verifica: (1) los tipos generados están al día; (2) la API implementa exactamente el contrato.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffContracts, loadYaml } from './lib.mjs';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const apiDir = join(pkgDir, '..', '..', 'sushimon-api');
const schemaPath = join(pkgDir, 'src/schema.d.ts');
let failed = false;

// (1) tipos generados al día
const before = readFileSync(schemaPath, 'utf8');
execFileSync('node', [join(pkgDir, 'scripts/generate.mjs')], { stdio: 'ignore' });
if (readFileSync(schemaPath, 'utf8') !== before) {
  console.error('contracts: src/schema.d.ts estaba desactualizado; se regeneró. Súbelo al commit.');
  failed = true;
}

// (2) la API implementa el contrato
const tmp = mkdtempSync(join(tmpdir(), 'sushimon-openapi-'));
try {
  const emitted = join(tmp, 'api-openapi.json');
  // En Windows pnpm es un shim `pnpm.cmd`, que execFileSync no ejecuta sin shell (ENOENT / EINVAL).
  const isWindows = process.platform === 'win32';
  execFileSync(
    isWindows ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'tsx', 'scripts/emit-openapi.ts', emitted],
    {
      cwd: apiDir,
      stdio: 'inherit',
      shell: isWindows,
    },
  );
  const diff = diffContracts(
    loadYaml(join(pkgDir, 'openapi/openapi.yaml')),
    JSON.parse(readFileSync(emitted, 'utf8')),
  );
  if (diff.missingInApi.length) {
    console.error('Contrato sin implementar en la API:', diff.missingInApi);
    failed = true;
  }
  if (diff.undocumented.length) {
    console.error('API con endpoints fuera del contrato:', diff.undocumented);
    failed = true;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('contracts: OK (tipos al día y API conforme al contrato)');

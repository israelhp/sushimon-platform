#!/usr/bin/env node
// PostToolUse: formatea solo el archivo editado (rápido). Los controles completos corren en CI.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { readInput } from './run-hook.mjs';

const input = await readInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const file = input.tool_input?.file_path;
const OK = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.css']);
if (file) {
  const abs = resolve(projectDir, file);
  const rel = relative(projectDir, abs);
  if (
    !rel.startsWith('..') &&
    OK.has(extname(abs)) &&
    existsSync(abs) &&
    !rel.startsWith('docs/references')
  ) {
    try {
      execFileSync('pnpm', ['exec', 'prettier', '--write', '--log-level=silent', abs], {
        cwd: projectDir,
        stdio: 'ignore',
        timeout: 20000,
      });
    } catch {
      /* no bloquear la edición por un fallo de formato */
    }
  }
}
process.exit(0);

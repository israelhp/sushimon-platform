#!/usr/bin/env node
// SessionStart: el stdout se agrega al contexto de la sesión.
import { execFileSync } from 'node:child_process';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const git = (...a) => {
  try {
    return execFileSync('git', a, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(sin repositorio)';
const lines = [`Sushi Mon · rama actual: ${branch}`];
if (['main', 'master'].includes(branch))
  lines.push('ATENCIÓN: main es solo producción. Trabaja en feature/* desde develop (Git Flow).');
if (branch === 'develop')
  lines.push('Estás en develop: crea feature/* para trabajar; develop recibe solo PRs.');
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
if (dirty) lines.push(`Cambios sin commit: ${dirty} archivo(s).`);
lines.push(
  'Reglas: sin push sin autorización · sin secretos · Contract First · ver CLAUDE.md y docs/development/gitflow.md',
);
process.stdout.write(lines.join('\n') + '\n');

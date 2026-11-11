// Lógica pura de los hooks de seguridad (testeable). Los scripts de entrada solo hacen I/O.
// Principio: los hooks son una capa más; la defensa principal son los permisos de settings.json,
// el aislamiento del entorno y la revisión humana. Un regex nunca es el único control.
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** @typedef {{decision: 'allow'|'ask'|'deny', reason?: string}} Verdict */
const allow = { decision: 'allow' };
const ask = (reason) => ({ decision: 'ask', reason });
const deny = (reason) => ({ decision: 'deny', reason });

/** Elimina los cuerpos de heredoc (<<EOF … EOF): son texto, no comandos. */
export function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) end = m[2];
  }
  return out.join('\n');
}

/** Divide un comando shell en segmentos simples y tokeniza respetando comillas básicas. */
export function splitSegments(command) {
  const cleaned = stripHeredocs(command)
    .replace(/\$\(|`/g, ';')
    .replace(/\)/g, ';');
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments.map(tokenize);
}

function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let quote = null;
  for (const c of segment) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) {
      if (cur) tokens.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) tokens.push(cur);
  // Quita asignaciones de entorno y envoltorios comunes al inicio.
  while (
    tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]) ||
      ['sudo', 'env', 'command', 'nohup', 'time', 'exec'].includes(tokens[0]))
  ) {
    tokens.shift();
  }
  return tokens;
}

function gitParts(tokens) {
  // git [-C dir] [-c k=v] [--no-pager ...] <sub> <args>
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1) };
}

const hasFlag = (args, ...flags) => args.some((a) => flags.includes(a));
const PROTECTED = ['main', 'develop', 'master'];

/** @returns {Verdict} */
export function evaluateGit(tokens) {
  const { sub, args } = gitParts(tokens);
  if (!sub) return allow;
  if (hasFlag(args, '--no-verify') || (sub === 'commit' && hasFlag(args, '-n')))
    return deny(
      'Saltar hooks de Git (--no-verify) está prohibido: los quality gates no se omiten.',
    );
  if (sub === 'push') {
    if (
      hasFlag(args, '--force', '-f', '--force-with-lease', '--mirror', '--delete', '-d') ||
      args.some((a) => a.startsWith('+') || a.startsWith('--force'))
    )
      return deny('Force push / borrado remoto prohibido (main y develop están protegidas).');
    return ask('git push publica código: requiere autorización humana explícita.');
  }
  if (sub === 'reset' && hasFlag(args, '--hard', '--merge', '--keep'))
    return deny('git reset --hard descarta trabajo: pídelo al usuario.');
  if (sub === 'clean' && args.some((a) => /^-[a-z]*[fdx]/.test(a) || a === '--force'))
    return deny('git clean elimina archivos sin versionar.');
  if (sub === 'checkout' && (args.includes('.') || (args.includes('--') && args.includes('.'))))
    return deny('Descartar cambios en bloque está prohibido.');
  if (sub === 'restore' && args.includes('.'))
    return deny('Descartar cambios en bloque está prohibido.');
  if (
    sub === 'branch' &&
    hasFlag(args, '-D', '--delete', '-d') &&
    args.some((a) => PROTECTED.includes(a))
  )
    return deny('No se eliminan ramas protegidas (main/develop).');
  if (sub === 'branch' && hasFlag(args, '-D'))
    return ask('git branch -D elimina una rama aunque no esté integrada.');
  if (sub === 'tag' && hasFlag(args, '-d', '--delete'))
    return ask('Eliminar tags requiere confirmación.');
  if (['filter-branch', 'filter-repo'].includes(sub))
    return deny('Reescribir historial está prohibido.');
  if (sub === 'reflog' && args.includes('expire')) return deny('No se purga el reflog.');
  if (sub === 'gc' && args.some((a) => a.startsWith('--prune=now')))
    return deny('No se purga el repositorio.');
  if (sub === 'update-ref' && hasFlag(args, '-d')) return deny('No se eliminan refs manualmente.');
  if (sub === 'rebase' || (sub === 'commit' && hasFlag(args, '--amend')))
    return ask('Reescribe historial: confirma que no está publicado.');
  return allow;
}

function insideProject(p, projectDir) {
  const abs = resolve(projectDir, p.replace(/^~(?=$|\/)/, homedir()));
  const rel = relative(projectDir, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** @returns {Verdict} */
export function evaluateBash(command, { projectDir }) {
  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(command))
    return deny('Ejecutar scripts remotos por pipe a shell está prohibido.');
  if (/\b(drop\s+(database|schema|table)|truncate\s+table)\b/i.test(command))
    return deny('SQL destructivo en línea de comandos: usa una migración revisada.');

  let verdict = allow;
  for (const t of splitSegments(command)) {
    if (!t.length) continue;
    const cmd = basename(t[0]);
    let v = allow;
    if (cmd === 'git') v = evaluateGit(t);
    else if (cmd === 'rm') {
      const recursive = t.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
      const targets = t.slice(1).filter((a) => !a.startsWith('-'));
      if (
        recursive &&
        targets.some((p) => p === '*' || p === '.' || p === '/' || !insideProject(p, projectDir))
      )
        v = deny('rm recursivo fuera del repositorio (o sobre su raíz) está prohibido.');
    } else if (
      ['cat', 'less', 'more', 'head', 'tail', 'cp', 'mv', 'scp', 'base64', 'source', '.'].includes(
        cmd,
      )
    ) {
      const args = t.slice(1).filter((a) => !a.startsWith('-'));
      // cp/mv: el último argumento es el destino (copiar HACIA .env es legítimo); el resto son orígenes.
      const sources = ['cp', 'mv', 'scp'].includes(cmd) ? args.slice(0, -1) : args;
      if (sources.some((a) => /(^|\/)\.env(\.[^/]*)?$/.test(a) && !a.endsWith('.env.example')))
        v = deny('Los archivos .env contienen secretos: no se leen ni copian desde comandos.');
    } else if (cmd === 'prisma' || ((cmd === 'pnpm' || cmd === 'npx') && t.includes('prisma'))) {
      if (t.includes('migrate') && t.some((a) => ['reset', 'deploy'].includes(a)))
        v = deny('Migraciones destructivas/de producción requieren aprobación humana.');
      if (t.includes('db') && t.includes('push'))
        v = ask('prisma db push modifica la base de datos directamente.');
    } else if (cmd === 'supabase' || t.includes('supabase')) {
      if (
        (t.some((a) => ['reset', 'push', 'repair'].includes(a)) && t.includes('db')) ||
        (t.includes('migration') && t.includes('repair'))
      )
        v = deny('Operaciones de migración sobre Supabase requieren aprobación humana.');
    } else if (['vercel', 'gh'].includes(cmd)) {
      if (cmd === 'vercel' && (t.includes('--prod') || t.includes('deploy') || t.includes('env')))
        v = ask('Despliegue/variables en Vercel: requiere autorización explícita.');
      if (
        cmd === 'gh' &&
        ((t.includes('release') && t.includes('create')) ||
          t.includes('merge') ||
          (t[1] === 'api' && t.some((a) => /^(-X|--method)$/.test(a))))
      )
        v = ask('Acción remota en GitHub: requiere autorización explícita.');
    }
    if (v.decision === 'deny') return v;
    if (v.decision === 'ask') verdict = v;
  }
  return verdict;
}

const SECRET_NAME = /(^|\/)(\.env(\.(?!example$)[^/]+)?|id_rsa[^/]*|[^/]+\.(pem|key|p12|pfx))$/;
const PROTECTED_FILES = [
  'docs/references/monsushi_dbdiagram.dbml',
  'docs/references/backoffice-prototype.html',
  'docs/references/public-store-prototype.html',
  'docs/references/SHA256SUMS',
  'pnpm-lock.yaml',
];

/** @returns {Verdict} */
export function evaluateFileWrite(input, { projectDir }) {
  const filePath = input.file_path ?? input.notebook_path;
  if (!filePath) return allow;
  const abs = resolve(projectDir, filePath);
  if (!insideProject(abs, projectDir)) return deny('Escritura fuera del repositorio.');
  const rel = relative(projectDir, abs).split(sep).join('/');
  if (rel === '.git' || rel.startsWith('.git/')) return deny('No se edita .git directamente.');
  if (SECRET_NAME.test(rel))
    return deny(
      'Archivos de secretos/credenciales: edítalos tú mismo; usa .env.example para plantillas.',
    );
  if (PROTECTED_FILES.includes(rel))
    return deny(
      `${rel} es línea base inmutable: documenta brechas en docs/ en lugar de modificarlo (el lockfile solo lo cambia pnpm).`,
    );
  if (rel === '.claude/settings.json')
    return ask('Cambia la configuración de seguridad de Claude Code.');
  if (/(^|\/)migrations\/.*\.sql$/.test(rel)) {
    const text = [input.content, input.new_string].filter(Boolean).join('\n');
    if (/\b(drop\s+(table|schema|column|database)|truncate|delete\s+from\s+\S+\s*;)/i.test(text))
      return ask(
        'La migración contiene operaciones destructivas: requiere revisión humana (database-engineer + aprobación).',
      );
  }
  return allow;
}

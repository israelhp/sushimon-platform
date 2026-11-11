// Valida la configuración de Claude Code: frontmatter de agentes/skills/rules y referencias de settings.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

const root = process.argv[2] ?? process.cwd();
const errors = [];
const frontmatter = (file) => {
  const m = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('sin frontmatter');
  return parse(m[1]);
};
const check = (kind, name, fn) => {
  try {
    fn();
  } catch (e) {
    errors.push(`${kind} ${name}: ${e.message.split('\n')[0]}`);
  }
};

for (const f of readdirSync(`${root}/.claude/agents`)) {
  check('agente', f, () => {
    const d = frontmatter(`${root}/.claude/agents/${f}`);
    if (d.name + '.md' !== f) throw new Error('name no coincide con el archivo');
    if (!d.description) throw new Error('falta description');
    if (!d.tools) throw new Error('falta tools');
  });
}
for (const d of readdirSync(`${root}/.claude/skills`)) {
  check('skill', d, () => {
    const file = `${root}/.claude/skills/${d}/SKILL.md`;
    if (!existsSync(file)) throw new Error('falta SKILL.md');
    const y = frontmatter(file);
    if (y.name !== d) throw new Error('name no coincide con la carpeta');
    if (!y.description) throw new Error('falta description');
  });
}
const skillNames = new Set(readdirSync(`${root}/.claude/skills`));
for (const f of readdirSync(`${root}/.claude/agents`)) {
  check('agente', f, () => {
    for (const s of frontmatter(`${root}/.claude/agents/${f}`).skills ?? []) {
      if (!skillNames.has(s)) throw new Error(`skill inexistente: ${s}`);
    }
  });
}
for (const f of readdirSync(`${root}/.claude/rules`)) {
  check('rule', f, () => {
    if (!Array.isArray(frontmatter(`${root}/.claude/rules/${f}`).paths))
      throw new Error('paths debe ser lista');
  });
}
check('settings', 'settings.json', () => {
  const s = JSON.parse(readFileSync(`${root}/.claude/settings.json`, 'utf8'));
  for (const groups of Object.values(s.hooks ?? {})) {
    for (const g of groups) {
      for (const h of g.hooks) {
        const m = h.command.match(/\/\.claude\/hooks\/([\w.-]+\.mjs)/);
        if (m && !existsSync(`${root}/.claude/hooks/${m[1]}`))
          throw new Error(`hook inexistente: ${m[1]}`);
      }
    }
  }
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('claude:validate OK (agentes, skills, rules, settings)');

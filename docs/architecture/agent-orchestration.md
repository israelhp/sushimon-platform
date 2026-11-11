# Orquestación de agentes (Claude Code)

La **sesión principal es el orquestador**: interpreta la solicitud, identifica el dominio, consulta
specs, decide qué agentes participan, delega trabajo independiente, integra resultados, verifica
contratos y ejecuta quality gates. No se usan todos los agentes en cada tarea ni se encadenan sin necesidad.

| Agente                 | Modo                              | Cuándo                                         |
| ---------------------- | --------------------------------- | ---------------------------------------------- |
| `solution-architect`   | edita docs/specs                  | Antes de un slice no trivial; ADRs; contratos  |
| `api-engineer`         | edita                             | Código NestJS                                  |
| `web-engineer`         | edita                             | Código Next.js / Mock Data                     |
| `database-engineer`    | edita docs/migraciones propuestas | Modelo, índices, migraciones                   |
| `qa-engineer`          | edita pruebas                     | Cobertura de criterios, regresión, contrato    |
| `security-reviewer`    | **solo lectura**                  | Auth, pagos, datos sensibles, endpoints nuevos |
| `ui-ux-reviewer`       | **solo lectura**                  | Fidelidad al prototipo, accesibilidad          |
| `performance-reviewer` | **solo lectura**                  | Listados, consultas, caché                     |

Definiciones en `.claude/agents/` (`model: inherit`). Los revisores tienen únicamente `Read, Grep, Glob`:
reportan hallazgos con `archivo:línea`; el orquestador decide qué se corrige.

## Capas de control

1. `CLAUDE.md` (conciso) + `.claude/rules/` por ruta + `.claude/skills/` (procedimientos).
2. `permissions` en `.claude/settings.json` (allow/ask/deny).
3. Hooks (`.claude/hooks/`): `guard-bash`, `guard-files` (PreToolUse), `format-on-edit` (PostToolUse),
   `session-start`. Bloquean/preguntan por: push, force push, `reset --hard`, `clean`, `--no-verify`,
   `rm -r` fuera del repo, lectura de `.env`, SQL/migraciones destructivas, edición de la línea base,
   del lockfile y de secretos. Pruebas: `pnpm test:hooks`.
4. Husky + commitlint + CI. Los hooks son una capa más: **no son un sandbox**; la protección real es
   permisos + aprobación humana + protección de ramas remotas.

## Spec Kit

Skills `speckit-*` gestionadas por Spec Kit (no editar). Constitución en `.specify/memory/constitution.md`.
Spec Kit 1.4.0 instalado con `specify init --here --integration claude --script sh`; sus scripts no
crean ramas Git, por lo que no chocan con Git Flow (las ramas las crea el equipo: `feature/*`).

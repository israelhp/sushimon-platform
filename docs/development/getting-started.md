# Primeros pasos

Requisitos: Node ≥ 22.12 (probado con 24), pnpm 10 (`corepack enable`). Opcional: `gh`, Claude Code.

```bash
pnpm install                       # instala y activa Husky
cp sushimon-api/.env.example sushimon-api/.env
cp sushimon-web/.env.example sushimon-web/.env.local
pnpm dev:api                       # http://localhost:3001/v1/health
pnpm dev:web                       # http://localhost:3000 y /backoffice
pnpm check                         # todos los quality gates
```

Estructura y estado: `docs/architecture/overview.md`. Instrucciones de agentes: `CLAUDE.md`.
Spec Kit: ya integrado en `.specify/` y `.claude/skills/speckit-*`; el CLI `specify` solo se necesita para actualizar la integración.
Para trabajar: `git switch develop && git switch -c feature/<nombre>`.

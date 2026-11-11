# Sushi Mon Platform

Plataforma de pedidos de **Sushi Mon** (Guatemala · GTQ · 3→5 sucursales · es/en): tienda pública + backoffice (Next.js)
y API centralizada (NestJS + Supabase). Monorepo pnpm.

> **Estado: Etapa 0 (bootstrap).** Existen los cimientos (monorepo, calidad, agentes, contratos, documentación) y un único
> endpoint real, `GET /v1/health`. Las pantallas de los prototipos, la autenticación, la base de datos y las integraciones
> con PedidosYa y Neonet **aún no están implementadas**.

```text
sushimon-api/        NestJS 12 (Express) · OpenAPI · Vitest
sushimon-web/        Next.js 16 · React 19 · Tailwind 4 — tienda (public) + backoffice
packages/contracts/  OpenAPI canónico + tipos TS generados
docs/                arquitectura, base de datos, UI, integraciones, seguridad, ADRs, referencias
specs/ .specify/     Spec Kit (spec-driven development)
.claude/             agentes, skills, rules y hooks de Claude Code
```

## Empezar

```bash
pnpm install
pnpm dev:api      # http://localhost:3001/v1/health
pnpm dev:web      # http://localhost:3000  ·  /backoffice
pnpm check        # format, lint, typecheck, tests, contrato, secretos, build
```

Más: [`docs/development/getting-started.md`](docs/development/getting-started.md) ·
[`docs/architecture/overview.md`](docs/architecture/overview.md) · [`CLAUDE.md`](CLAUDE.md).

## Cómo trabajamos

UI First + Contract First + Vertical Slice ([metodología](docs/architecture/development-methodology.md)) · Git Flow
([guía](docs/development/gitflow.md)) · Conventional Commits · agentes Claude Code
([orquestación](docs/architecture/agent-orchestration.md)).

Próxima fase: `feature/ui-first-mock-platform` desde `develop` ([plan de pantallas](docs/ui/screen-implementation-plan.md)).

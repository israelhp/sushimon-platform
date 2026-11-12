# Sushi Mon Platform

Plataforma de pedidos de **Sushi Mon** (Guatemala, GTQ, 3→5 sucursales, ~100 pedidos/día, es/en).
Monorepo pnpm con dos apps y un paquete de contratos:

| Ruta                 | Qué es                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `sushimon-api/`      | NestJS (Express), monolito modular, OpenAPI, Supabase (PostgreSQL + Auth)                    |
| `sushimon-web/`      | Next.js App Router: tienda pública `(public)` + backoffice `(backoffice)` — **una sola app** |
| `packages/contracts` | OpenAPI canónico + tipos TS generados (`pnpm contracts:generate`)                            |
| `docs/`, `specs/`    | Arquitectura, ADRs, referencias, especificaciones (Spec Kit)                                 |

Estado real: **Etapa 1 (UI First) completada con datos simulados** en `sushimon-web` (tienda +
backoffice, estado `MOCK_ONLY`). La API solo tiene `GET /v1/health`; el resto de endpoints están
planificados en `docs/contracts/planned-endpoints.md`. Lee `docs/architecture/overview.md` para el
mapa completo.

## Fuentes de verdad (no se editan)

- `docs/references/monsushi_dbdiagram.dbml` — línea base relacional. Se evoluciona con migraciones + ADR.
- `docs/references/backoffice-prototype.html`, `public-store-prototype.html` — referencia visual/funcional.
  Son bundles: **no copiar su código**. Inventario en `docs/ui/prototype-inventory.md`.
  Para inspeccionarlos sin ejecutarlos: skill `prototype-analysis`.

## Metodología: UI First + Contract First + Vertical Slice

1. **UI First**: pantallas con Mock Data tipada tras `lib/data-access` (adaptador mock/http). Sin red externa.
2. **Contract First**: editar `packages/contracts/openapi/openapi.yaml` ANTES de implementar; `pnpm contracts:check`.
3. **Vertical Slice**: spec → contrato → datos → API → web → pruebas → PR. Estados: `MOCK_ONLY`,
   `CONTRACT_DEFINED`, `API_IMPLEMENTED`, `INTEGRATED`, `VERIFIED`, `BLOCKED_EXTERNAL`.

Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-implement` → `/speckit-converge`. La constitución está en `.specify/memory/constitution.md`.

## Reglas de seguridad (resumen; detalle en `.claude/rules/security.md`)

- Autorización solo en el servidor. Google OAuth ≠ acceso al backoffice (usuario interno + rol + sucursal).
- Nada de secretos en el repo/cliente/logs. Nunca guardar CVV/PIN/PAN. `localStorage` no es auth.
- **No** `git push`, releases, despliegues, migraciones destructivas ni llamadas reales a PedidosYa/Neonet
  sin autorización explícita. Los hooks lo refuerzan, pero no dependas de ellos.
- PedidosYa y Neonet: integraciones **pendientes de documentación y credenciales**. No inventar
  endpoints, payloads ni estados. Ver `docs/integrations/`.

## Agentes (orquestador = esta sesión)

`solution-architect`, `api-engineer`, `web-engineer`, `database-engineer`, `security-reviewer`,
`qa-engineer`, `ui-ux-reviewer`, `performance-reviewer`. Delega solo trabajo independiente y
acotado; no encadenes agentes sin necesidad. Los revisores son de solo lectura: reportan, no editan.
Ver `docs/architecture/agent-orchestration.md`.

## Git Flow

`main` (producción) · `develop` (integración) · `feature/*`, `fix/*` desde `develop` · `release/*` →
`main`+`develop` · `hotfix/*` desde `main`. Conventional Commits (`feat(web): …`). PRs, nunca merge
directo. Ver `docs/development/gitflow.md`.

## Comandos

```bash
pnpm install            # reproducible (lockfile)
pnpm dev:api            # http://localhost:3001  (health: /v1/health)
pnpm dev:web            # http://localhost:3000
pnpm check              # format, lint, typecheck, test, contracts, secretos, build
```

## Definition of Done

Spec/criterios cumplidos · contrato actualizado y verificado · pruebas (con regresión si es bug) ·
`pnpm check` verde · sin secretos · autorización por rol/sucursal verificada · UI comparada con el
prototipo (si aplica) · docs que distingan implementado/simulado/pendiente · PR hacia `develop`.

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
backoffice, estado `MOCK_ONLY`). La API (F00 `specs/002-api-foundations`, F01 `specs/003-auth-supabase`) expone `GET /v1/health`, `GET /v1/health/ready`, `GET /v1/auth/context` y `GET /v1/me` sobre Prisma 7 + esquema `app` con JWT de Supabase Auth (denegar por defecto); el resto de endpoints están
planificados en `docs/contracts/planned-endpoints.md`. Desde entonces F00–F09 se trabajaron y fusionaron en `develop`, pero su estado oficial es `NOT_VERIFIED` hasta auditarlas
(`docs/BACKLOG.md`, `docs/AUDITORIA_F00_F09.md`). Lee `docs/architecture/overview.md` para el mapa completo.

## Backlog y ejecución controlada (una feature por petición)

- Backlog oficial de 41 features (F00–F40): `docs/BACKLOG.md` (fichas por feature). Proceso: `docs/FEATURE-WORKFLOW.md`. Auditoría de F00–F09: `docs/AUDITORIA_F00_F09.md`. Se **consultan bajo demanda**; no se copian aquí.
- **Leer no significa ejecutar:** implementar **solo la feature FXX pedida expresamente** en la petición actual. No avanzar a otra al terminar, ni implementar dependientes para resolver una dependencia: usar el contrato acordado, un adaptador seguro o documentar el bloqueo.
- Antes de codificar: rama y `git status`, `origin/develop` y PRs/migraciones sin fusionar, ficha FXX del backlog (dueño, tipo, dependencias, límites), su spec en `specs/` y lo que ya existe en el código. Estado de F00–F09 = `NOT_VERIFIED` hasta auditar.
- Estados de feature: `NOT_VERIFIED`, `NOT_STARTED`, `IN_PROGRESS`, `READY`, `MOCK_READY`, `BLOCKED_EXTERNAL`. `READY` exige código real, contrato, integración Next.js (si la ficha es API + WEB), BD, seguridad y pruebas; Mock Data no es `READY`. Excepciones: F00/F39 (infraestructura) y F18 (frontend principal).
- Antes de F10 o posterior debe existir una auditoría reciente de F00–F09 (solo lectura). Si no, avisar y pedirla; **auditar no autoriza reparar ni continuar**.
- PedidosYa Courier real = `BLOCKED_EXTERNAL` (cobertura `UNKNOWN` si no se verifica); zonas propias (`OWN`) con `ownDeliveryZonesEnabled=false` por defecto; un mock nunca confirma entregas reales.
- Dos computadoras: una feature y una rama (`feature/*`) por máquina, PR independientes hacia `develop`; antes de empezar `git fetch` y revisar contratos, `schema.prisma` y migraciones de `origin/develop` (numerar la migración siguiente a la última de `develop`); no cambiar la BD compartida ni editar `docs/BACKLOG.md` en ramas de feature sin coordinación.

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
pnpm dev                # API y web a la vez (3001 y 3000)
pnpm dev:api            # http://localhost:3001  (health: /v1/health)
pnpm dev:web            # http://localhost:3000
pnpm check              # format, lint, typecheck, test, contracts, secretos, build
```

## Definition of Done

Spec/criterios cumplidos · contrato actualizado y verificado · pruebas (con regresión si es bug) ·
`pnpm check` verde · sin secretos · autorización por rol/sucursal verificada · UI comparada con el
prototipo (si aplica) · docs que distingan implementado/simulado/pendiente · PR hacia `develop`.

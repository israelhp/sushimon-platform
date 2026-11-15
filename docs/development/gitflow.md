# Git Flow

Git Flow **tradicional** (no GitHub Flow).

| Rama                 | Propósito                                                | Origen           | Destino            |
| -------------------- | -------------------------------------------------------- | ---------------- | ------------------ |
| `main`               | Producción y versiones publicadas (solo código aprobado) | release / hotfix | Producción         |
| `develop`            | Integración                                              | `main` inicial   | Próximo release    |
| `feature/*`, `fix/*` | Funcionalidades / correcciones ordinarias                | `develop`        | `develop`          |
| `release/x.y.z`      | Estabilización                                           | `develop`        | `main` y `develop` |
| `hotfix/x.y.z`       | Correcciones urgentes                                    | `main`           | `main` y `develop` |

Ejemplos: `feature/ui-first-mock-platform`, `feature/google-oauth`, `feature/catalog-api`, `feature/orders-checkout`,
`feature/courier-pedidosya`, `feature/payments-neonet`, `fix/checkout-validation`, `release/0.1.0`, `hotfix/1.0.1`.

## Feature

1. `git switch develop` (y `git pull` si hay remoto) → `git switch -c feature/<nombre>`.
2. Implementar; `pnpm check`.
3. PR hacia `develop` (plantilla en `.github/`); revisión; CI verde; merge; borrar rama.
   Nada ordinario va directo a `main`.

## Dos computadoras en paralelo

Cada computadora trabaja **una feature en su propia rama** (`feature/*`) con un PR independiente hacia `develop`; la fuente de integración es GitHub.

1. Pedir la feature por nombre: «Implementa F10». Claude consulta `docs/BACKLOG.md` (ficha FXX) y `docs/FEATURE-WORKFLOW.md`, implementa solo esa y se detiene.
2. Antes de empezar: `git fetch`, crear la rama desde `develop` actualizada y revisar en `origin/develop` los contratos (`openapi.yaml`), `schema.prisma` y las migraciones nuevas.
3. **Migraciones**: la siguiente migración es `última de origin/develop + 1`. Si la otra computadora tiene una en curso, acordar el número antes (ver `0008`/`0009`). No se aplican a la BD compartida sin coordinación.
4. Contratos compartidos (`openapi.yaml`, `schema.d.ts`) y `docs/BACKLOG.md`: cambiarlos en una sola rama a la vez; antes del PR, fusionar `develop` y regenerar los tipos en lugar de resolver `schema.d.ts` a mano.
5. Numeración documental (ADR, `specs/NNN`): comprobar en `origin/develop` el siguiente número libre antes de crearlo.

## Release

`release/x.y.z` desde `develop`: solo correcciones, config, docs y validaciones. Luego: PR a `main` → tag `vX.Y.Z`
(SemVer) → PR de vuelta a `develop` → verificar sincronización → borrar rama.

## Hotfix

Desde `main` → verificar → PR a `main` → tag de parche → incorporar a `develop` **y** al release abierto (para no perderlo).

## Estado inicial (este bootstrap)

Bootstrap sobre `main` → commit `chore: initialize sushimon platform architecture` → `develop` creada desde ese commit y
dejada como rama activa. No hay `release/*` ni `hotfix/*`. **Sin push** (no hay remoto configurado).

## Protección de ramas (⏳ requiere permisos/plan de GitHub; documentado, no aplicado)

Configurar en GitHub (Rulesets o Branch protection) para `main` y `develop`: PR obligatorio, ≥1 revisión, checks
requeridos (`Quality gates`, `Conventional Commits`, `branch-rules`), sin force push, sin borrado, conversaciones resueltas.
`main` además: solo desde `release/*`/`hotfix/*` (lo valida el workflow `Git Flow`).

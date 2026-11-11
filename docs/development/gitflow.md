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

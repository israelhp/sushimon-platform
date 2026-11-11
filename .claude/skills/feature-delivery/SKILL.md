---
name: feature-delivery
description: 'Flujo extremo a extremo para entregar una funcionalidad (spec → contrato → implementación → PR). Úsala al iniciar o planificar cualquier feature.'
---

# Entrega de funcionalidades

1. Rama `feature/<nombre>` desde `develop` (skill `git-pr-workflow`).
2. `/speckit-specify` → `/speckit-clarify` → revisar prototipo y DBML (skills `prototype-analysis`, `database-integrity`).
3. Contrato OpenAPI primero (`contract-first-development`).
4. `/speckit-plan` y `/speckit-tasks`; marcar estado de integración del slice.
5. Implementar el slice (`vertical-slice-development`); delegar solo trabajo independiente a agentes.
6. `pnpm check` verde; revisión por `security-reviewer`/`ui-ux-reviewer`/`performance-reviewer` según el riesgo.
7. `/speckit-converge`, actualizar docs y abrir PR a `develop` (plantilla en `.github/`).

## Aceptación

Criterios de la spec cumplidos con pruebas reales · estado de integración actualizado · DoD de `CLAUDE.md`.
No usar todos los agentes para todo: elige los mínimos necesarios.

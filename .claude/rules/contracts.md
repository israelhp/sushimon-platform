---
paths:
  - 'packages/contracts/**'
  - 'docs/contracts/**'
---

# Reglas: contracts

- `openapi.yaml` es canónico; `src/schema.d.ts` es generado (`pnpm contracts:generate`), no se edita.
- Cada operación: `operationId`, respuestas de error (`ErrorResponse`), seguridad, paginación y filtros explícitos.
- Cambios incompatibles → nueva versión de ruta + ADR. Verificar con `pnpm contracts:check`.

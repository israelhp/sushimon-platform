# Contratos

Canónico: `packages/contracts/openapi/openapi.yaml` (OpenAPI 3.0.3). Tipos generados: `packages/contracts/src/schema.d.ts`.

Estado (✅): solo `GET /v1/health`. Verificación: `pnpm contracts:check` regenera tipos y compara las operaciones del contrato
(método, ruta, `operationId`, códigos de respuesta) con el OpenAPI que emite NestJS; falla si divergen.
Limitación conocida: la comparación es estructural de operaciones, **no** de esquemas de payload; ampliarla al estabilizar slices.

Uso desde la web: `import type { paths, components } from '@sushimon/contracts'`.
Versionado: rutas `/v1`; incompatibles ⇒ `/v2` + ADR. Skill: `api-contracts`.

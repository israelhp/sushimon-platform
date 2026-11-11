---
name: api-contracts
description: 'Diseño y mantenimiento del contrato OpenAPI y los tipos generados. Úsala al crear o cambiar endpoints.'
---

# Contratos de API

Archivo canónico: `packages/contracts/openapi/openapi.yaml` (OpenAPI 3.0.3). Tipos: `src/schema.d.ts` (generado).

## Checklist por operación

Ruta bajo `/v1` · `operationId` único camelCase · request/response schemas · errores 400/401/403/404/409
con `ErrorResponse` · seguridad (`bearer`) · paginación (`page`,`pageSize` o cursor) · filtros · ordenación
· `Idempotency-Key` en mutaciones de pedido/pago · estados de negocio como enums documentados.

## Flujo

Editar YAML → `pnpm contracts:generate` → implementar → `pnpm contracts:check` (falla si la API diverge)
→ commit del YAML **y** `schema.d.ts`. Cambios incompatibles: `/v2` + ADR.

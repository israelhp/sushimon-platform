---
name: vertical-slice-development
description: 'Rutina Vertical Slice: integrar una funcionalidad completa de spec a PR. Úsala en las Etapas 3–4.'
---

# Vertical Slice

Spec → contrato → modelo de datos/migración propuesta → API → integración web (cambiar servicio de
mock a http) → retirar dependencia del mock en ese flujo → pruebas → validación visual → docs → PR.

## Estados de integración

`MOCK_ONLY → CONTRACT_DEFINED → API_IMPLEMENTED → INTEGRATED → VERIFIED` (o `BLOCKED_EXTERNAL`).
No marcar `VERIFIED` sin prueba de integración real; la convergencia de la spec no la sustituye.
Ejemplo: “consultar catálogo por sucursal” (UI mock → OpenAPI → endpoint → hook → pruebas).

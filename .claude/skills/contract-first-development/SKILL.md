---
name: contract-first-development
description: 'Rutina Contract First: del requisito al OpenAPI y cliente tipado. Úsala antes de integrar cada slice.'
---

# Contract First

Requisitos → diseñar OpenAPI (skill `api-contracts`) → validar tipos/errores/paginación/idempotencia →
`pnpm contracts:generate` → revisar compatibilidad con la UI mock → implementar API →
`pnpm contracts:check`. El contrato sirve también para pruebas y simuladores (mocks derivados).

No crear endpoints ficticios para “completar” el bootstrap. Un endpoint sin contrato no se mergea.

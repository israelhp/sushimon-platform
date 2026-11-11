---
paths:
  - 'sushimon-api/**'
---

# Reglas: backend

- NestJS modular por dominio; controladores delgados; lógica en servicios.
- Todo endpoint existe antes en `packages/contracts/openapi/openapi.yaml` (mismo `operationId`).
- DTOs validados (`class-validator`); errores vía `AllExceptionsFilter`; prefijo `/v1`.
- Dinero con aritmética exacta; operaciones de pedido/pago idempotentes y auditadas.
- Imports relativos con extensión `.js` (ESM).

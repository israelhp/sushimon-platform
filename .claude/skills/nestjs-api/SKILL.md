---
name: nestjs-api
description: 'Convenciones NestJS del proyecto: módulos, controladores, DTOs, servicios, transacciones, errores y pruebas. Úsala al escribir código en sushimon-api.'
---

# NestJS API

Reglas base: `.claude/rules/backend.md` y `sushimon-api/CLAUDE.md`.

## Pasos para un endpoint

1. Confirmar que existe en `openapi.yaml` (mismo `operationId`, códigos, `ErrorResponse`).
2. DTO con `class-validator` + `@ApiProperty`; respuesta tipada.
3. Controller delgado → Service con la regla de negocio → acceso a datos (transacción si hay >1 escritura).
4. Guard de auth + permiso + alcance de sucursal (cuando exista el slice de auth); denegar por defecto.
5. Pruebas: unit del service, e2e del endpoint (supertest); casos 400/401/403/404.
6. `pnpm --filter sushimon-api test lint typecheck && pnpm contracts:check`.

## Criterios

Sin lógica en controladores · sin `any` · sin servicios gigantes · errores sin detalles internos ·
idempotencia en mutaciones de dinero · logs sin PII.

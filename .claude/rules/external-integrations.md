---
paths:
  - 'docs/integrations/**'
  - '**/delivery/**'
  - '**/payments/**'
  - '**/*pedidosya*'
  - '**/*neonet*'
---

# Reglas: external-integrations

- PedidosYa Courier y Neonet están **pendientes de documentación, credenciales y sandbox**: no inventar endpoints, payloads ni estados.
- Siempre tras interfaz (`DeliveryProvider`, `PaymentGateway`) con adaptador mock explícito.
- Idempotencia, reintentos acotados, verificación de webhooks, auditoría de eventos externos.
- Estados documentales: PLANNED, AWAITING_DOCUMENTATION, AWAITING_SANDBOX, MOCK_READY, IN_DEVELOPMENT, SANDBOX_VERIFIED, PRODUCTION_APPROVED.

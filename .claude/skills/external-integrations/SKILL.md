---
name: external-integrations
description: 'Rutina de proveedores externos (PedidosYa, Neonet, WhatsApp). Úsala al diseñar o implementar integraciones.'
---

# Integraciones externas

Revisar documentación oficial → definir interfaz/adaptador → mock → sandbox → seguridad → producción
bajo aprobación. Estado actual en `docs/integrations/README.md`.

- Estados documentales: PLANNED, AWAITING_DOCUMENTATION, AWAITING_SANDBOX, MOCK_READY, IN_DEVELOPMENT,
  SANDBOX_VERIFIED, PRODUCTION_APPROVED (distintos de estados de pago/pedido/envío).
- Idempotencia, reintentos con backoff, timeouts, verificación de firmas de webhook, auditoría de eventos.
- El proveedor no define entidades de dominio; se traduce en el adaptador.
- Nunca inventar endpoints, payloads o estados; sin credenciales reales en el repo.

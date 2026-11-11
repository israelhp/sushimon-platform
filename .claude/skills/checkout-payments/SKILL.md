---
name: checkout-payments
description: 'Checkout y pagos (efectivo, transferencia, tarjeta vía Neonet pendiente). Úsala al tocar carrito, checkout, pagos o reembolsos.'
---

# Checkout y pagos

Estado: Neonet = **AWAITING_DOCUMENTATION**. Docs: `docs/integrations/neonet/README.md`.

## Principios

- Distinguir método de pago, estado de pago y estado de pedido (pagado ≠ aceptado ≠ entregado).
- La API recalcula precios, promociones y envío; el cliente solo envía intención.
- Idempotencia (`Idempotency-Key`) y `idempotency` en `app.payments`; reembolsos auditados.
- Nunca almacenar CVV/PIN/PAN; preferir componentes alojados/tokenización del procesador.
- Mock: simular aprobación, rechazo, cancelación y error con insignia “Pago simulado”; sin cargos reales.
- No inventar endpoints/payloads de Neonet. Validar suficiencia del modelo (`schema-gap-analysis.md`).

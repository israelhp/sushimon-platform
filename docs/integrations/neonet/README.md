# Neonet (pagos con tarjeta)

**Estado**: `AWAITING_DOCUMENTATION` (pendiente de documentación técnica, credenciales y ambiente).

## Propósito

Cobro con tarjeta de crédito/débito. Otros métodos: efectivo y transferencia bancaria (sin proveedor).

## Arquitectura prevista (📐)

`PaymentApplicationService → PaymentMethod → { Cash, Transfer, Card → NeonetAdapter }`. El dominio distingue
**método de pago**, **estado de pago** y **estado de pedido** (pagado ≠ aceptado ≠ entregado).

## A confirmar con la documentación oficial (no asumido)

Inicio de transacción · referencia del proveedor · confirmación/rechazo · cancelación · reembolsos (parciales) ·
autorización vs. captura · conciliación · webhooks/verificación · idempotencia · componentes alojados o tokenización.

## Seguridad (obligatorio)

Nunca almacenar CVV, PIN ni PAN completo; preferir flujo alojado/tokenización si el procesador lo ofrece; sin cargos
reales fuera de producción aprobada; registrar errores sin datos sensibles.

## Simulación actual

UI First: pago **simulado** (aprobado, rechazado, cancelado, error) con insignia “Pago simulado”. El prototipo pide datos
de tarjeta de forma demostrativa: en la implementación real **no** se capturarán en la app.

Brechas de modelo: `docs/database/schema-gap-analysis.md` §C.

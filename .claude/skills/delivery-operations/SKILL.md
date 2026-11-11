---
name: delivery-operations
description: 'Operación de entregas: repartidores propios y PedidosYa Courier (pendiente). Úsala al tocar despacho, repartidores o seguimiento.'
---

# Operaciones de entrega

Estado: PedidosYa = **AWAITING_DOCUMENTATION**. Docs: `docs/integrations/pedidosya/README.md`.

## Arquitectura

`DeliveryApplicationService → DeliveryProvider → {OwnRiderProvider, PedidosYaProvider}`. El ciclo del
pedido no depende del JSON del proveedor; cada proveedor tiene capacidades y estados propios.

## Repartidor propio

Disponibilidad, asignación única activa, recolección → en ruta → entregado → regreso a sucursal →
disponible; incidentes e historial. Entrega al cliente ≠ retorno a sucursal.

## PedidosYa (futuro)

Cotización, solicitud, IDs externos, seguimiento, cancelación, costo estimado vs. final, reintentos,
idempotencia, webhooks/polling **según documentación oficial**. Hoy solo mock rotulado “Simulación”.

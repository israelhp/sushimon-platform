# Análisis de brechas del esquema (propuestas, **nada aplicado**)

Basado en lectura directa del DBML. Cada punto es una **propuesta sujeta a ADR/migración**; el DBML no se modificó.
Prioridad: 🔴 bloquea un slice · 🟡 importante · 🟢 mejora.

## A. Integridad (CHECK / índices parciales declarados pendientes)

| #   | Brecha                                                                                                                                                                                 | Propuesta                                                                                                                                                               | Prio |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A1  | `orders.status`, `payments.status`, `deliveries.status`, `incidents.status`, `notifications.status`, `job_applications.status`, `fulfillment_type`, `promotions.kind` son `text` libre | `CHECK (… IN (…))` o tipos enumerados, con el conjunto definido en una spec (los estados del prototipo están en español: ver mapeo en `docs/ui/prototype-inventory.md`) | 🔴   |
| A2  | `staff_assignments (staff_id, role_id, branch_id)` único, pero `branch_id` es NULL para roles globales: en PostgreSQL los NULL son distintos ⇒ duplicados posibles                     | Índice único parcial `WHERE branch_id IS NULL` (o `NULLS NOT DISTINCT` si la versión lo permite)                                                                        | 🔴   |
| A3  | Importes `numeric(12,2)` sin límites                                                                                                                                                   | `CHECK (>= 0)`; `total = subtotal - discount_total + delivery_fee`; `quantity > 0`                                                                                      | 🔴   |
| A4  | Un solo `customer_addresses.is_default` por cliente no garantizado                                                                                                                     | Índice único parcial `WHERE is_default`                                                                                                                                 | 🟡   |
| A5  | Horarios/cierres: solapes y `opens_at < closes_at`                                                                                                                                     | CHECK + exclusión (`EXCLUDE`) donde aplique                                                                                                                             | 🟡   |
| A6  | `refunds.amount` ≤ pagado                                                                                                                                                              | Restricción vía trigger o lógica transaccional con bloqueo                                                                                                              | 🟡   |

## B. Entregas (repartidores propios + PedidosYa)

`deliveries` tiene `order_id UNIQUE`, `rider_id`, `status`, tres marcas de tiempo y notas. **No modela**:

| #   | Brecha                                                                                             | Consecuencia                                                                           | Propuesta                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Sin proveedor de entrega (`own`/`pedidosya`)                                                       | No se distingue la modalidad                                                           | Columna `provider` (o tabla `delivery_providers`)                                                                                               |
| B2  | `order_id UNIQUE` ⇒ un intento por pedido                                                          | No permite reasignar/reintentar tras fallo del courier o cambio de modalidad           | Separar `deliveries` (uno por pedido) de `delivery_attempts` (N intentos) — ADR                                                                 |
| B3  | Sin cotizaciones ni costos                                                                         | El prototipo muestra “envío cotizado al cliente” vs. “costo PedidosYa” y su diferencia | `delivery_quotes`; columnas de costo cotizado/final/diferencia (GTQ)                                                                            |
| B4  | Sin referencias/estados del proveedor ni eventos externos                                          | No auditable ni reconciliable                                                          | `delivery_provider_requests` + `delivery_external_events` (payload, firma, recibido_en) — **estructura final pendiente de la doc de PedidosYa** |
| B5  | `riders` sin disponibilidad ni turnos; sin vínculo a usuario                                       | No hay control “repartidor ocupado/regreso”                                            | `rider_availability` (estado, desde) o columna con máquina de estados; restricción: una entrega activa por repartidor (índice único parcial)    |
| B6  | Sin “regreso a sucursal”                                                                           | Prototipo/requisito lo distingue de la entrega al cliente                              | Estados/marcas `returning_at`, `returned_at` en el intento                                                                                      |
| B7  | `delivery_zones` por municipio con `base_fee`; el prototipo habla de “radio” y “zonas por definir” | Posible desajuste de cobertura                                                         | Resuelto en ADR-0012 (F09): municipio + zona opcional, radio descartado — ✅ (propuesta)                                                        |

## C. Pagos (Neonet pendiente)

`payments`: `method_id`, `amount`, `status`, `provider`, `provider_reference`, `idempotency_key` (único), `created_at`. `refunds` ligada a `payment`.

| #   | Brecha                                        | Propuesta                                                                                                        |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| C1  | Un registro por pago; sin intentos ni eventos | `payment_attempts`, `payment_events` (webhooks/estados del proveedor) — forma exacta depende de la doc de Neonet |
| C2  | Sin distinguir autorización/captura           | Campos/estados solo si el proveedor los distingue                                                                |
| C3  | Sin moneda por pago ni `paid_at`              | `currency`, `paid_at`/`failed_at`                                                                                |
| C4  | Sin conciliación                              | Tabla/estado de conciliación e importes liquidados                                                               |
| C5  | Sin metadatos seguros                         | `jsonb` sin PAN/CVV/PIN; solo tokens/refs del proveedor                                                          |
| C6  | `idempotency_key` único global                | Evaluar unicidad por (`method`, `order_id`) y política de reintento                                              |

## D. Pedidos y catálogo

| #   | Brecha                                                                                                                                                           | Propuesta                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | ✅ Snapshots presentes: `order_items` (`product_name`, `unit_price`) y `order_item_modifiers` (`modifier_name`, `unit_extra_price`), con FK opcional al catálogo | Mantener; ninguna acción                                                                                                                                |
| D2  | `orders.order_number` con `increment` global (una secuencia para todas las sucursales)                                                                           | Aceptable; documentar formato visible (`SM-…`) y consulta por número+teléfono (invitado) con rate limiting                                              |
| D3  | Sin impuestos (IVA) ni propina en `orders`                                                                                                                       | ❓ Confirmar requisito fiscal en Guatemala antes de facturar                                                                                            |
| D4  | `orders.status` único mezcla pedido/logística                                                                                                                    | Mantener pedido y entrega separados (ya lo están) y definir transiciones válidas en la API                                                              |
| D5  | `promotions.value`/`kind` sin semántica                                                                                                                          | Definir tipos (porcentaje, monto, 2x1) y validación. Happy Hour (lun–jue) se expresa con `promotion_weekdays` (weekday + `starts_at`/`ends_at` time) ✅ |
| D6  | Sin vigencia de precios/histórico de catálogo                                                                                                                    | Aceptable por snapshots; auditar cambios con `audit_events`                                                                                             |

## E. Seguridad y privacidad

RLS de Supabase no está en el DBML ⇒ definir políticas por tabla en migraciones (clientes ven solo lo suyo; staff por rol+sucursal). Datos personales (nombre, teléfono, correo, direcciones) en `orders`/`customers`: definir retención y acceso mínimo. `audit_events` con `old_values/new_values jsonb`: evitar PII innecesaria.

## F. Rendimiento

Índices sugeridos (confirmar con `EXPLAIN` sobre datos reales): `orders (branch_id, status, placed_at DESC)`, `orders (customer_id, placed_at DESC)`, `order_items (order_id)`, `deliveries (rider_id) WHERE status activo`, `notifications (status, created_at)`, `audit_events (entity_type, entity_id, created_at)`. A ~100 pedidos/día el volumen es bajo: priorizar corrección sobre optimización prematura.

## G. Inconsistencias prototipo ↔ modelo

Ver `docs/ui/prototype-inventory.md` §Inconsistencias (tope de 5 sucursales, cobertura por radio, estados en español, costos PedidosYa).

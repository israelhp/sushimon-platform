---
name: sushimon-domain
description: 'Conocimiento de negocio de Sushi Mon (sucursales, pedidos, pagos, entregas, roles, invariantes). Úsala al diseñar o revisar cualquier funcionalidad de dominio.'
---

# Dominio Sushi Mon

**Contexto**: restaurante de sushi en Guatemala, GTQ, 3 sucursales (hasta ~5), ~100 pedidos/día, es/en.

## Entidades (DBML, esquema `app`)

Sucursales (`branches`, `branch_hours`, `branch_closures`, `delivery_zones`) · Clientes (`customers`,
`customer_addresses`, `customer_favorites`) · Staff (`staff_users`, `roles`, `permissions`,
`role_permissions`, `staff_assignments`) · Catálogo (`categories`, `products`, `product_media`,
`branch_products`, `modifier_groups`, `modifiers`) · Promos (`promotions` + `promotion_*`) · Pedidos
(`orders`, `order_items`, `order_item_modifiers`, `order_addresses`, `order_promotions`,
`order_status_history`) · Pagos (`payment_methods`, `payments`, `refunds`) · Entrega (`riders`,
`deliveries`, `delivery_status_history`) · Incidencias · `notifications` · `audit_events` · `job_applications`.

## Invariantes

1. Configuración independiente por sucursal; permisos con alcance (rol + sucursal).
2. La **API** calcula precios finales; el cliente nunca es fuente de verdad del total.
3. Los pedidos guardan **snapshots** (nombre, precio, modificadores, dirección) inmutables.
4. Pedido, pago y entrega tienen **ciclos de vida independientes**: pagado ≠ aceptado ≠ entregado.
5. Historial de estados siempre conservado; operaciones monetarias auditadas e idempotentes.
6. Repartidor propio: una sola asignación activa; distinguir entrega al cliente de retorno a sucursal.
7. Datos logísticos/pagos externos auditables; datos sensibles protegidos.

## Dos modalidades de reparto

Repartidores propios y PedidosYa Courier (integración pendiente). Ver skill `delivery-operations`.

## Cómo usarla

Antes de proponer cambios, ubica entidades afectadas en `docs/database/` y pantallas en
`docs/ui/prototype-inventory.md`. Distingue siempre: implementado · simulado · pendiente de proveedor.

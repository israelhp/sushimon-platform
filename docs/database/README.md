# Base de datos

**Línea base**: `docs/references/monsushi_dbdiagram.dbml` (PostgreSQL, esquema `app`, `auth.users` de Supabase).
Inmutable. Estado: ✅ analizada · 📐 sin migraciones · sin base de datos conectada.

El DBML advierte que **CHECK e índices parciales no están expresados**: deben implementarse en migraciones SQL.

## Inventario (45 tablas = `auth.users` + 44 en `app`)

| Dominio          | Tablas                                                                                                                  | Pantallas relacionadas (prototipos)            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sucursales       | `branches`, `branch_hours`, `branch_closures`                                                                           | Sucursales (BO); selector de sucursal (tienda) |
| Cobertura        | `departments`, `municipalities`, `delivery_zones`                                                                       | Sucursales (BO); dirección/checkout            |
| Clientes         | `customers`, `customer_addresses`, `customer_favorites`                                                                 | Mi cuenta, Mis direcciones, Favoritos          |
| Staff y permisos | `staff_users`, `roles`, `permissions`, `role_permissions`, `staff_assignments`                                          | Usuarios (BO)                                  |
| Catálogo         | `categories`, `products`, `product_media`, `branch_products`, `modifier_groups`, `modifiers`, `product_modifier_groups` | Productos, Categorías (BO); Menú               |
| Promociones      | `promotions`, `promotion_branches`, `promotion_products`, `promotion_weekdays`                                          | Promociones (BO); Happy Hour                   |
| Pedidos          | `orders`, `order_addresses`, `order_items`, `order_item_modifiers`, `order_promotions`, `order_status_history`          | Pedidos, Detalle (BO); Checkout, Seguimiento   |
| Pagos            | `payment_methods`, `payments`, `refunds`                                                                                | Checkout (Neonet simulado)                     |
| Entregas         | `riders`, `deliveries`, `delivery_status_history`                                                                       | Entregas, Despachar (BO)                       |
| Incidencias      | `incident_types`, `incidents`, `incident_items`, `incident_updates`                                                     | Reclamos (tienda)                              |
| Transversal      | `notifications`, `audit_events`                                                                                         | Reportes/auditoría                             |
| RR. HH.          | `job_applications`                                                                                                      | Trabaja con nosotros                           |

Detalle de brechas y propuestas: [`schema-gap-analysis.md`](./schema-gap-analysis.md).

## Reglas

Ver `.claude/rules/database.md` y skill `database-integrity`. Ninguna migración se aplica a bases reales
desde el agente; las propuestas pasan por ADR + revisión humana.

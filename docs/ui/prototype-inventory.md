# Inventario de prototipos

**Método**: lectura estática (sin ejecutar scripts). Backoffice: desempaquetado del `__bundler/manifest`/`template`
(React + plantilla `sc-*`). Tienda: bundle Vite; se extrajeron cadenas de UI y estructura. Por ello el inventario
es **fiable en pantallas, flujos y textos** y **provisional en detalles** (reglas finas, validaciones): confirmar
cada pantalla al implementarla. Leyenda: **D** demostrado en el prototipo · **C** requisito confirmado (en el prompt de bootstrap) · **P** pendiente de definir.

## A. Backoffice (`backoffice-prototype.html`)

Tipografías: Archivo Black + DM Sans. Temas claro (`#FAF7F2`) y oscuro (`#0B0B0F`). Acento ámbar, primario rojo.

| Pantalla           | Contenido observado                                                                                                             | Entidades DBML                                    | Estado                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Acceso             | Login por correo/contraseña **simulado**                                                                                        | `auth.users`, `staff_users`                       | D (visual). **C**: real = Google OAuth + usuario interno |
| Panel              | KPIs: ventas del día, ticket promedio, tiempo promedio, recibidos/en preparación/entregados/cancelados, delivery hoy            | `orders`, `payments`, `deliveries`                | D                                                        |
| Pedidos            | Lista con filtros/estado; detalle en _drawer_: productos, notas, subtotal/envío/total, historial de estados                     | `orders`, `order_items`, `order_status_history`   | D                                                        |
| Acciones de pedido | Aceptar · Rechazar (motivos + notificación) · En preparación · Listo · Despachar · Entregado en tienda                          | `orders`, `order_status_history`, `notifications` | D                                                        |
| Entregas           | Tabla de envíos por periodo/filtros; seguimiento; “costo PedidosYa” vs. envío cobrado y diferencia; avanzar estado (simulación) | `deliveries`, `delivery_status_history`, `riders` | D (mock) · PedidosYa ⏳                                  |
| Despachar (modal)  | Elegir **PedidosYa** (cotización, “buscando repartidor”) o **repartidor del restaurante**                                       | `deliveries`, `riders`                            | D (mock)                                                 |
| Productos          | Vista tarjetas/tabla; búsqueda; chips por categoría; interruptor de disponibilidad; editar (solo admin)                         | `products`, `branch_products`, `categories`       | D                                                        |
| Categorías         | Orden del menú (subir/bajar), visibilidad en web, alta                                                                          | `categories`                                      | D                                                        |
| Promociones        | Tarjetas (Happy Hour 2x1, Martes de tempura, Combo Mon…), vigencia, días, horas, activar/desactivar                             | `promotions`, `promotion_*`                       | D                                                        |
| Sucursales         | Tarjetas (dirección, horario, teléfono, “radio”, zonas), abierta/cerrada, estadísticas; **tope de 5**                           | `branches`, `branch_hours`, `delivery_zones`      | D                                                        |
| Usuarios           | Alta/edición con roles **admin / encargado / cocina**                                                                           | `staff_users`, `roles`, `staff_assignments`       | D                                                        |
| Reportes           | Ventas, pedidos, ticket promedio, envíos, diferencias                                                                           | `orders`, `payments`, `deliveries`                | D                                                        |
| Modales            | Rechazar, Despachar, Producto, Promoción, Usuario                                                                               | —                                                 | D                                                        |

**Reglas observadas (D)**: edición de productos solo `admin`; despachar solo si estado “listo”, es envío a domicilio, sin logística aún y rol ≠ `cocina` (el `encargado` despacha); cocina ve bloqueo informativo. Estados de pedido (en español): `nuevo` → aceptado → en preparación → listo → en camino → entregado; además rechazado/cancelado. Las horas de llegada PedidosYa son **estimadas**.

## B. Tienda pública (`public-store-prototype.html`)

Es/en, claro/oscuro (preferencia en `localStorage`: aceptable solo como preferencia), responsive.

| Flujo                           | Observado                                                                                                                                                      | Entidades                                               | Estado                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| Inicio                          | Banners rotativos, categorías, “Los favoritos de los MONcheros”, más pedidos                                                                                   | `products`, `categories`, `product_media`               | D                                |
| Menú y producto                 | Cantidad (máx. 99) y nota. **Sin modificadores** (corregido en la Etapa 1)                                                                                     | `modifier_groups`, `modifiers`                          | D                                |
| Promociones                     | **Happy Hour lunes a jueves**, carrusel de promociones                                                                                                         | `promotions`, `promotion_weekdays`                      | D                                |
| Carrito                         | Reemplazar o agregar al pedido actual, “agregamos tu último pedido”                                                                                            | `orders`, `order_items`                                 | D                                |
| Checkout                        | Recoger en sucursal (sin envío) o domicilio; dirección exacta, referencia, enlace a Google Maps; pagar                                                         | `orders`, `order_addresses`, `delivery_zones`           | D                                |
| Pagos                           | Efectivo, transferencia, **tarjeta con Neonet simulada** (datos de tarjeta en el prototipo)                                                                    | `payment_methods`, `payments`                           | D (simulado) · Neonet ⏳         |
| Cuenta                          | “Continuar con Google” (**simulado**: “Elegí una cuenta”), Mi cuenta, Mis direcciones (predeterminada, editar/eliminar), Mis pedidos, Mis favoritos, reordenar | `customers`, `customer_addresses`, `customer_favorites` | D · **C**: Google OAuth opcional |
| Invitado                        | “Seguir como invitado”; buscar pedido con **número + teléfono**                                                                                                | `orders`                                                | D · **C**                        |
| Seguimiento                     | “Seguí tu pedido”, progreso del pedido, pedido en curso                                                                                                        | `orders`, `order_status_history`, `deliveries`          | D                                |
| Reclamos                        | “Problemas con tu pedido”, “Hacer un reclamo” prellenado con datos                                                                                             | `incidents`, `incident_*`                               | D                                |
| Sucursales / cobertura          | “Elegí una sucursal”, “Sin cobertura de envío por ahora”, zonas cercana/intermedia/extendida                                                                   | `branches`, `delivery_zones`                            | D                                |
| Contacto / Trabaja con nosotros | Formulario de postulación                                                                                                                                      | `job_applications`                                      | D                                |
| Programar pedido                | “Programar pedido”                                                                                                                                             | `orders.scheduled_for`                                  | D                                |

**Advertencia de seguridad (prototipo)**: el formulario de tarjeta (número, nombre) es demostrativo. En producción **no** se capturan ni almacenan CVV/PIN/PAN; se usará el mecanismo del procesador cuando exista documentación.

## C. Inconsistencias prototipo ↔ DBML y decisiones requeridas

1. **Tope de 5 sucursales** (UI) vs. sin límite en el modelo → regla de negocio en API o solo UI ❓.
2. **Cobertura por “radio”** y “[Zonas por definir]” (UI) vs. `delivery_zones` por municipio con `base_fee` ❓ (B7 en gap analysis).
3. **Estados en español** del prototipo vs. `text` libre en DBML → catálogo de estados y transiciones por spec.
4. **Costo PedidosYa / diferencia cobrada** (UI) sin columnas equivalentes → ver brechas B3–B4.
5. **Despacho elegible entre PedidosYa y propio** (UI) sin columna de proveedor → B1.
6. **Login con contraseña** en backoffice (UI) vs. requisito Google OAuth.
7. **Pedidos “en este dispositivo”** (UI invitado) vs. sin vínculo de dispositivo en BD → la búsqueda real es número+teléfono; el listado local es solo conveniencia ❓.
8. **Impuestos/propina** no visibles ni modelados ❓.

## C2. Hallazgos de la Etapa 1 (extracción estática, 2026-11-11)

- **Tienda**: React 18 + react-router (MemoryRouter) + Tailwind v3 compilado + lucide-react; i18n propio con ~630 claves
  por idioma (convertidas a ICU en `sushimon-web/src/i18n/messages`); 29 productos, 8 categorías, 5 sucursales (3 activas),
  niveles de envío near/mid/extended/far (Q15/20/25/30); checkout de 5 pasos; pago `cash` o `card_neonet` con tarjetas de
  prueba; estados en inglés (`awaiting_payment`, `paid_pending_acceptance`, `pending_acceptance`, `payment_review`).
- **Backoffice**: además del despacho PedidosYa existe un flujo de **repartidor propio** (`asignado → en_camino → entregado`);
  estados de pedido `nuevo, aceptado, preparacion, listo, en_camino, entregado, cancelado`; 15 pedidos del día + 60 días
  generados con semilla.
- **Unificación**: el contrato usa catálogos en inglés separados para pedido, pago y entrega; cada zona muestra sus etiquetas.
- **Diferencias intencionales**: el backoffice usa rutas reales (`/backoffice/pedidos`…) en lugar de estado interno.

## D. No cubierto / por confirmar

Postulaciones: formulario D, gestión en BO no observada (P). Notificaciones (WhatsApp): sin pantalla (P). Incidencias en BO: no observadas (P). Auditoría en BO: no observada (P).

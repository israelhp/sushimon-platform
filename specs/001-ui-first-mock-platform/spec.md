# Feature Specification: Demo funcional UI First (tienda + backoffice) con datos simulados

**Feature Branch**: `feature/ui-first-mock-platform`

**Created**: 2026-11-11

**Status**: Draft

**Integration state**: `MOCK_ONLY`

**Input**: User description: "Etapa 1 UI First: demo funcional idéntica visualmente a los prototipos `docs/references/public-store-prototype.html` (tienda pública es/en) y `docs/references/backoffice-prototype.html` (backoffice), con datos simulados deterministas tras una capa de acceso a datos intercambiable, escenarios de simulación rotulados y sin red externa. Decisiones: ADR-0004, 0005, 0007, 0008."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cliente hace un pedido en la tienda (Priority: P1)

Un cliente entra a la tienda, cambia de idioma o tema si quiere, explora el inicio y el menú por categoría, abre un
producto, elige cantidad y nota, lo agrega al carrito, elige recoger en sucursal o envío a domicilio (ahora o
programado), recorre los 5 pasos del checkout (Tu pedido → Entrega → Envío → Pago → Confirmación) y paga en efectivo
o con tarjeta mediante la pasarela NeoNet **simulada**. Al terminar ve la confirmación y el seguimiento del pedido.

**Why this priority**: es el recorrido que genera ingresos y el que más componentes comparte; demuestra la propuesta al cliente.

**Independent Test**: con el escenario por defecto, completar un pedido de principio a fin y ver su seguimiento.

**Acceptance Scenarios**:

1. **Given** el carrito vacío, **When** agrego 2 unidades de un roll con nota, **Then** el carrito muestra 2 unidades, la nota y el subtotal en quetzales con el formato del prototipo (`Q1,234.00`).
2. **Given** un carrito con productos y modo "domicilio", **When** ingreso una dirección dentro de cobertura, **Then** el checkout muestra la tarifa de la zona (cercana Q15, intermedia Q20, extendida Q25, lejana Q30) y el tiempo estimado.
3. **Given** el paso Pago, **When** pago con una tarjeta de prueba aprobada, **Then** la confirmación muestra el número de pedido `MON-xxxxxx` y la insignia "Simulación".
4. **Given** el escenario `payment-rejected` o una tarjeta de prueba rechazada, **When** pago, **Then** veo el rechazo y puedo reintentar o cambiar a efectivo sin perder el carrito.
5. **Given** idioma inglés, **When** navego toda la tienda, **Then** todos los textos aparecen en inglés y los precios en el formato `en-US`.

---

### User Story 2 - Personal del restaurante gestiona pedidos (Priority: P1)

Una persona del personal entra al backoffice con un rol de demostración (admin, encargado o cocina), ve el panel de
KPIs y la lista de pedidos (kanban o tabla), abre el detalle en un panel lateral y avanza el pedido: aceptar o
rechazar (con motivo) → en preparación → listo → despachar (PedidosYa simulado o repartidor propio) → entregado.

**Why this priority**: sin operación no hay negocio; es la otra mitad de la demo.

**Independent Test**: entrar como encargado y llevar un pedido nuevo hasta "entregado" despachándolo con PedidosYa simulado.

**Acceptance Scenarios**:

1. **Given** el rol "cocina", **When** entro, **Then** solo veo "Pedidos" en el menú y no puedo despachar (aviso informativo).
2. **Given** un pedido "listo" de envío a domicilio sin logística, **When** el encargado pulsa Despachar y elige PedidosYa, **Then** ve la cotización (rotulada "Simulación"), luego "buscando repartidor" y el pedido pasa a "en camino".
3. **Given** un pedido nuevo, **When** lo rechazo con un motivo, **Then** sale de la columna de nuevos y queda en su historial con el motivo.
4. **Given** el rol "admin", **When** visito productos, **Then** puedo editar productos; con "encargado" solo puedo cambiar la disponibilidad.

---

### User Story 3 - Cliente da seguimiento o consulta su pedido (Priority: P2)

El cliente sigue su pedido (6 pasos si es a domicilio, 5 si es para recoger); como invitado lo consulta con número de
pedido + teléfono; si hay un problema, levanta una incidencia prellenada.

**Why this priority**: reduce llamadas y mensajes al restaurante; depende de que exista un pedido (US1).

**Independent Test**: consultar el pedido de demostración como invitado y reportar una incidencia.

**Acceptance Scenarios**:

1. **Given** un pedido existente, **When** consulto con número y teléfono correctos, **Then** veo su estado; con datos incorrectos veo un error accesible y no se revela si el pedido existe.
2. **Given** el seguimiento abierto, **When** uso el botón de demostración "siguiente estado", **Then** el progreso avanza un paso.

---

### User Story 4 - Cliente con cuenta (Google simulado) (Priority: P2)

El cliente "inicia sesión con Google" (selector de cuenta simulado, rotulado como demostración) y gestiona sus datos,
direcciones (predeterminada, editar, eliminar), favoritos y pedidos, y puede repetir un pedido anterior (reemplazar
o agregar al carrito, con aviso de cambios de precio o productos no disponibles).

**Why this priority**: mejora la recompra, pero el pedido como invitado ya funciona sin cuenta.

**Independent Test**: iniciar la sesión simulada, guardar una dirección, marcar un favorito y repetir un pedido.

**Acceptance Scenarios**:

1. **Given** sesión simulada iniciada, **When** guardo una dirección como predeterminada, **Then** el checkout la propone por defecto.
2. **Given** un pedido anterior con un producto no disponible, **When** lo repito, **Then** se me informa cuántos productos no se agregarán.

---

### User Story 5 - Administración del catálogo y la operación (Priority: P3)

El admin gestiona productos (tarjetas/tabla, búsqueda, categoría, disponibilidad por sucursal), categorías (orden y
visibilidad), promociones (vigencia, días, horas, activar), sucursales (abierta/cerrada, horario, cobertura; tope de
5), usuarios (alta/edición con rol y sucursal) y reportes (resumen con gráficos e historial por día o rango).

**Why this priority**: son pantallas de configuración; la operación diaria (US2) no depende de ellas.

**Independent Test**: como admin, desactivar un producto en una sucursal y comprobar que la tienda lo muestra no disponible.

**Acceptance Scenarios**:

1. **Given** 5 sucursales, **When** intento crear otra, **Then** la acción está deshabilitada con explicación.
2. **Given** el reporte de historial, **When** elijo un rango de fechas, **Then** los totales coinciden con la suma de los pedidos listados.

---

### User Story 6 - Contenido informativo (Priority: P3)

Promociones Happy Hour (lunes a jueves, solo en restaurante), "Más", "Trabaja con nosotros" (postulación con
validación) y página 404.

**Independent Test**: enviar una postulación válida y ver la confirmación; con campos vacíos ver errores accesibles.

**Acceptance Scenarios**:

1. **Given** el formulario de postulación, **When** envío con campos obligatorios vacíos, **Then** cada campo muestra su error y el foco va al primero.

### Edge Cases

- Escenarios de simulación: `empty` (sin productos/pedidos → estados vacíos), `loading` (esqueletos), `error` y `offline` (mensaje y reintento), `forbidden` (backoffice sin permiso), `branch-closed` (no se puede pedir "ahora", sí programar), `product-unavailable`, `promotion-expired`, `order-pending`, `payment-rejected`, `rider-unavailable` (PedidosYa sin repartidor → ofrecer repartidor propio), `request-rejected`.
- Dirección fuera de cobertura: "Sin cobertura de envío por ahora" y opción de recoger.
- Pedido programado fuera del horario o con menos de 45 min de anticipación: no se permite.
- Cantidad máxima 99 por producto.
- Cambio de idioma o tema a mitad del checkout: no se pierde el progreso.
- Pantallas pequeñas (≥ 320 px) y alturas reducidas: sin desplazamiento horizontal.
- `prefers-reduced-motion`: el carrusel no rota solo y no hay animaciones.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: La tienda MUST ofrecer todas las vistas del prototipo: inicio, menú (por categoría), promociones, checkout, confirmación, seguimiento, consulta de invitado, incidencias, cuenta (datos, direcciones, favoritos, pedidos), Más, Trabaja con nosotros y 404, además de los paneles de carrito, producto, modo de pedido, inicio de sesión, pasarela de pago y repetir pedido.
- **FR-002**: El backoffice MUST ofrecer: acceso de demostración por rol, panel, pedidos (kanban y tabla) con detalle lateral, entregas, productos, categorías, promociones, sucursales, usuarios y reportes (resumen e historial), con los modales Rechazar, Despachar, Producto, Promoción y Usuario.
- **FR-003**: Cada pantalla MUST coincidir visualmente con su equivalente del prototipo (colores, tipografías, espaciados, iconografía, ilustraciones, estados y responsive) en escritorio y móvil, en claro y oscuro.
- **FR-004**: La tienda MUST estar disponible en español (predeterminado) e inglés; el backoffice en español. El idioma y el tema se recuerdan como preferencias.
- **FR-005**: Las pantallas MUST obtener datos solo a través de una capa de acceso que pueda cambiar de origen (simulado ↔ API) sin modificar las pantallas.
- **FR-006**: Los datos simulados MUST ser deterministas: la misma configuración produce los mismos datos en cada ejecución.
- **FR-007**: Las simulaciones de proveedores (NeoNet, PedidosYa) y los accesos de demostración MUST mostrar una insignia visible ("Simulación"/"Demostración") y no deben contactar servicios externos.
- **FR-008**: La demo MUST NOT almacenar números de tarjeta, CVV ni PIN fuera del formulario en pantalla, y MUST NOT usar el almacenamiento del navegador como prueba de identidad o permiso.
- **FR-009**: El menú y las acciones del backoffice MUST reflejar los permisos del rol (admin: todo; encargado: panel, pedidos, entregas, productos, reportes; cocina: pedidos), dejando claro que la autorización real la hará el servidor.
- **FR-010**: Las transiciones de estado de pedido, pago y entrega MUST seguir catálogos únicos y separados (pedido, pago, entrega); las transiciones inválidas se rechazan con un mensaje.
- **FR-011**: Un pedido creado en la tienda MUST aparecer en el backoffice durante la misma sesión de demostración.
- **FR-012**: La demo MUST poder ejecutarse en cada escenario de simulación listado en Edge Cases, mostrando el estado de interfaz correspondiente.
- **FR-013**: Toda la interfaz MUST ser usable por teclado, con foco visible, etiquetas en controles y contraste AA.
- **FR-014**: Si se configura el origen "API" sin API disponible, la aplicación MUST fallar de forma explícita y nunca volver en silencio a los datos simulados.

### Key Entities _(include if feature involves data)_

- **Sucursal**: nombre, zona, dirección, horario por día, teléfono, abierta/cerrada, cobertura (zonas y niveles), activa o "próximamente".
- **Zona de envío / nivel**: cercana, intermedia, extendida o lejana, con tarifa y tiempo estimado.
- **Categoría**: nombre, orden, visible en la web.
- **Producto**: nombre (es/en), descripción (es/en), precio, categoría, ilustración, destacado, disponibilidad por sucursal.
- **Promoción**: nombre, tipo (2x1, porcentaje, precio), valor, días, horas, vigencia, activa; ítems de Happy Hour.
- **Pedido**: número, fecha, líneas (producto, cantidad, nota, subtotal), subtotal, envío, total, tipo (recoger/domicilio), cuándo (ahora/programado), sucursal, dirección, cliente, estado de pedido, historial.
- **Pago**: método (efectivo, tarjeta), estado (pendiente, aprobado, rechazado, en revisión), referencia simulada.
- **Entrega**: proveedor (PedidosYa simulado o propio), estado logístico, repartidor, costo, hora estimada.
- **Repartidor**, **Usuario interno** (rol, sucursal, activo), **Cliente** (perfil, direcciones, favoritos), **Incidencia**, **Postulación**.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El 100 % de las vistas y paneles listados en FR-001 y FR-002 existen y son navegables.
- **SC-002**: En la comparación de capturas contra el prototipo, cada pantalla queda por debajo del umbral de diferencia acordado (inicial: ≤ 3 % de píxeles distintos) en escritorio y móvil.
- **SC-003**: Un cliente completa un pedido de principio a fin en menos de 2 minutos en la demo.
- **SC-004**: Una persona del personal lleva un pedido de "nuevo" a "entregado" en menos de 1 minuto.
- **SC-005**: Cambiar el origen de datos de simulado a API requiere cambiar solo la configuración, sin modificar pantallas (comprobado con una prueba de paridad).
- **SC-006**: Cero violaciones de accesibilidad graves o críticas en las rutas principales, en claro y oscuro.
- **SC-007**: Cero solicitudes de red a servicios externos durante toda la demo.

## Assumptions

- La tienda del prototipo no tiene modificadores de producto: la personalización es solo cantidad y nota (se corrige el inventario).
- Se fusionan los datos de ambos prototipos: las 3 sucursales operativas son comunes; la tienda agrega 2 "próximamente".
- Los estados se unifican en catálogos en inglés (contrato) y cada zona muestra las etiquetas de su prototipo.
- El backoffice usa rutas navegables propias en lugar de la navegación interna del prototipo; el resultado visual es el mismo.
- El límite de 5 sucursales se aplica solo en la interfaz (regla de negocio de servidor pendiente).
- El tiempo de la demo (minutos de espera, avance de estados) se simula con un reloj controlable.
- Fuera de alcance: autenticación real (Google/Supabase), pagos reales, PedidosYa real, notificaciones WhatsApp, persistencia en servidor.

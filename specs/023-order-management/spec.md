# F22 — Tablero backoffice y transiciones de pedidos

**Rama**: `feature/F22-order-management` (desde `develop` d47592a, que incluye F20 y F21) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: API + WEB (backoffice de pedidos)
**Dependencias**: F20 (pedidos, historial `order_status_history`), F03 (RBAC granular y alcance por sucursal), F02 (aal2) · **Integración posterior**: F24 (pagos), F26 (reembolsos), F28 (entrega propia), F29 (PedidosYa, `BLOCKED_EXTERNAL`), F31 (avisos) · **Decisiones**: `docs/adr/0028-gestion-pedidos-backoffice.md` · **Pendientes**: P68–P74 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración inicial: `CONTRACT_DEFINED`** (operaciones `listAdminOrders`, `getAdminOrderBoard`, `getAdminOrder`, `acceptAdminOrder`, `rejectAdminOrder`, `startPreparingAdminOrder`, `markReadyAdminOrder`, `completeAdminOrder`, `cancelAdminOrder` y esquemas `AdminOrder*` en `openapi.yaml`, tag `admin-orders`; sin migración, API ni web). `pnpm contracts:generate` ejecutado; `pnpm contracts:check` queda rojo SOLO por esas 9 operaciones sin implementar (comprobado). Estado de la feature en el backlog: no se edita aquí. PedidosYa real: `BLOCKED_EXTERNAL`.

> **Nota ADR-0036 (2026-11-26, pedidos solo a domicilio e inmediatos)**: reemplaza parcialmente lo que esta spec dice sobre PICKUP y pedidos programados en gestión: `complete` (`picked_up`) solo para PICKUP histórico o en curso; el filtro `fulfillmentType` y `scheduledFor` del listado admin se eliminan. El texto original se conserva como historial; ver `docs/adr/0036-pedidos-solo-a-domicilio-e-inmediatos.md`.

## 1. Alcance y fuera de alcance

Dentro: tablero agregado por estado y sucursal; listado paginado con filtros; detalle completo con historial; seis comandos de transición (aceptar, rechazar, iniciar preparación, marcar listo, completar PICKUP, cancelar) con permiso por comando, alcance por sucursal, control de concurrencia, motivo obligatorio donde corresponde, historial y auditoría en la misma transacción; `availableActions` calculadas por el servidor; puertos `OrderFulfillmentPort` y `OrderPaymentReadPort` (solo interfaz + implementación vacía); web: tablero/tabla/detalle reales sobre `features/bo-orders` con polling controlado, indicador de pedidos nuevos y manejo de conflictos.

Fuera: asignar repartidor, despachar y `on_the_way`/`delivered` (F28; aquí solo el puerto y el contrato interno de §9); solicitar PedidosYa (F29; sin API); cobros, conciliación y estados de pago (F24); reembolsos (F26); notificaciones al cliente (F31); incidencias (F32); motivo público de rechazo (P64); edición de líneas, importes o dirección de un pedido; reasignación de sucursal; WebSockets, SSE, Redis, colas; migración (no hay; §5.5).

Reutiliza SIN cambiar su comportamiento: `OrdersModule` (gate `ORDERS_DB_GATE`, `AuditModule`, `OrderLifecycleStatus`), `RequireStaff` (personal activo + permiso + aal2, ADR-0010), `AuthorizationService.scopeFor/canAccess`, `AuditService.record`, `noStoreMiddleware` de `/v1/admin`, el filtro global de errores (se amplía con una clave aditiva, §4.4), los snapshots y `OrderDetail*` de F20, `order_status_history` y `orders_branch_status_placed_idx` de la migración 0018.

## 2. Catálogo de estados y reglas heredadas

Catálogo CERRADO (CHECK de 0018): `pending, accepted, preparing, ready, on_the_way, delivered, picked_up, rejected, cancelled`. F22 no crea estados ni enums nuevos. Terminales (inmodificables): `delivered, picked_up, rejected, cancelled`. «Pagado», «incidencia» y «reembolsado» NO son estados del pedido (P57, F24, F32, F26). El trigger `orders_immutable_fields` ya impide cambiar sucursal, modalidad, proveedor, importes, moneda y `placed_at`; F22 solo escribe `status` y `updated_at` en `orders`. `order_status_history` es append-only (trigger): una transición = UNA fila nueva, nunca se edita.

## 3. Máquina de estados y matriz de transiciones

### 3.1 Comandos, permiso y origen

| Comando (ruta `POST /v1/admin/orders/{id}/…`) | Permiso (`RequireStaff`) | Estado de origen                            | Destino     | Motivo      |
| --------------------------------------------- | ------------------------ | ------------------------------------------- | ----------- | ----------- |
| `accept`                                      | `orders.accept`          | `pending`                                   | `accepted`  | no          |
| `reject`                                      | `orders.reject`          | `pending`                                   | `rejected`  | OBLIGATORIO |
| `start-preparing`                             | `orders.prepare`         | `accepted`                                  | `preparing` | no          |
| `mark-ready`                                  | `orders.prepare`         | `preparing`                                 | `ready`     | no          |
| `complete`                                    | `orders.complete`        | `ready` (solo PICKUP)                       | `picked_up` | no          |
| `cancel`                                      | `orders.cancel`          | `pending`, `accepted`, `preparing`, `ready` | `cancelled` | OBLIGATORIO |

Lecturas (`GET /v1/admin/orders`, `/board`, `/{id}`): `orders.read`. Los permisos legados `orders.status` y `orders.dispatch` NO se aceptan: la migración 0005 los retira (comprobado en el SQL de 0005; no verificado contra la BD compartida). No se crea RBAC nuevo: los seis permisos ya existen (0005). Sin saltos de estado (p. ej. `pending → preparing`): cada clic es una transición; el atajo «aceptar y preparar» es P68.

### 3.2 Matriz por modalidad (tabla EXACTA)

`✓` permitida (con el permiso de §3.1) · `✗` 422 `ORDER_TRANSITION_INVALID` con el código de violación indicado.

| Transición                                                            | PICKUP                         | DELIVERY `OWN`                                      | DELIVERY `PEDIDOSYA` (`BLOCKED_EXTERNAL`) |
| --------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- | ----------------------------------------- |
| `pending → accepted`                                                  | ✓                              | ✓                                                   | ✓                                         |
| `pending → rejected`                                                  | ✓                              | ✓                                                   | ✓                                         |
| `pending → cancelled`                                                 | ✓                              | ✓                                                   | ✓                                         |
| `accepted → preparing`                                                | ✓                              | ✓                                                   | ✓                                         |
| `accepted → cancelled`                                                | ✓                              | ✓                                                   | ✓                                         |
| `preparing → ready`                                                   | ✓                              | ✓                                                   | ✓                                         |
| `preparing → cancelled`                                               | ✓                              | ✓                                                   | ✓                                         |
| `ready → picked_up` (`complete`)                                      | ✓                              | ✗ `ORDER_FULFILLMENT_MISMATCH`                      | ✗ `ORDER_FULFILLMENT_MISMATCH`            |
| `ready → cancelled`                                                   | ✓                              | ✓ (con `pendingActions`)                            | ✓ (con `pendingActions`)                  |
| `ready → on_the_way`                                                  | ✗ `ORDER_FULFILLMENT_MISMATCH` | RESERVADA a F28 (`dispatch`; ningún comando de F22) | ✗ `ORDER_PROVIDER_BLOCKED_EXTERNAL`       |
| `on_the_way → delivered`                                              | ✗                              | RESERVADA a F28                                     | ✗ `ORDER_PROVIDER_BLOCKED_EXTERNAL`       |
| `on_the_way → cancelled`                                              | ✗ `ORDER_SOURCE_INVALID`       | ✗ `ORDER_CANCEL_NOT_ALLOWED`                        | ✗ `ORDER_CANCEL_NOT_ALLOWED`              |
| desde `delivered`, `picked_up`, `rejected`, `cancelled`               | ✗ `ORDER_TERMINAL`             | ✗ `ORDER_TERMINAL`                                  | ✗ `ORDER_TERMINAL`                        |
| cualquier otro par (salto, retroceso, origen distinto al del comando) | ✗ `ORDER_SOURCE_INVALID`       | ✗ `ORDER_SOURCE_INVALID`                            | ✗ `ORDER_SOURCE_INVALID`                  |

Notas: (a) `PEDIDOSYA` hoy no es creable (F20: 422 `DELIVERY_PROVIDER_NOT_SELECTABLE`); la matriz lo cubre porque puede existir por SQL/F29 y para que ninguna ruta de F22 «despache» a un proveedor no integrado; (b) F22 nunca inventa estados externos ni escribe `on_the_way`/`delivered`; (c) un pedido DELIVERY `OWN` queda en `ready` hasta que F28 lo mueva; (d) con `PEDIDOSYA` el pedido puede aceptarse, prepararse y marcarse listo, y ninguna acción de despacho existe.

### 3.3 Por qué se cancela desde `ready` y no desde `on_the_way`

`ready` es todavía responsabilidad de la sucursal (la comida no salió); cancelar es una decisión operativa que solo puede dejar `pendingActions` de pago. `on_the_way` implica repartidor o proveedor con el pedido en mano: cancelar exige cancelar la entrega, recuperar el pedido y decidir el reembolso (F26/F28/F32). F22 no tiene esos datos ni puertos reales, así que lo prohíbe y F28 podrá habilitarlo de forma aditiva. Recomendación por defecto (P71).

### 3.4 Roles actuales (de las migraciones 0002/0005; editables por F03, solo orientativos)

| Rol       | `orders.read` | `accept` | `reject` | `prepare` | `complete` | `cancel` |
| --------- | ------------- | -------- | -------- | --------- | ---------- | -------- |
| `admin`   | sí            | sí       | sí       | sí        | sí         | sí       |
| `manager` | sí            | sí       | sí       | sí        | sí         | sí       |
| `kitchen` | sí            | sí       | sí       | sí        | sí         | NO       |
| `staff`   | sí            | sí       | NO       | sí        | NO         | NO       |

Observaciones (P69): cocina puede rechazar pero no cancelar; `staff` puede marcar listo pero no entregar. La autorización es por (permiso, sucursal): un encargado de la sucursal A no ve ni opera pedidos de la B, aunque tenga el permiso en A.

### 3.5 Motivo

`reason` (3..280 caracteres tras recortar; sin caracteres de control) solo en `reject` y `cancel`; ausente, vacío o corto => 400 `ORDER_REASON_REQUIRED`. Se guarda en `order_status_history.reason` y en `audit_events.reason`. Es texto INTERNO: nunca sale en F21 (garantizado) ni en respuestas públicas (P64: el cliente NO ve motivo; `publicReason` aditivo y saneado cuando negocio lo defina). La web advierte «no escribas datos personales». Las demás acciones NO aceptan `reason` (`additionalProperties: false` => 400).

## 4. Contrato (fuente: `openapi.yaml`, tag `admin-orders`)

### 4.1 Rutas finales y reconciliación con los borradores

| Operación                   | Ruta                                         | Permiso           | `operationId`              |
| --------------------------- | -------------------------------------------- | ----------------- | -------------------------- |
| Listado                     | `GET /v1/admin/orders`                       | `orders.read`     | `listAdminOrders`          |
| Tablero                     | `GET /v1/admin/orders/board`                 | `orders.read`     | `getAdminOrderBoard`       |
| Detalle (incluye historial) | `GET /v1/admin/orders/{id}`                  | `orders.read`     | `getAdminOrder`            |
| Aceptar                     | `POST /v1/admin/orders/{id}/accept`          | `orders.accept`   | `acceptAdminOrder`         |
| Rechazar                    | `POST /v1/admin/orders/{id}/reject`          | `orders.reject`   | `rejectAdminOrder`         |
| Iniciar preparación         | `POST /v1/admin/orders/{id}/start-preparing` | `orders.prepare`  | `startPreparingAdminOrder` |
| Marcar listo                | `POST /v1/admin/orders/{id}/mark-ready`      | `orders.prepare`  | `markReadyAdminOrder`      |
| Completar PICKUP            | `POST /v1/admin/orders/{id}/complete`        | `orders.complete` | `completeAdminOrder`       |
| Cancelar                    | `POST /v1/admin/orders/{id}/cancel`          | `orders.cancel`   | `cancelAdminOrder`         |

Historial: DENTRO de `getAdminOrder` (`history[]`, ≤ 50, `historyTruncated`), sin `GET /{id}/history`. Razones: el historial solo se necesita al abrir la ficha (una ida y vuelta, no dos); el listado y el tablero no lo usan; una ruta aparte duplicaría autorización, 404 uniforme y throttle sin ahorrar coste (la consulta es la misma, indexada por `(order_id, changed_at)`). Si algún día se sondea el historial por separado, se añade la ruta de forma aditiva.

`complete` y no `mark-picked-up`: coincide con el permiso `orders.complete` del catálogo y deja libre el nombre para otras modalidades; en DELIVERY responde 422 hasta que F28 aporte la entrega.

Reconciliación con `docs/contracts/planned-endpoints.md` (sin duplicar rutas): `GET /v1/backoffice/orders` queda ⏩ sustituida por `GET /v1/admin/orders` + `/board`; `PATCH /v1/backoffice/orders/{id}/status` queda ⏩ sustituida por los seis comandos (un PATCH genérico de estado habría reemplazado la matriz por una validación de cuerpo y un único permiso, perdiendo permiso por comando, motivo por transición y `expectedStatus`); `POST /v1/backoffice/orders/{id}/dispatch` pasa a F28/F29 y sigue SOLO en el mock rotulado. Las rutas `/v1/backoffice/*` de pedidos no se implementan en la API real. El borrador `OrderStatusChangeRequest` y `DraftOrder` siguen en el contrato para el mock del resto de pantallas (dashboard, entregas, incidencias) y se retiran con F28/F32.

### 4.2 Esquemas

`AdminOrderSummary` (tablero y listado): `id, orderNumber, displayNumber, status, branchId, branchName, fulfillmentType, deliveryProvider, customerName, itemCount, total, paymentMethodPreference, scheduledFor, placedAt, updatedAt, availableActions[]`. Sin teléfono, correo, dirección, líneas ni notas.

`AdminOrderDetail` = `AdminOrderSummary` + `currency, lines[], promotions[], address|null, contact{fullName, phone}, notes, subtotal, extrasTotal, discountTotal, deliveryFee, payment{methodPreference, status}, history[], historyTruncated`. Líneas, promociones y dirección reutilizan `OrderDetailLine/Promotion/Address` de F20 (snapshots inmutables). `payment.status` reutiliza `OrderDetailPayment`: hoy SIEMPRE `NOT_STARTED` (la web lo presenta «Sin pago registrado»); no se inventan estados de F24. `contact.phone` completo (necesario para atender al cliente); el correo NO se expone (P70).

`AdminOrderHistoryEntry`: `seq, status, previousStatus, at, actorName|null, reason|null`. `actorName` = `staff_users.full_name` por `changed_by` (una consulta por lote, sin N+1); `null` = cliente/sistema (la creación) o empleado ya inexistente. Nunca `changed_by`, correo ni id de fila.

`AdminOrderBoard`: `generatedAt, branchId|null, terminalWindowHours (24), pollAfterSeconds, summary{pending, active, oldestPendingAt|null}, columns[9]{status, count, hasMore, items[]}` (siempre los 9 estados en el orden del catálogo).

`AdminOrderActionState`: `{action, enabled, disabledReason|null}`; `action` ∈ `accept, reject, start_preparing, mark_ready, complete, cancel, dispatch`; `disabledReason` ∈ `NO_PERMISSION, DISPATCH_NOT_AVAILABLE, PROVIDER_BLOCKED_EXTERNAL`. El servidor calcula la lista con una función pura `availableActionsFor(order, grantsDelPersonal)`:

- solo lista las acciones que existen para el estado y la modalidad (`pending`: accept, reject, cancel; `accepted`: start_preparing, cancel; `preparing`: mark_ready, cancel; `ready` PICKUP: complete, cancel; `ready` DELIVERY: cancel y `dispatch`; `on_the_way` y terminales: ninguna);
- `enabled=false` + `NO_PERMISSION` si el personal no tiene el permiso en la sucursal del pedido (la web la OCULTA);
- `dispatch` (solo `ready` DELIVERY) SIEMPRE `enabled=false`: `DISPATCH_NOT_AVAILABLE` con `OWN` (llega con F28) o `PROVIDER_BLOCKED_EXTERNAL` con `PEDIDOSYA`. La web la muestra deshabilitada y diferenciada (reparto propio vs PedidosYa).

Comandos: cuerpo `AdminOrderCommandRequest {expectedStatus}` (accept, start-preparing, mark-ready, complete) o `AdminOrderReasonRequest {expectedStatus, reason}` (reject, cancel). Respuesta 200 `AdminOrderTransitionResult {order: AdminOrderSummary, transition{from, to, at, replayed, appliedByMe}, pendingActions[]}`. 200 (no 201): no se crea un recurso.

`pendingActions` (informativo, nunca se ejecuta): solo en `reject`/`cancel` (y en la repetición idempotente de esos comandos). `payment_review`: regla PROVISIONAL (P74): `payment_method_preference = 'bank_transfer'` (puede haber una transferencia por conciliar o devolver; cuando exista F24 la regla pasa a mirar `payments` mediante `OrderPaymentReadPort`). `delivery_cancellation`: solo si `OrderFulfillmentPort.inspect` informa una entrega activa (con la implementación vacía de F22, nunca). Con efectivo sin pagos registrados: `[]`.

### 4.3 Parámetros de lectura

`listAdminOrders`: `branchId`, `status` (lista separada por comas), `fulfillmentType`, `q` (2..40: `1042` o `MON-001042` => igualdad por `order_number`; otro texto => nombre del cliente, contiene, sin distinguir mayúsculas; sin búsqueda por teléfono ni correo, P70), `from`/`to` (de `placed_at`; por defecto `from = ahora − 7 días`; rango máximo 92 días), `cursor`, `limit` (1..50, 25). Orden fijo `placed_at DESC, id DESC`. Paginación por CURSOR (keyset): estable aunque lleguen pedidos nuevos mientras se pagina (un `OFFSET` desplazaría filas) y de coste constante; cursor opaco = base64url de `(placed_at, id)` validado por formato, y como el alcance se aplica siempre en la consulta, un cursor manipulado no revela nada; alterado => 400 `ORDER_CURSOR_INVALID`. Sin conteo total (costoso e innecesario: los conteos vienen del tablero).

`getAdminOrderBoard`: `branchId` opcional, `limit` (1..50, 30) por columna ACTIVA. Activas (`pending, accepted, preparing, ready, on_the_way`): todos los activos sin importar su antigüedad, los más antiguos primero. Terminales: últimas 24 h por `placed_at`, los más recientes primero, tope fijo de 10 tarjetas. `pollAfterSeconds` = 15 (constante del servidor; la web la acota a 10..60 s).

### 4.4 Errores

| HTTP | `code`                                  | Cuándo                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación estándar)                   | UUID inválido, campos desconocidos, `status` con valor fuera del catálogo, fechas sin zona, rango > 92 días                                                                                                                                               |
| 400  | `ORDER_REASON_REQUIRED`                 | `reject`/`cancel` sin motivo, vacío o < 3 caracteres                                                                                                                                                                                                      |
| 400  | `ORDER_CURSOR_INVALID`                  | cursor alterado o con formato inválido                                                                                                                                                                                                                    |
| 401  | —                                       | JWT ausente, inválido o expirado                                                                                                                                                                                                                          |
| 403  | — (`MFA_REQUIRED` de F02 si no es aal2) | no es personal activo, o falta el permiso del comando en TODOS los alcances                                                                                                                                                                               |
| 403  | `ORDER_ACTION_FORBIDDEN`                | puede ver el pedido (`orders.read` en su sucursal) pero NO tiene el permiso del comando en esa sucursal                                                                                                                                                   |
| 404  | `ORDER_NOT_FOUND`                       | el pedido no existe O su sucursal está fuera del alcance de `orders.read`: MISMO cuerpo, mismas cabeceras y un coste de consulta equivalente (anti-IDOR)                                                                                                  |
| 404  | `BRANCH_NOT_FOUND`                      | filtro `branchId` inexistente o fuera de alcance (igual que F15)                                                                                                                                                                                          |
| 409  | `ORDER_STATE_CONFLICT`                  | el estado actual ≠ `expectedStatus` (y no es una repetición idempotente): cuerpo con `current {status, updatedAt}`                                                                                                                                        |
| 422  | `ORDER_TRANSITION_INVALID`              | transición no permitida (matriz §3.2); `violations[0].code` ∈ `ORDER_TERMINAL`, `ORDER_FULFILLMENT_MISMATCH`, `ORDER_SOURCE_INVALID`, `ORDER_DISPATCH_NOT_AVAILABLE`, `ORDER_PROVIDER_BLOCKED_EXTERNAL`, `ORDER_CANCEL_NOT_ALLOWED`; cuerpo con `current` |
| 429  | `RATE_LIMITED`                          | throttle (con `Retry-After`)                                                                                                                                                                                                                              |
| 503  | `ORDERS_BUSY`                           | gate saturado, timeout o fallo reintentable de la transacción (código ya público de F20; sin códigos 5xx nuevos)                                                                                                                                          |

Para llevar `current` en 409/422 el filtro global (`http-exception.filter.ts`, lista `EXTRA_BODY_KEYS`) se amplía de forma ADITIVA con la clave `current`; sin otros cambios de comportamiento (sus pruebas existentes siguen verdes). Todo `/v1/admin` ya responde `Cache-Control: no-store` también en errores (`noStoreMiddleware`).

Orden de evaluación de un comando (el primero que falle decide; ninguna rama revela existencia): (1) JWT → (2) personal activo + permiso del comando en algún alcance + aal2 (`RequireStaff`) → (3) validación del cuerpo/UUID (400) → (4) entrada al gate (503) → (5) lectura del pedido → 404 si no existe o `orders.read` no cubre su sucursal → (6) 403 `ORDER_ACTION_FORBIDDEN` si el permiso del comando no cubre su sucursal → (7) matriz: `expectedStatus` no es origen válido del comando, terminal, modalidad o proveedor (422) → (8) idempotencia/conflicto/CAS (§5).

## 5. Concurrencia, idempotencia y atomicidad

### 5.1 Decisión: compare-and-set sobre `status`, sin migración

Los estados solo avanzan (no existen ciclos ni retrocesos; `rejected` y `cancelled` son terminales): `status` es una versión monótona y no hay problema ABA. Basta un `UPDATE … WHERE id = $1 AND status = $expected` y exigir `expectedStatus` en el cuerpo. No hace falta una columna `version` (que además obligaría a cambiar `F20`/`orders_immutable_fields`, a migrar filas y a que F28 la respete). Alternativas y descarte en ADR-0028.

### 5.2 Algoritmo (una transacción por comando, `ReadCommitted`, `timeout` 10 s)

```
gate.run(…)                                   -- ORDERS_DB_GATE, sin rejectIfWaiting (las escrituras tienen prioridad)
BEGIN
 1  SELECT id, branch_id, status, fulfillment_type, delivery_provider, payment_method_preference
      FROM app.orders WHERE id = $1                        -- sin FOR UPDATE
    404 / 403 / 422 según §4.4 (7)
 2a if status = expectedStatus:
      UPDATE app.orders SET status = $to, updated_at = clock_timestamp()
       WHERE id = $1 AND status = $expected RETURNING updated_at          -- CAS
    filas = 1 → 3
    filas = 0 → (otra transacción ganó entre 1 y 2) → 2b con el estado releído
 2b si status ≠ expectedStatus (o CAS perdido):
      releer estado actual + último evento del historial
      si status_actual = destino  Y  último evento = (old_status = expected, new_status = destino) → REPETICIÓN: 200 replayed=true, sin escribir
      si no → ROLLBACK + 409 ORDER_STATE_CONFLICT {current}
 3  INSERT INTO app.order_status_history (order_id, old_status, new_status, changed_by, reason, changed_at)
      VALUES ($1, $expected, $to, $staffId, $reason, <updated_at devuelto>)
 4  AuditService.record(tx, { actorId: staffId, branchId, entityType: 'order', entityId, action: 'order.<verbo>',
      reason, oldValues: { status }, newValues: { status } })       -- sin PII
COMMIT
```

- `clock_timestamp()` se evalúa cuando la fila se actualiza de verdad (tras esperar el candado de otra transacción), y el mismo valor es `changed_at`: así el historial queda ordenado por orden real de confirmación aunque `now()` (inicio de la transacción) no lo estaría; resuelve R1 de F21 sin depender del desempate por `id`.
- Con `ReadCommitted`, si dos transacciones hacen el `UPDATE` del mismo pedido, la segunda espera, vuelve a evaluar `WHERE status = $expected` sobre la fila confirmada y afecta 0 filas: como máximo UNA gana. Es comportamiento garantizado de PostgreSQL, pero se DEMUESTRA con prueba de integración contra PostgreSQL real (#31–#33), no con dobles.
- Historial y auditoría van en la MISMA transacción que el `UPDATE`: o están los tres o no hay ninguno (prueba de rollback #16).
- Acciones de auditoría: `order.accepted`, `order.rejected`, `order.preparation_started`, `order.marked_ready`, `order.completed`, `order.cancelled`. Valores: ids y estados (`status`, `fulfillmentType`); SIN nombre, teléfono, dirección ni notas. `reason` va en la columna `reason`.
- `pendingActions` se calcula tras el commit con un acceso de solo lectura al puerto (no puede revertir ni retrasar la transición; si F28 lo hace fallar, se registra el fallo sin PII y se devuelve el resto).

### 5.3 Reintento idempotente (decisión y riesgo)

Repetir la MISMA transición ya aplicada devuelve 200 con `transition.replayed = true` y la fila actual, SIN segunda fila de historial ni de auditoría, SIN importar quién la aplicó (`appliedByMe` lo distingue). Condición estricta: estado actual = destino Y último evento del historial exactamente `expectedStatus → destino`. Cubre el doble clic y el reenvío tras un timeout de red. Sin `Idempotency-Key`: la transición es idempotente por naturaleza (el destino es único y el CAS lo garantiza) y una clave obligaría a tabla y expiración (como F20) sin añadir seguridad.

Riesgos aceptados: (1) dos empleados que quieren lo mismo ven «éxito» y el segundo no sabe que lo hizo otro (mitigación: `appliedByMe=false` y aviso «ya lo había hecho X» sin revelar nombres: «otra persona»; el historial del detalle muestra quién); (2) en `reject`/`cancel` el segundo `reason` se descarta (el vigente es el del primero; se avisa); (3) si el último evento no coincide (historial inconsistente) se responde 409 en vez de repetir (falla segura). Una repetición exige también autorización completa (permiso + alcance), por lo que no filtra información a quien no podría hacerlo.

### 5.4 Dos empleados, dos transiciones distintas

A acepta (`expected=pending`), B rechaza (`expected=pending`) casi a la vez: gana la primera en confirmar; la otra afecta 0 filas, ve estado actual ≠ `expectedStatus`, destino distinto => 409 con `current`. Nunca hay estado imposible ni dos filas de historial para el mismo origen. A acepta y C (con vista vieja) pulsa «cancelar» con `expected=pending`: 409 con `current=accepted`; la web ofrece reintentar con la vista nueva.

### 5.5 Migración: NO hace falta (0019 NO se crea)

Todo existe en 0018: `orders` (índice `orders_branch_status_placed_idx (branch_id, status, placed_at DESC)`), `order_status_history` (índice `(order_id, changed_at)`), `audit_events`, triggers de inmutabilidad y CHECKs. `schema.prisma` sin cambios. Revisión de índices para lecturas: tablero usa el índice (`branch_id`, `status`, `placed_at`); el listado con `ORDER BY placed_at DESC` entre varios estados ordena en memoria el conjunto filtrado por sucursal+ventana (≤ 92 días, del orden de miles de filas a ~100 pedidos/día): aceptable y se verifica con `EXPLAIN` (#46). Si el volumen supera ~200 000 filas o el plan degrada, se propone entonces un índice `(branch_id, placed_at DESC, id DESC)` en una migración propia (NO ahora).

Endurecimiento OPCIONAL, NO adoptado en F22 (decide el propietario; SQL de referencia para el database-engineer, aditivo y sin tocar datos): impedir en la BD cualquier transición fuera del grafo aunque un bug de la API lo intente.

```sql
-- 0019 (OPCIONAL, no incluida): guarda de transiciones de orders.status
CREATE OR REPLACE FUNCTION "app"."orders_status_transition_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'pending'    AND NEW.status IN ('accepted', 'rejected', 'cancelled'))
        OR (OLD.status = 'accepted'   AND NEW.status IN ('preparing', 'cancelled'))
        OR (OLD.status = 'preparing'  AND NEW.status IN ('ready', 'cancelled'))
        OR (OLD.status = 'ready'      AND NEW.status = 'cancelled')
        OR (OLD.status = 'ready'      AND NEW.status = 'picked_up' AND NEW.fulfillment_type = 'PICKUP')
        OR (OLD.status = 'ready'      AND NEW.status = 'on_the_way' AND NEW.fulfillment_type = 'DELIVERY')
        OR (OLD.status = 'on_the_way' AND NEW.status = 'delivered'  AND NEW.fulfillment_type = 'DELIVERY')
    ) THEN
        RAISE EXCEPTION 'app.orders: transicion de estado % -> % no permitida', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER "orders_status_transition_guard" BEFORE UPDATE OF "status" ON "app"."orders"
    FOR EACH ROW EXECUTE FUNCTION "app"."orders_status_transition_guard"();
-- Reversión: DROP TRIGGER … ; DROP FUNCTION … (sin datos que migrar).
```

Por qué no ahora: duplica la matriz en SQL (dos fuentes que mantener), no cubre PEDIDOSYA/proveedor ni permisos, y las pruebas de F21 siembran estados directamente. La API es la fuente de verdad; la prueba #35 verifica por SQL real que ninguna ruta de F22 produce un par fuera de la matriz.

## 6. Seguridad

1. Autenticación/autorización solo en el servidor: `@RequireStaff('<permiso>')` en CADA operación (JWT → personal activo + permiso → aal2). `RequireStaff` a nivel de clase NO se usa (cada operación tiene su permiso). Un cliente con Google OAuth sin ser personal => 403.
2. Alcance por sucursal EN SQL: lectura = `scopeFor(staff, 'orders.read')`; con `allBranches` sin filtro, si no `branch_id = ANY(ids)`. Un alcance vacío es imposible tras el guard, pero el servicio devuelve vacío (nunca «todo»). Comandos: `canAccess(staff, 'orders.read', branchId)` para existencia y `canAccess(staff, permiso, branchId)` para actuar.
3. Anti-IDOR: pedido inexistente y pedido de otra sucursal => el MISMO 404 `ORDER_NOT_FOUND` (cuerpo, cabeceras y número de sentencias equivalentes). No se confirma existencia por 403. Un filtro `branchId` ajeno => 404 `BRANCH_NOT_FOUND`.
4. PII: listado y tablero solo con nombre del cliente; teléfono completo solo en el detalle; correo nunca. Sin PII en logs, auditoría ni mensajes de error (solo `requestId`, `orderId`, estado, código). `reason` no debe llevar datos personales (aviso en la web; el valor se trata como dato interno y no se registra en logs).
5. `Cache-Control: no-store` (todo `/v1/admin`); sin caché compartida, sin persistencia de datos de pedidos en `localStorage`/`sessionStorage`; claves de caché por sesión de personal (§10.2).
6. Concurrencia segura y atómica (§5); entrada validada con DTO estrictos (`whitelist`, `forbidNonWhitelisted`, sin `__proto__`).
7. Throttle (por instancia, riesgo conocido de F21 M4): `ADMIN_ORDERS_READ_THROTTLE` = 240/min por IP (`default`) y 90/min por actor (un restaurante con NAT compartido y varias pestañas sondeando a 15 s hace ~4/min por pestaña) y `ADMIN_ORDERS_COMMAND_THROTTLE` = 120/min por IP y 60/min por actor. Contadores independientes de F20/F21. El 429 incluye `Retry-After`.
8. Ningún comando llama a servicios externos (PedidosYa/Neonet), ni escribe tablas de entregas o pagos.
9. Lectura del detalle con PII no se audita (volumen y ruido); riesgo aceptado y registrado en P70 (si negocio exige trazabilidad de acceso, se añade `order.viewed` sin PII).

## 7. Rendimiento

Presupuesto de sentencias SQL del dominio (sin contar la lectura de `grants` del personal, 1 por solicitud, ya existente): listado ≤ 2 (página con conteo de unidades y nombre de sucursal agregados; sin N+1); tablero ≤ 3; detalle ≤ 7 (pedido+sucursal, líneas+modificadores, promociones, dirección, historial, actores por lote); comando ≤ 6 (lectura, `UPDATE`, historial, auditoría, y en repetición/conflicto una relectura). Se MIDE contra PostgreSQL real en la int-spec (no se afirma antes).

Tablero (esquema, en SQL con parámetros; no se interpola nada del cliente):

```sql
-- 1) conteos y espera (todas las columnas)
SELECT status, count(*)::int AS cnt, min(placed_at) AS oldest
  FROM app.orders
 WHERE (:allBranches OR branch_id = ANY(:branchIds::uuid[]))
   AND (status IN ('pending','accepted','preparing','ready','on_the_way') OR placed_at >= :terminalSince)
 GROUP BY status;
-- 2) tarjetas: N por columna, con unidades y sucursal en la misma sentencia
SELECT o.*, b.name AS branch_name,
       (SELECT COALESCE(sum(i.quantity), 0)::int FROM app.order_items i WHERE i.order_id = o.id) AS item_count
  FROM unnest(:statuses::text[]) AS s(status)
 CROSS JOIN LATERAL (
       SELECT id, order_number, status, branch_id, fulfillment_type, delivery_provider, customer_name, total,
              payment_method_preference, scheduled_for, placed_at, updated_at
         FROM app.orders
        WHERE status = s.status AND (:allBranches OR branch_id = ANY(:branchIds::uuid[]))
          AND (s.status IN (…activos…) OR placed_at >= :terminalSince)
        ORDER BY placed_at ASC|DESC, id LIMIT :limitFor(s.status)) o
  JOIN app.branches b ON b.id = o.branch_id;
```

Columnas mínimas (sin `customer_phone`, `customer_email`, `notes` ni importes de desglose en tablero/listado), `items` agregados (no N+1), filtros de sucursal y estado en SQL, nunca en Next. `status` y `branchId` llegan validados contra el catálogo/UUID. Gate: se reutiliza `ORDERS_DB_GATE` (no hay gate nuevo): lecturas con `rejectIfWaiting: 2` (el sondeo del tablero no monopoliza la cola; las plazas 3–8 siguen reservadas a escrituras, de clientes y del personal) y comandos sin admisión. Riesgo aceptado: tablero, tracking de clientes y creación comparten cupo (con `DB_POOL_MAX` = 5 el cupo de pedidos es 1; ver F21 13.1): el backoffice sondea a 15 s por pestaña (~4/min) y el volumen es bajo; se mide con performance-reviewer y, si hace falta, se sube `DB_POOL_MAX` o se crea un gate propio con ADR (no antes).

## 8. Auditoría y trazabilidad

Cada transición deja: (a) la fila de `order_status_history` (`old_status`, `new_status`, `changed_by` = `staff_users.id`, `reason`, `changed_at`), (b) el evento `order.*` de `audit_events` (`actor_id` = el mismo `staff_users.id`, `branch_id`, `entity_type='order'`, `old_values/new_values` solo con `status`), ambos en la transacción del `UPDATE`. Una repetición idempotente NO escribe nada. Un conflicto o rechazo (409/422/403/404) no escribe auditoría de negocio (el filtro/logs registran `requestId` y código). `changed_by` y `reason` jamás salen en F21 (garantizado y probado allí); en F22 solo los ve el personal con `orders.read`.

## 9. Puertos y contrato con F28/F29/F24 (solo interfaz)

Ubicación: `sushimon-api/src/orders/ports/`. Implementaciones vacías registradas en `OrdersModule`; F28/F29/F24 las reemplazan sin tocar los comandos.

```ts
// F22 CONSUME (lectura, tras el commit de cancel/reject y para availableActions futuras)
export interface OrderFulfillmentPort {
  inspect(order: {
    orderId: string;
    branchId: string;
    fulfillmentType: 'PICKUP' | 'DELIVERY';
    deliveryProvider: 'OWN' | 'PEDIDOSYA' | null;
    status: OrderLifecycleStatus;
  }): Promise<{ activeDelivery: boolean; pendingActions: 'delivery_cancellation'[] }>;
}
// NoDeliveryFulfillment (F22): { activeDelivery: false, pendingActions: [] }
export interface OrderPaymentReadPort {
  inspect(
    orderId: string,
    preference: 'cash' | 'bank_transfer' | null,
  ): Promise<{ pendingActions: 'payment_review'[] }>;
}
// ProvisionalPaymentRule (F22): bank_transfer => ['payment_review']; si no, []
```

F28 ESCRIBE `ready → on_the_way` y `on_the_way → delivered` reutilizando el MISMO servicio interno de transiciones (`OrderTransitionsService.apply(tx, { orderId, expectedStatus, to, actor: { kind: 'system'|'staff', staffId? }, reason? })`): misma matriz, mismo CAS, misma fila de historial y auditoría, en SU transacción (F28 abre la suya y le pasa `tx`). F22 NO escribe tablas de entregas ni solicita proveedores; F29 queda `BLOCKED_EXTERNAL` y un mock nunca confirma entregas reales. Que `PEDIDOSYA` solo tenga acciones hasta `ready` queda codificado en la matriz (§3.2), no en la UI.

## 10. Web

### 10.1 Estructura y modos

`features/bo-orders` se conserva (KanbanBoard, OrderCard, OrdersTable, OrderDrawer, RejectModal, OrdersScreen) y pasa a consumir un modelo de vista `AdminOrderView` derivado de los esquemas reales (`AdminOrderSummary`/`AdminOrderDetail`) con `availableActions` del servidor: las pantallas dejan de decidir permisos y transiciones por su cuenta (`checkTransition` solo se usa en el mock y en pruebas). Un solo camino de datos en ambos modos:

- `http`: servicios nuevos `src/services/admin-orders.ts` (`listAdminOrders`, `getAdminOrderBoard`, `getAdminOrder` y los seis comandos), `paths.adminOrders*` en `lib/data-access/paths.ts`, alias de tipos en `models.ts`. NUNCA llama a `/v1/backoffice/orders*`, `/v1/demo/*` ni al despacho simulado.
- `mock`: handler nuevo `src/mocks/handlers/admin-orders.ts` que responde esas MISMAS rutas con la forma real, derivando del almacén de `DraftOrder` (mapeo `received↔pending`, `delivered` → `picked_up` en PICKUP), aplicando la misma matriz, `expectedStatus`, 409/422/403 y `availableActions`, y rotulado «Simulación». Las rutas legadas `/v1/backoffice/orders` y `…/dispatch` se conservan SOLO en el mock para el panel, entregas e incidencias (siguen `MOCK_ONLY`, fuera de alcance). Se evita romper `orders.test.tsx`: sus fixtures se actualizan a la forma real a través del mock; los tests que afirmaban llamadas a `/v1/backoffice/orders` se reescriben (lista en §11, #56).

Mismo patrón de habilitación que `useAdminBanners` (consulta habilitada con sesión de personal; la API decide 401/403/404).

### 10.2 Claves de caché y datos de otra sucursal

`queryKeys.backoffice.adminOrders`: `board(staffKey, branchId|'all')`, `list(staffKey, filtros)`, `detail(staffKey, id)`. `staffKey` = `staffId` de la sesión: al cerrar sesión o cambiar de persona se descarta todo lo `['backoffice','adminOrders']`. La sucursal activa del selector del shell va SIEMPRE en la clave; NO se usa `placeholderData: keepPreviousData` entre sucursales o filtros distintos (jamás se muestra el tablero de la sucursal anterior mientras carga la nueva; esqueleto en su lugar). Sin `PersistQueryClient` ni almacenamiento del contenido. `gcTime` 60 s.

### 10.3 Polling controlado (TanStack Query; sin WebSockets)

| Aspecto              | Regla                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quién sondea         | SOLO la vista visible: el tablero (`getAdminOrderBoard`) en modo tablero, el listado (primera página) en modo tabla. El detalle no sondea: se refresca al abrir, tras un comando y cuando el `updatedAt` de su tarjeta cambia                        |
| Intervalo            | `clamp(pollAfterSeconds × 1000, 10 000, 60 000)`; defecto 15 000 ms; configurable por variable pública `NEXT_PUBLIC_BO_ORDERS_POLL_MS` solo para pruebas (acotada igual)                                                                             |
| Pestaña oculta       | `refetchIntervalInBackground: false`; al volver, refetch inmediato (`refetchOnWindowFocus`, `staleTime` 5 s)                                                                                                                                         |
| Sin solapamiento     | una solicitud en vuelo a la vez; la siguiente se programa al terminar; `signal` cancelable al cambiar de sucursal/filtro o desmontar                                                                                                                 |
| Error de red/5xx/503 | `retry: false` en la consulta + backoff `min(120 s, 15 s × 2^(n−1))` ±20 % de jitter; conserva y atenúa los datos previos DE LA MISMA clave con «Sin conexión: última actualización hace X»; tras 8 fallos seguidos se detiene y ofrece «Reintentar» |
| 429                  | espera `Retry-After` (acotada a [5, 120] s) y continúa                                                                                                                                                                                               |
| 401/403              | detiene el polling y muestra «sesión/permiso» (no reintenta)                                                                                                                                                                                         |
| Invalidación         | tras CADA comando (éxito, 409 o 422) se invalidan tablero, listado y detalle de esa clave                                                                                                                                                            |
| Reutilización        | la política de intervalo/backoff/visibilidad se extrae de `features/tracking/use-tracking-poll.ts` a un helper compartido SIN cambiar el comportamiento de F21 (sus pruebas deben seguir verdes); si no es limpio, se duplica la parte mínima        |

Presupuesto: a 15 s son 4 solicitudes/min por pestaña; 5 pestañas en un mismo NAT = 20/min ≪ 240/min por IP y 90/min por actor.

### 10.4 Pedidos nuevos (indicador discreto)

El tablero compara los ids `pending` del sondeo actual con los del anterior (en memoria, sin persistir): el PRIMER sondeo fija la línea base (no avisa). Ids nuevos => contador «N nuevos» en la cabecera de la columna `Nuevo`, tarjetas resaltadas hasta que la persona interactúa con la lista o enfoca la pestaña, `aria-live="polite"` con un único mensaje por tanda («1 pedido nuevo: MON-001042») y el contador en `document.title` mientras la pestaña esté oculta. SONIDO: opt-in en un conmutador del encabezado (desactivado por defecto, preferencia en `localStorage` bajo `monsushi-bo-orders-sound`; es una preferencia de UI, no autenticación), solo suena por un pedido nuevo y tras el gesto del usuario que lo activó; nunca se reproduce automáticamente ni al cargar. Respeta `prefers-reduced-motion` para el resaltado.

### 10.5 Pantallas y estados

- Tablero: 9 columnas del catálogo agrupadas como el prototipo (Nuevo/Aceptado/Preparación/Listo/En camino/Finalizados), conteos reales del servidor y «+N más» con enlace a la tabla filtrada; cada tarjeta muestra número, tipo/proveedor (propia vs PedidosYa diferenciados), cliente, unidades, total y antigüedad (a partir de `generatedAt`, nunca del reloj del cliente sin corrección); resalta el `pending` más antiguo.
- Tabla: filtros (estado, tipo, rango, búsqueda por número/nombre) enviados al servidor; «Cargar más» con `cursor`; sin ordenar en cliente algo que el servidor ya ordena.
- Detalle (drawer): líneas con extras, promociones, totales, dirección (DELIVERY), contacto con teléfono, notas del cliente, «Sin pago registrado» + preferencia, historial con hora, estado, actor y motivo, y los botones salidos de `availableActions`.
- Botones: `accept` (primario), `reject`/`cancel` (modal con motivo ≥ 3 caracteres, contador, aviso de datos personales, confirmación; el contenido se envía recortado), `start_preparing`, `mark_ready`, `complete` («Entregado en sucursal»). `dispatch` aparece DESHABILITADO con texto honesto: entrega propia «La asignación de repartidor llegará con la gestión de entregas» y PedidosYa «Integración pendiente de documentación del proveedor». Sin acción de PedidosYa que simule éxito.
- Mutaciones: sin actualización optimista (el estado lo decide el servidor); botón deshabilitado y `aria-busy` mientras la solicitud está en vuelo (por pedido, anti doble clic) además del CAS del servidor; tras éxito, `setQueryData` de la tarjeta y refetch.
- Resultados: 200 normal (toast del nuevo estado + `pendingActions` visibles como aviso informativo «Revisar pago pendiente» sin ejecutar nada); 200 `replayed` => «Este pedido ya estaba en ese estado» (distinguiendo `appliedByMe`); 409 => «El pedido cambió: ahora está X» + refresco con `current`, sin reintentar solo; 422 => mensaje por `violations[0].code`; 403 `ORDER_ACTION_FORBIDDEN` => «No tienes permiso en esta sucursal»; 404 => «Pedido no disponible» + refresco; 400 `ORDER_REASON_REQUIRED` => error de campo; 429/503 => «Reintenta en N s» con `Retry-After`.
- Accesibilidad e i18n: es/en (`backoffice.orders.*`), foco devuelto al origen al cerrar modales, objetivos ≥ 44 px, tema claro/oscuro, móvil. Fechas en `America/Guatemala`.
- Cambio de sucursal: selector existente del shell; cambia la clave, cancela las solicitudes en vuelo y muestra esqueleto (nunca datos de la sucursal anterior).

## 11. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec contra PostgreSQL real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                                                              | Nivel   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Matriz §3.2 tabla-conducida: cada par (modalidad × proveedor × origen × comando) da ✓ o el código de violación exacto (incluye terminales, `on_the_way → cancelled`, `complete` en DELIVERY, `PEDIDOSYA`)         | U       |
| 2   | `availableActionsFor`: por estado × modalidad × permisos (`NO_PERMISSION`, `dispatch` deshabilitada con `DISPATCH_NOT_AVAILABLE`/`PROVIDER_BLOCKED_EXTERNAL`, terminales vacías)                                  | U       |
| 3   | Permiso por comando: sin `orders.accept` no acepta; `orders.prepare` cubre start-preparing y mark-ready; `orders.read` solo lee; permisos legados no sirven                                                       | S, E    |
| 4   | Sin aal2 (`aal1`) => 403 `MFA_REQUIRED`; sin personal activo (cliente Google) => 403; sin token => 401                                                                                                            | E       |
| 5   | Alcance de lectura EN SQL: manager de A no lista, ve ni cuenta pedidos de B (listado, tablero y conteos); admin global ve todas                                                                                   | S, I    |
| 6   | Pedido de otra sucursal e inexistente => MISMO 404 `ORDER_NOT_FOUND` (cuerpo y cabeceras idénticos) en detalle y en los seis comandos; filtro `branchId` ajeno => 404 `BRANCH_NOT_FOUND`                          | E, I    |
| 7   | Ve el pedido (`orders.read` en A) pero sin `orders.cancel` en A => 403 `ORDER_ACTION_FORBIDDEN`; rol con permiso solo en B => 404                                                                                 | S, I    |
| 8   | Motivo: `reject`/`cancel` sin motivo, vacío, de espacios o de 2 caracteres => 400 `ORDER_REASON_REQUIRED`; 281 caracteres => 400; con motivo se recorta y se guarda; otros comandos con `reason` => 400           | U, E    |
| 9   | Cuerpo: `expectedStatus` ausente o fuera del catálogo => 400; campos desconocidos y `__proto__` => 400; UUID inválido => 400 sin BD                                                                               | E       |
| 10  | `expectedStatus` que no es origen del comando => 422 `ORDER_SOURCE_INVALID` aunque el pedido esté en ese estado                                                                                                   | S, E    |
| 11  | Terminales: cualquier comando sobre `delivered`/`picked_up`/`rejected`/`cancelled` => 422 `ORDER_TERMINAL`, nada escrito                                                                                          | S, I    |
| 12  | `complete` sobre DELIVERY (OWN y PEDIDOSYA) => 422; sobre PICKUP `ready` => 200 `picked_up`                                                                                                                       | S, E, I |
| 13  | `PEDIDOSYA`: accept → start → ready funcionan; ningún comando produce `on_the_way`/`delivered`; no hay llamada a ningún cliente externo                                                                           | S, I    |
| 14  | `cancel` desde `pending/accepted/preparing/ready` => 200; desde `on_the_way` => 422 `ORDER_CANCEL_NOT_ALLOWED`; desde terminal => 422                                                                             | S, I    |
| 15  | Éxito atómico: UNA fila de historial (`old_status`, `new_status`, `changed_by` = staffId, `reason`, `changed_at` = `updated_at` devuelto) y UN evento `order.*` con `actor_id` y sin PII, en la misma transacción | S, I    |
| 16  | Rollback: si falla el historial o la auditoría no cambia `orders.status` ni queda historial/auditoría parcial                                                                                                     | S, I    |
| 17  | `changed_at` posterior al de la fila previa aunque la segunda transacción empezara antes (candado): orden `changed_at, id` consistente con el orden real                                                          | I       |
| 18  | `orders_immutable_fields`: F22 no altera sucursal, modalidad, importes ni `placed_at`; solo `status` y `updated_at`                                                                                               | I       |
| 19  | 409: `expectedStatus` ≠ estado actual sin ser repetición => `ORDER_STATE_CONFLICT` con `current {status, updatedAt}` y nada escrito                                                                               | S, E, I |
| 20  | Repetición idempotente: mismo comando dos veces (mismo actor) => 2.º 200 `replayed=true`, `appliedByMe=true`, UNA fila de historial y UN evento de auditoría                                                      | S, E, I |
| 21  | Repetición por OTRO empleado con permiso => 200 `replayed=true`, `appliedByMe=false`; sin permiso/alcance => NO hay repetición (403/404)                                                                          | S, I    |
| 22  | Repetición con motivo distinto en `cancel`: conserva el motivo original; no escribe                                                                                                                               | S, I    |
| 23  | Historial inconsistente (último evento no coincide) => 409, nunca falsa repetición                                                                                                                                | S, I    |
| 24  | `reject` y `cancel` devuelven `pendingActions`: `payment_review` con `bank_transfer`, `[]` con efectivo; `delivery_cancellation` solo si el puerto lo informa (doble de prueba)                                   | U, S    |
| 25  | El puerto nunca se invoca antes del commit ni puede revertirlo; un fallo del puerto no tumba el comando                                                                                                           | S       |
| 26  | Listado: filtros `status` (csv), `fulfillmentType`, `q` por número (`1042`, `MON-001042`) y nombre (comodines literales, sin PII de teléfono), `from/to`, rango > 92 días => 400                                  | U, E, I |
| 27  | Keyset: sin duplicados ni saltos al insertar pedidos nuevos entre páginas; `nextCursor` null en la última; cursor alterado => 400 `ORDER_CURSOR_INVALID`; cursor de otra sucursal no filtra datos                 | I, E    |
| 28  | Tablero: 9 columnas en orden fijo, `count` real > tarjetas mostradas con `hasMore`, activas antiguas visibles, terminales solo < 24 h, `summary.pending/oldestPendingAt`, `pollAfterSeconds`                      | S, I    |
| 29  | Presupuesto de sentencias: listado ≤ 2, tablero ≤ 3, detalle ≤ 7, comando ≤ 6 (contador; 50 pedidos sin N+1 de líneas/unidades/actores)                                                                           | S, I    |
| 30  | Detalle: snapshots idénticos a F20, `payment.status = NOT_STARTED`, teléfono completo, sin correo, `history` con `actorName` (null para la creación) y `historyTruncated` con > 50 eventos                        | S, I    |
| 31  | CONCURRENCIA real: dos solicitudes simultáneas `accept` (mismo actor) => una escribe, la otra `replayed`; una fila de historial                                                                                   | I       |
| 32  | CONCURRENCIA real: `accept` y `reject` simultáneos (dos actores) => una 200 y la otra 409; estado final y historial coherentes; sin par imposible                                                                 | I       |
| 33  | CONCURRENCIA real: 20 solicitudes mezcladas sobre el mismo pedido => ninguna sale del grafo, nunca más de una fila por transición                                                                                 | I       |
| 34  | Gate: saturación => 503 `ORDERS_BUSY` con `Retry-After`; lecturas con `rejectIfWaiting: 2`, comandos sin; libera el cupo                                                                                          | S       |
| 35  | Ninguna secuencia de comandos de F22 produce un par fuera de §3.2 (barrido exhaustivo por SQL real sobre todos los estados y modalidades)                                                                         | I       |
| 36  | Throttle propio de lectura y de comando: 429 `RATE_LIMITED` con `Retry-After`; contadores independientes de F20/F21                                                                                               | E       |
| 37  | Cabeceras: `Cache-Control: no-store` también en 400/401/403/404/409/422/429/503                                                                                                                                   | E       |
| 38  | Logs y auditoría sin PII (inspección con valores sembrados: nombre, teléfono, dirección, notas, motivo)                                                                                                           | S, E    |
| 39  | F21 sigue sin exponer `changed_by`/`reason` tras una transición de F22; el seguimiento público muestra la nueva fase (cliente y tablero consistentes)                                                             | I, E    |
| 40  | Contrato: `contracts:check` verde tras implementar (9 operaciones con sus códigos 200/400/401/403/404/409/422/429/503); respuestas validan contra los esquemas                                                    | U, E    |
| 41  | Filtro global: `current` se propaga en 409/422 y no se filtra ninguna otra clave; pruebas previas del filtro intactas                                                                                             | U       |
| 42  | `AdminOrdersController`: cada ruta tiene `@RequireStaff` con SU permiso; ninguna operación queda sin decorador (prueba de reflexión)                                                                              | U       |
| 43  | Web: `useAdminOrderBoard` — intervalo desde `pollAfterSeconds` acotado a [10, 60] s, defecto 15 s; pausa con pestaña oculta; refetch al volver; sin solapamiento; cancelación al cambiar de sucursal              | W       |
| 44  | Web: backoff con jitter y tope, parada tras 8 fallos con «Reintentar»; 429 respeta `Retry-After`; 401/403 detienen                                                                                                | W       |
| 45  | Web: claves por `staffKey`+sucursal+filtros; al cambiar de sucursal NO se muestra el tablero anterior (esqueleto); al cerrar sesión se descarta la caché; sin persistencia                                        | W       |
| 46  | `EXPLAIN` del tablero usa `orders_branch_status_placed_idx`; el listado no hace seq-scan sobre la ventana de 92 días con datos sembrados                                                                          | I       |
| 47  | Web: indicador de nuevos — primera carga sin aviso; ids nuevos => contador, resaltado, un solo `aria-live`, título con contador al estar oculta; se limpia al interactuar                                         | W       |
| 48  | Web: sonido DESACTIVADO por defecto; no suena al cargar ni sin activarlo; opt-in persiste solo la preferencia; suena una vez por pedido nuevo                                                                     | W       |
| 49  | Web: botones salen de `availableActions` (`NO_PERMISSION` oculta; `dispatch` deshabilitada con texto distinto para OWN y PEDIDOSYA; terminales sin botones)                                                       | W       |
| 50  | Web: comando — deshabilitado mientras está en vuelo (anti doble clic), sin actualización optimista, refetch de tablero/lista/detalle tras éxito, 409 y 422                                                        | W       |
| 51  | Web: `reject`/`cancel` exigen motivo ≥ 3 (recortado), muestran el aviso de datos personales y envían `expectedStatus`                                                                                             | W       |
| 52  | Web: manejo de 200 `replayed` (propio y de otra persona), 409 (muestra el estado actual), 422 por código, 403, 404, 429/503                                                                                       | W       |
| 53  | Web: `pendingActions` se muestran como aviso informativo y NO ejecutan ninguna llamada                                                                                                                            | W       |
| 54  | Web: detalle — líneas, extras, promociones, totales, dirección solo en DELIVERY, teléfono, «Sin pago registrado», historial con actor y motivo; fechas en `America/Guatemala`                                     | W       |
| 55  | Web `http`: no se invoca `/v1/backoffice/orders*`, `/v1/demo/*` ni el modal de despacho simulado; `mock`: handler responde la forma real y la misma matriz                                                        | W       |
| 56  | Paridad mock↔contrato (`parity.test.ts`) y reescritura de `orders.test.tsx`/`order-view.test.ts` a la forma real sin perder cobertura previa; misma tabla de casos (#1) en la matriz del mock                     | W       |
| 57  | i18n es/en completo (`backoffice.orders.*`: estados, acciones, errores, avisos)                                                                                                                                   | W       |
| 58  | Playwright contra la API real con pedidos sembrados: aceptar → preparar → listo → completar PICKUP en pantalla; el seguimiento público de F21 refleja cada fase                                                   | P       |
| 59  | Playwright: dos pestañas con dos empleados actúan a la vez sobre el mismo pedido => una ve el éxito y la otra el aviso de conflicto/repetición, sin estado inconsistente                                          | P       |
| 60  | Playwright: encargado de la sucursal A solo ve su sucursal; por URL/ID directo de un pedido de B ve «no disponible»                                                                                               | P       |
| 61  | Playwright: pedido nuevo creado por la tienda aparece en el siguiente sondeo con el indicador (sin sonido); a11y (axe) claro/oscuro, móvil Pixel 7, `prefers-reduced-motion`                                      | P       |

## 12. Criterios de aceptación

1. Seis comandos con permiso por comando, alcance por sucursal y aal2; matriz §3.2 exacta; nada fuera de ella llega a la BD.
2. Dos acciones simultáneas sobre un pedido producen a lo sumo UNA transición y una fila de historial por transición, demostrado contra PostgreSQL real; la otra recibe 409 o repetición idempotente según §5.
3. Cada transición deja historial (quién, motivo, cuándo) y auditoría en la misma transacción; motivo obligatorio en rechazo y cancelación; el cliente no ve motivo ni actor.
4. Un encargado nunca lee ni opera pedidos de otra sucursal; inexistente y ajeno son indistinguibles.
5. Tablero y listado con conteos reales, sin N+1, filtrados en SQL, paginación estable; tablero y detalle de la web contra la API real con polling controlado y sin datos de otra sucursal.
6. Entrega: ninguna ruta de F22 despacha, asigna ni escribe entregas/pagos; PedidosYa sin acciones de despacho (`BLOCKED_EXTERNAL`); `cancel`/`reject` informan `pendingActions` sin ejecutarlas.
7. `pnpm contracts:check` y `pnpm check` verdes; int-spec contra PostgreSQL real ejecutada (sin ella el estado no pasa de `API_IMPLEMENTED`).

## 13. Riesgos

| #   | Riesgo                                                                                                                                  | Mitigación                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Dos fuentes de la matriz (API y mock web) divergen                                                                                      | Tabla de casos idéntica en #1 y en el mock (#56); la web nunca decide permisos: usa `availableActions`; en `http` el mock no participa                                      |
| R2  | El CAS depende de `ReadCommitted` y de que NO haya otro escritor de `orders.status`                                                     | Un solo servicio de transiciones (también para F28, §9); prueba #35 por SQL; endurecimiento opcional por trigger (§5.5)                                                     |
| R3  | Repetición idempotente oculta que otra persona actuó                                                                                    | `appliedByMe`, aviso y `history` con actor (§5.3)                                                                                                                           |
| R4  | Sondeo del tablero compite con la creación de pedidos por el gate                                                                       | `rejectIfWaiting: 2`, 15 s, presupuesto de sentencias, medición (performance-reviewer); `DB_POOL_MAX` y gate propio con ADR si hace falta                                   |
| R5  | `payment_review` por preferencia es solo una heurística                                                                                 | Rotulado provisional (P74); F24 la sustituye con `payments` reales                                                                                                          |
| R6  | Cocina puede rechazar pero no cancelar; `staff` no puede completar                                                                      | P69; se refleja tal cual en `availableActions` (no se parcha el RBAC aquí)                                                                                                  |
| R7  | Teléfono completo visible al personal con `orders.read` y lectura sin auditoría                                                         | P70; el alcance por sucursal limita la exposición; auditoría de lectura si negocio la exige                                                                                 |
| R8  | Un pedido activo antiguo sin atender                                                                                                    | El tablero lo muestra siempre (activas sin límite de antigüedad) y resalta `oldestPendingAt`; sin auto-rechazo (P73)                                                        |
| R9  | Throttles por instancia (F21 M4)                                                                                                        | Aceptado; defensa en profundidad                                                                                                                                            |
| R10 | Desfase de reloj entre instancias en `changed_at`                                                                                       | Se usa `clock_timestamp()` de la BD, no el reloj de la API                                                                                                                  |
| R11 | Backoffice, F20 y F21 comparten `ORDERS_DB_GATE` (sin gate propio); el guard de personal añade 1 sentencia por solicitud FUERA del gate | Aceptado: producción requiere `DB_POOL_MAX >= 9`; las lecturas del backoffice usan `rejectIfWaiting: 2`; medir (performance-reviewer) antes de crear un gate propio con ADR |
| R12 | `actorName` (nombre del empleado) visible con `orders.read` en el historial del detalle: PII del personal                               | Aceptado: solo nombre (nunca id ni correo), solo personal con `orders.read` en la sucursal del pedido; revisar si negocio lo restringe (R3/P70)                             |

## 14. Reparto

- **api-engineer** (`sushimon-api/src/orders/admin/` dentro de `OrdersModule`, sin módulo nuevo): `order-transitions.ts` (matriz pura, `availableActionsFor`, `commandSpec`) + `.spec.ts`; `admin-orders.controller.ts` (`@RequireStaff` por operación; `board` ANTES de `:id`; `ParseUUIDPipe`); `admin-orders-query.service.ts`, `admin-orders-commands.service.ts`; `admin-orders.repository.ts` (SQL de §7 con `$queryRaw` parametrizado y el CAS de §5.2) + `.spec.ts`; `admin-orders.mapper.ts`; DTOs con `class-validator` (`whitelist`/`forbidNonWhitelisted`); cursor keyset; `ports/order-fulfillment.port.ts` y `ports/order-payment-read.port.ts` con implementaciones vacías; `OrderTransitionsService` reutilizable por F28; errores `order-admin-errors.ts`; `ADMIN_ORDERS_READ_THROTTLE`/`ADMIN_ORDERS_COMMAND_THROTTLE` en `app-throttler.guard.ts`; `current` en `EXTRA_BODY_KEYS` del filtro; `OrdersModule` registra controlador y proveedores. Los 9 `ApiResponse` con los códigos del contrato. Pruebas S/E (`test/admin-orders.e2e-spec.ts`) e I (`test/admin-orders.int-spec.ts`: concurrencia real #31–#35, SQL sembrado y limpiado con `app.allow_order_cleanup`).
- **web-engineer**: `services/admin-orders.ts`, `paths`, `models`, `query-keys` (`backoffice.adminOrders`), hooks (`features/bo-orders/hooks`, polling §10.3, `useNewOrderSignal`), `AdminOrderView` y ajuste de KanbanBoard/OrderCard/OrdersTable/OrderDrawer/RejectModal (+ modal de cancelación), `OrdersScreen`; handler mock `mocks/handlers/admin-orders.ts` + fixtures; i18n `backoffice.orders.*`; `docs/ui/mock-data-strategy.md`; helper de polling compartido (sin cambiar F21).
- **database-engineer**: NO hay migración. Revisar `EXPLAIN` (#46), confirmar que el trigger opcional de §5.5 no se aplica sin decisión, y validar el SQL del tablero.
- **security-reviewer** (solo lectura) tras la API: 404 uniforme, `ORDER_ACTION_FORBIDDEN` vs 404, alcance en SQL, PII, `reason`, aal2, throttles, cursor. **performance-reviewer**: presupuesto de sentencias, gate, plan del listado. **qa-engineer**: matriz §11. **ui-ux-reviewer**: tablero, modal de motivo, deshabilitados de despacho, indicador de nuevos y a11y.

## 15. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                                           | Estado                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato `admin-orders` (9 operaciones, esquemas `AdminOrder*`) | `CONTRACT_DEFINED` (`pnpm contracts:check` verde con la API implementada)                                                                          |
| API de lectura y comandos                                       | `API_IMPLEMENTED`; SQL, concurrencia y presupuesto verificados contra PostgreSQL real (ver 15.1)                                                   |
| Migración                                                       | No hay (0019 no se crea); endurecimiento por trigger descrito como opcional, NO adoptado                                                           |
| Web de pedidos del backoffice                                   | `INTEGRATED` contra la API real con credenciales de prueba firmadas (ver 15.1); Panel, Entregas y despacho siguen `MOCK_ONLY`                      |
| Estados producidos                                              | `pending → accepted → preparing → ready → picked_up/rejected/cancelled`; `on_the_way/delivered` los produce F28 (puerto definido, sin implementar) |
| Pago                                                            | «Sin pago registrado»; F24; `pendingActions` de pago es regla provisional                                                                          |
| Entrega propia (asignación/despacho)                            | Pendiente de F28; `dispatch` informada deshabilitada                                                                                               |
| PedidosYa                                                       | `BLOCKED_EXTERNAL`: sin despacho, sin estados externos, sin simulaciones presentadas como reales                                                   |
| Notificaciones al cliente por cambio de estado                  | F31                                                                                                                                                |

### 15.1 Verificación real (2026-11-18, BD de pruebas de Supabase, datos `zz-` sembrados y borrados)

- **`test/admin-orders.int-spec.ts`: 10/10** contra PostgreSQL real: alcance en SQL, éxito atómico (historial y auditoría coherentes, `changed_at = updated_at`), reversión si falla la auditoría, terminales/PEDIDOSYA/DELIVERY, 409 con `current`, repetición idempotente, concurrencia real, barrido exhaustivo (3 modalidades × 9 estados × 6 comandos: ningún par fuera de la matriz y ningún `on_the_way`/`delivered`), filtros y keyset, tablero, presupuesto de sentencias, detalle y `EXPLAIN`. La primera ejecución falló por tiempo (siembra remota lenta y límite de 15 conexiones del pooler de sesión): se ajustaron timeouts y se acotó la concurrencia de la siembra; no por lógica.
- **API real (puerto propio, JWT HS256 de prueba firmados en memoria con `aal2` + `amr totp`)**: 401 sin token; `MFA_REQUIRED` con `aal1`; el gerente de la sucursal A no ve ni opera pedidos de B (404 con el mismo cuerpo que un pedido inexistente, salvo `requestId`); cocina puede rechazar con motivo pero no cancelar (403); motivo obligatorio (400); PEDIDOSYA no puede saltarse la matriz (422); `complete` en DELIVERY 422; 409/422 con `current`; **6 aceptaciones simultáneas por 2 actores dejaron exactamente 1 fila de historial y 1 evento de auditoría**; repetición idempotente 200; cursor inválido 400; `branchId` ajeno 404; sin PII de más en el listado; `Cache-Control: no-store`.
- **Compatibilidad F21**: el seguimiento del cliente refleja `accepted`, `ready` y `rejected` (terminal) desde el historial real y NO expone el motivo, el actor ni nada interno.
- **Navegador real (Chromium, web en modo `http` contra esa API)**: tablero con datos reales, aceptar, 409 genuino (otro actor canceló) con aviso «cambió: ahora está «Cancelado»… revisa y vuelve a decidir» y refetch, «otra persona ya lo había hecho» en la repetición idempotente, rechazo desde el detalle con motivo obligatorio (modal con número de pedido y aviso de datos personales), un pedido nuevo creado por SQL aparece solo en ~14 s con indicador «nuevo» y aviso persistente, detalle con «Sin pago registrado», PedidosYa con «Simulación»/despacho deshabilitado, móvil 390 px sin desbordamiento horizontal.
- **Limitaciones de esta verificación (no es verificación de producción)**: la autenticación del navegador usó la sesión de demostración de la web (`AUTH_SOURCE=mock`) y los encabezados `Authorization` con tokens de prueba se inyectaron en las peticiones a la API; NO se ejerció el inicio de sesión real con Google/Supabase ni el desafío TOTP. Con la API real, el selector de sucursal del shell muestra el UUID en lugar del nombre; el panel inferior del detalle puede solapar el aviso de pago en alturas bajas; Panel/Entregas siguen llamando a rutas heredadas `/v1/backoffice/*` que responden 404 (`MOCK_ONLY`).
- **NO verificado**: personal real con sesión Supabase y TOTP, carga del sondeo concurrente contra el gate (`DB_POOL_MAX` 3/5/9), `EXPLAIN` con volumen (decenas de miles de filas), comportamiento con `DB_POOL_MAX` de producción.

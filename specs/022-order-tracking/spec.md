# F21 — Consulta y seguimiento del pedido del cliente

**Rama**: `feature/F21-order-tracking` (desde `develop` 313a564, que incluye F20) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: API + WEB (seguimiento cliente)
**Dependencias**: F20 (pedidos, historial `order_status_history`, token de invitado) · **Integración posterior**: F22 (escribe los estados), F28 (entregas propias), F29 (tracking externo, `BLOCKED_EXTERNAL`), F31 (avisos) · **Decisiones**: `docs/adr/0027-seguimiento-pedidos.md` · **Pendientes**: P61–P67 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración inicial: `CONTRACT_DEFINED`** (operación `getOrderTracking` y esquemas `OrderTracking*`/`OrderPublicStatus` en `openapi.yaml`; sin migración, API ni web). `pnpm contracts:check` queda rojo SOLO por `GET /v1/orders/{id}/tracking#getOrderTracking` sin implementar (comprobado). Estado de la feature en el backlog: no se edita aquí (`docs/BACKLOG.md` lo actualiza el propietario al fusionar). PedidosYa real: `BLOCKED_EXTERNAL`.

## 1. Alcance y fuera de alcance

Dentro: `GET /v1/orders/{id}/tracking` (`getOrderTracking`, solo lectura, polling moderado); fases públicas normalizadas; línea de tiempo con los eventos REALES de `order_status_history`; bloque `delivery` mínimo; pantalla web de seguimiento `/pedidos/[id]/seguimiento` con polling controlado (TanStack Query); enlace desde la confirmación de F20; manejo de acceso perdido, 429/503 y red caída; migrar el mock del seguimiento a la forma real.

Fuera: cambiar estados, motivos y transiciones (F22); «Mis pedidos», reordenar y recibo (F23); repartidores, GPS, ETA y mapa (F28/F30); PedidosYa (F29); WhatsApp u otras notificaciones (F31); incidencias y reclamos (F32); pagos (F24/F25); `POST /v1/orders/lookup` y `GET /v1/guest/orders/{token}` (diferidos/descartados: §2.3, P62); WebSockets, SSE, Redis, colas; migraciones (no hay).

Inventario de lo implementado en F20 que F21 reutiliza SIN modificar su comportamiento: `OrdersService.get` (autorización dueño/token, 404 uniforme), `order_access_tokens`, `ORDERS_DB_GATE`, `privateNoStoreMiddleware` (cubre `/v1/orders`), `OrderLifecycleStatus`, `useOrderDetail`, `confirmation-store` (`monsushi-order-<id>`).

## 2. Contrato (fuente: `openapi.yaml`)

### 2.1 `GET /v1/orders/{id}/tracking` · `getOrderTracking` · tag `orders`

`security: [{}, {bearer: []}]` (`@OptionalAuth()`). `{id}` = UUID del pedido. Cabecera opcional `X-Order-Token` (`^smo_[A-Za-z0-9_-]{43}$`). Autorización IDÉNTICA a `getOrder`: token válido para ESE pedido, o JWT del cliente dueño; todo lo demás (inexistente, ajeno, sin token, inválido, vencido, revocado, pedido de invitado consultado con JWT) => el MISMO 404 que `getOrder`. Formato imposible de `id`/token => 400 sin tocar la BD. `Cache-Control: private, no-store` y `Vary: Authorization, X-Order-Token` en todo (errores incluidos; el `Vary` se fija en el middleware de `/v1/orders`, no solo en el handler), sin ETag.

`OrderTracking` (todos los campos obligatorios; sin importes, líneas, contacto, dirección ni notas):

| Campo                                  | Tipo                                               | Notas                                                                                                    |
| -------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `orderId`, `displayNumber`, `branchId` | uuid, `MON-000000`, uuid                           | `branchId` público; el nombre/dirección de sucursal los resuelve la web con `usePublicBranches`          |
| `fulfillmentType`                      | `PICKUP`\|`DELIVERY`                               | decide el recorrido y la etiqueta de `completed`                                                         |
| `status`                               | `OrderLifecycleStatus`                             | `orders.status`, fuente de verdad del estado actual                                                      |
| `publicStatus`                         | `OrderPublicStatus`                                | fase pública (§3)                                                                                        |
| `terminal`                             | boolean                                            | `delivered`, `picked_up`, `rejected`, `cancelled`                                                        |
| `placedAt`, `updatedAt`, `generatedAt` | date-time UTC                                      | `generatedAt` = hora del servidor                                                                        |
| `steps`                                | `{phase, reachedAt\|null}[]` (≤ 8)                 | recorrido esperado con la hora real alcanzada; `null` = no ocurrida/sin registro                         |
| `events`                               | `{seq, status, publicStatus, occurredAt}[]` (≤ 50) | `order_status_history` tal cual, orden `changed_at, id`; con más de 50 se devuelven los 50 MÁS RECIENTES |
| `eventsTruncated`                      | boolean                                            | hay más de 50 eventos (se omiten los MÁS ANTIGUOS; el último evento siempre está)                        |
| `delivery`                             | `{provider, status\|null}` \| `null`               | `null` en PICKUP; en DELIVERY solo el proveedor; `status` siempre `null` (reservado F28/F29)             |
| `pollAfterSeconds`                     | integer 5..300 \| `null`                           | sugerencia de espera; `null` si `terminal`                                                               |

Errores: 400 (formato), 401 (JWT presente e inválido), 404 uniforme, 429 `RATE_LIMITED` con `Retry-After`, 503 `ORDERS_BUSY` (reintentable, `Retry-After`). Sin códigos nuevos.

### 2.2 Por qué una ruta separada y no ampliar `getOrder`

| Opción                                          | Costo por sondeo                                                                                                         | Veredicto  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Ampliar `getOrder` con la línea de tiempo       | 5 consultas anidadas (líneas, extras, promociones, dirección, historial) + ~3 KB de snapshot que no cambia, en CADA poll | Descartada |
| `GET /v1/orders/{id}/tracking` ligero (elegida) | 1 consulta de `orders` con 8 columnas + 1 de historial por índice `(order_id, changed_at)`; ~1 KB                        | Elegida    |
| Reutilizar `getOrder` y derivar del `status`    | Sin línea de tiempo real; imposible mostrar horas por fase                                                               | Descartada |

`getOrder` se consulta una vez (confirmación/detalle); el seguimiento sondea solo `getOrderTracking`. Sin rutas duplicadas: ninguna de las dos devuelve lo de la otra (el contrato solo se aclara en las descripciones; `OrderDetail` no cambia de forma).

**Sin `ETag`/`304`**: el middleware del dominio de pedidos quita el ETag a propósito (respuestas privadas); un `304` no ahorra consultas (hay que leer para comparar) y solo ahorraría ~1 KB; añadiría un camino de caché sobre datos privados. Si el volumen lo justificara, se reevalúa con medición (ADR-0027, alternativas).

### 2.3 `POST /v1/orders/lookup` y `GET /v1/guest/orders/{token}`

- **`GET /v1/guest/orders/{token}`: DESCARTADO.** Duplica `getOrder`/`getOrderTracking` con el token en la URL (fugas por logs, historial, `Referer`, proxies), lo que F20 prohibió expresamente. El token viaja en `X-Order-Token`. Un enlace compartible, si se pide, usará fragmento `#` (nunca llega al servidor) en una feature propia.
- **`POST /v1/orders/lookup` (número + teléfono): DIFERIDO (P62).** El número es una secuencia desde 1001 (enumerable) y el teléfono, de 8 dígitos, es de bajo espacio: como credencial permite enumerar pedidos y exfiltrar nombre, dirección y teléfono (PII). Si se implementa, NO devuelve datos: tras verificar con un código al teléfono (F31, WhatsApp/SMS; P55) emite un token de invitado nuevo; con límites estrictos y respuesta uniforme. Sin verificación de teléfono no se implementa. Mientras tanto, la web en `http` muestra «Se perdió el acceso a este pedido» y orienta a contactar a la sucursal con el número de pedido; `/consultar` no ofrece formulario con la API real.
- Mock: `/consultar` y `lookupOrder` siguen simulados (rotulados) y no se mezclan con el tracking real.

## 3. Modelo de estados y normalización pública

Catálogo CERRADO de F20 (CHECK en BD): `pending, accepted, preparing, ready, on_the_way, delivered, picked_up, rejected, cancelled`. F21 no inventa estados. «Pendiente de pago», «incidencia» y «reembolsado» NO son estados del pedido (P57, F24, F32): no existen en `OrderPublicStatus`.

| `status` (backend) | `publicStatus` | `terminal` | Etiqueta pública (la pone la web, i18n por código)                 |
| ------------------ | -------------- | ---------- | ------------------------------------------------------------------ |
| `pending`          | `received`     | no         | Pedido recibido (la sucursal aún no lo procesa)                    |
| `accepted`         | `accepted`     | no         | Aceptado por la sucursal                                           |
| `preparing`        | `preparing`    | no         | En preparación                                                     |
| `ready`            | `ready`        | no         | PICKUP: «Listo para recoger»; DELIVERY: «Listo, esperando entrega» |
| `on_the_way`       | `on_the_way`   | no         | En camino (solo DELIVERY)                                          |
| `delivered`        | `completed`    | sí         | «Entregado»                                                        |
| `picked_up`        | `completed`    | sí         | «Recogido»                                                         |
| `rejected`         | `rejected`     | sí         | Rechazado por la sucursal                                          |
| `cancelled`        | `cancelled`    | sí         | Cancelado                                                          |

El servidor entrega códigos; la web resuelve texto es/en con claves estables (`tracking.phase.<code>`, `tracking.phaseHint.<code>`). Un valor futuro desconocido en la web se presenta con una etiqueta neutra («En proceso») sin romper.

### 3.1 Recorrido esperado (`steps`) por modalidad

| Modalidad                                          | Fases en orden                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `PICKUP`                                           | received → accepted → preparing → ready → completed              |
| `DELIVERY` (`OWN`; `PEDIDOSYA` cuando exista, F29) | received → accepted → preparing → ready → on_the_way → completed |

Reglas de `steps`:

1. Cada fase lleva `reachedAt` = `changed_at` del PRIMER evento cuya fase pública es esa; `null` si ninguno. Nunca se estima ni se rellena una hora futura.
2. Estado normal en curso: todas las fases del recorrido, las futuras con `reachedAt: null` (la web las muestra como «pendientes», sin hora).
3. `rejected`/`cancelled`: el recorrido se CORTA: solo las fases ya alcanzadas (con `reachedAt`) más la fase terminal (`rejected`/`cancelled`). Sin etapas futuras alcanzables.
4. Salto en el historial (p. ej. `pending → preparing` sin `accepted`): la fase omitida queda `reachedAt: null` pero anterior a la actual; la web la pinta como superada sin hora. La API NO la corrige ni la inventa.
5. `on_the_way` en un pedido PICKUP (inconsistente): aparece en `events` tal cual; no existe en `steps` de PICKUP. La API no lo oculta ni lo reescribe.
6. La fase actual de la web es la de `publicStatus` (viene de `orders.status`, no del último evento); si ambos discrepan se muestra `status` y la línea de tiempo registrada, sin «reparar».

Transiciones válidas esperadas (para referencia de presentación; las gobierna F22, F21 NO las valida ni las ejecuta): `pending → accepted|rejected|cancelled`; `accepted → preparing|cancelled`; `preparing → ready|cancelled`; `ready → on_the_way` (DELIVERY) `| picked_up` (PICKUP) `| cancelled`; `on_the_way → delivered`. `delivered|picked_up|rejected|cancelled` son finales.

### 3.2 `pollAfterSeconds` (sugerencia del servidor)

`pending` 15 · `accepted` 20 · `preparing` 30 · `ready` 15 · `on_the_way` 15 · terminal `null`. Constantes del servidor (P63): permiten subir el intervalo bajo carga sin desplegar la web. La web la acota a [10, 120] s y, si falta, usa 30 s.

## 4. Línea de tiempo (`events`)

- Fuente única: `order_status_history WHERE order_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 51` (los 51 MÁS RECIENTES; el 51.º solo detecta `eventsTruncated`). El repositorio los invierte y se exponen los 50 más recientes en orden cronológico `changed_at, id` (el último evento NUNCA se pierde; con truncado faltan los más antiguos). `seq` numera la ventana expuesta (1..50). El orden lo fija el servidor; la web NO reordena ni deduplica.
- `steps` con truncado: se calcula con los eventos expuestos; una fase alcanzada solo en eventos omitidos queda con `reachedAt: null` (no se inventa la hora) y, si es anterior a la fase actual, la web la pinta como superada sin hora (§3.1 regla 4). En `rejected`/`cancelled` con truncado el recorrido cortado solo incluye las fases con hora expuesta (caso patológico: >50 eventos). Eventos con `new_status` fuera del catálogo (imposible por el CHECK) se OMITEN y un `orders.status` desconocido se presenta como `pending`/`received` no terminal: nunca se expone un valor crudo fuera de `OrderLifecycleStatus`.
- Se expone por evento: `seq`, `status`, `publicStatus`, `occurredAt`. NUNCA `changed_by` (id de personal), `reason` (texto libre interno ≤ 500, puede traer PII o notas operativas) ni el `id` de la fila.
- Motivo público de rechazo/cancelación: NO se expone en F21 (P64). Cuando negocio lo defina se añade de forma aditiva `publicReason` (código de catálogo cerrado o texto saneado/aprobado), nunca el `reason` crudo.
- Historial inconsistente (eventos duplicados, fuera de orden de negocio, saltos, `old_status` que no encadena): se entrega lo registrado con orden estable. Empates de `changed_at` (`now()` es el inicio de la transacción: dos filas de la misma transacción coinciden) se desempatan por `id` (determinista pero no semántico): F22 debe insertar cada transición en su propia transacción o con `clock_timestamp()` (nota para F22).
- Pedido sin historial (no debería ocurrir: F20 siempre inserta `NULL → pending`): `events: []`, `steps` derivados solo de `status` (la fase actual sin hora), la web muestra «Sin eventos registrados» sin error.
- `old_status` no se expone (se deduce del evento anterior; evita contradicciones visibles).
- Fechas: ISO-8601 UTC en la API; la web formatea siempre en `America/Guatemala` (`lib/time`).

## 5. `delivery` (solo dato real)

- PICKUP: `delivery: null`.
- DELIVERY: `{ provider: orders.delivery_provider, status: null }`. No hay tabla `deliveries` (F28/F29): nada que leer, así que `status` es `null` y la web NO muestra repartidor, ETA, mapa ni tracking externo.
- `provider = 'PEDIDOSYA'` (hoy no creable): `BLOCKED_EXTERNAL`, solo texto neutro «Entrega por proveedor externo» sin seguimiento. Un mock jamás confirma entregas reales.
- Extensión para F28/F29 sin implementarlos: `status` ya existe como cadena anulable RESERVADA (enum y semántica se definen con la fuente real y su ADR). Cualquier dato adicional (referencia de entrega, hora estimada, nombre de pila del motorista) se añade como campos OPCIONALES nuevos de `delivery` tras revisión de privacidad; NUNCA teléfono ni placa ni ubicación del repartidor.

## 6. Reglas de servidor

1. Validar `id` (UUID) y `X-Order-Token` (patrón) ANTES de la BD (400).
2. Autorizar en UNA adquisición del gate de pedidos: si hay token => `findTrackingForGuestToken(id, sha256, now)`; si no devuelve y hay `principal` => `findTrackingForOwnerAuthUser(id, authUserId)` (join `customer: { authUserId }` en la MISMA consulta; sin leer la fila del cliente; un pedido de invitado, `customer_id` NULL, nunca coincide); si nada => `orderNotFound()` (el mismo 404 de F20; mismo cuerpo, mismas cabeceras). Se extrae el helper de autorización compartido con `get()` SIN cambiar su comportamiento (las pruebas de F20 siguen verdes).
3. Consulta: `orders` (solo `id, orderNumber, branchId, fulfillmentType, deliveryProvider, status, placedAt, updatedAt`) + `statusHistory` (`newStatus, changedAt`; `orderBy [changedAt desc, id desc]`, `take 51`, invertido por el repositorio). Prisma relaciona en 2 sentencias; presupuesto (sentencias SQL): invitado ≤ 2 (pedido + historial), dueño ≤ 2, token fallido + JWT ≤ 4 (MEDIDO contra PostgreSQL real: la consulta por token que no encuentra pedido cuesta 2 sentencias, no 1; caso raro de invitado con token fallido y sesión).
4. Mapeo puro en `order-tracking.mapper.ts` (§3); sin llamadas externas; sin escritura (no inserta tokens ni auditoría: es lectura).
5. Throttle propio `ORDER_TRACKING_THROTTLE`: `default` 120/min por IP y `actor` 60/min (un invitado cae a su IP => 60/min efectivos). Contador independiente de `getOrder` (el sondeo no consume la cuota del detalle). Los intentos con token inválido cuentan.
6. Gate: se reutiliza `ORDERS_DB_GATE` (cola 8, espera 1,5 s; `ordersBusy` => 503 `ORDERS_BUSY` con `Retry-After`). No se crea un 4.º gate: el volumen (~100 pedidos/día, decenas de pedidos en curso a la vez, 3–4 consultas por poll cada 15–30 s) es del orden de 1–2 consultas/s, muy por debajo del cupo; un gate propio exigiría repartir otro cupo de `DB_POOL_MAX` (ya es requisito `>= 5`) y dejaría menos conexiones a los demás. Riesgo aceptado: una ráfaga de lecturas compite con `createOrder` por el mismo cupo; mitigación: UNA sola adquisición por poll, `pollAfterSeconds`, throttle, medición por performance-reviewer (R3) y **admisión de lecturas**: `DbGate.run(task, { rejectIfWaiting: 2 })` (solo `getTracking` y `getOrder`; `createOrder` no la usa) rechaza al instante con 503 `ORDERS_BUSY` + `Retry-After` si el cupo está lleno y ya hay 2 esperas, de modo que las plazas 3–8 de la cola quedan RESERVADAS a la escritura sin crear un 4.º gate (el comportamiento por defecto del gate no cambia).
7. Logs: `requestId`, `orderId`, código de resultado; nunca token, contacto, dirección ni notas.
8. `Vary: Authorization, X-Order-Token`; `res.vary` como `getOrder`.

## 7. Datos y SQL

**No hay migración (0019 NO hace falta).** Todo existe en 0018: `orders`, `order_status_history` (índice `order_status_history_order_idx (order_id, changed_at)` y modelo Prisma `@@index([orderId, changedAt])`), `order_access_tokens` (UNIQUE sobre `token_hash`, índice parcial por `order_id`). La consulta del historial usa el índice (`order_id =` + orden por `changed_at`; el desempate por `id` ordena un puñado de filas). Sin cambios en `schema.prisma`. `deliveries` NO se lee (no existe aún; la ficha la menciona «lectura» para F28/F29).

## 8. Privacidad y seguridad

DTO propio (nunca entidad Prisma). La respuesta no contiene: contacto, correo, teléfono (ni enmascarado), dirección de entrega, notas, importes, líneas, tokens, `changed_by`, `reason`, costos de proveedor ni coordenadas. Sucursal: solo `branchId` (la web consulta datos públicos de F07). La dirección de entrega y el teléfono enmascarado siguen SOLO en `getOrder`. Token solo en cabecera; `Referrer-Policy` ya aplicada. Un cliente autenticado no ve pedidos de invitado con su JWT (P59). El número de pedido nunca es credencial. Respuesta de 404 indistinguible entre inexistente/ajeno/vencido.

## 9. Web

### 9.1 Rutas

| Ruta                                                          | `http`                                                                                                              | `mock`                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/pedidos/[id]` (existente)                                   | Confirmación/detalle de F20 (`OrderReceivedScreen`), SIN polling. Añade el enlace «Ver estado de mi pedido»         | Seguimiento simulado actual, rotulado, sin cambios visuales                                 |
| `/pedidos/[id]/seguimiento` (NUEVA, canónica del seguimiento) | `OrderTrackingScreen`: estado, fases, línea de tiempo, polling; enlace «Ver detalle del pedido» a `/pedidos/[id]`   | Misma pantalla alimentada por el mock con forma real `OrderTracking`; rotulada «Simulación» |
| `/consultar`, `/mis-pedidos`                                  | `/consultar`: aviso honesto (sin formulario; ver §2.3). `/mis-pedidos` sigue redirigiendo a `/cuenta/pedidos` (F23) | Sin cambios                                                                                 |

Por qué dos rutas: la confirmación de F20 (con su foco, resumen y mensaje honesto) no se rediseña ni se carga de polling; el seguimiento solo sondea donde se ve. Los avisos de F31 deberán enlazar a `/pedidos/[id]/seguimiento` (sin token en la URL: el invitado conserva el token de `sessionStorage`; sin él ve «acceso perdido»). Redirecciones: ninguna ruta se retira; `/pedidos/[id]/seguimiento` no necesita redirección (es nueva). El enlace de la confirmación es un `<Link>` simple: no se toca el resto de `OrderReceived`.

### 9.2 Acceso y claves de caché

- Invitado: token de `readGuestToken(id)` (`sessionStorage` `monsushi-order-<id>`) enviado en `X-Order-Token`. SIN token y SIN sesión: NO se hace la solicitud y se muestra «Se perdió el acceso a este pedido» (+ número guardado si existe). Con sesión sin token: se consulta con JWT (404 => acceso perdido).
- 404/401/403 (acceso perdido): estado terminal de la pantalla, el polling se detiene, un único mensaje que no revela si el pedido existe. Aplica igual a token vencido, revocado, ajeno o inexistente.
- `queryKeys.orders.tracking(scope, id)` = `['orders','tracking', scope ?? 'guest', id]` (aislamiento por cuenta con `useCustomerScope`; el token NUNCA entra en la clave). `useCustomerCacheGuard` se extiende para descartar `['orders','tracking'|'placed', scope distinto]` al cambiar de cuenta. `gcTime` 60 s, sin persistencia (`PersistQueryClient` no se usa; no se escribe la respuesta en `localStorage`/`sessionStorage`). Al cambiar de pedido la clave cambia: nunca se mezclan datos; `placeholderData` NO se usa entre pedidos.

### 9.3 Polling (TanStack Query, sin WebSockets/SSE)

| Aspecto                | Regla                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intervalo              | `refetchInterval` como función: `false` si `terminal`, acceso perdido o pestaña oculta; si no `clamp(pollAfterSeconds × 1000, 10 000, 120 000)`, defecto 30 000   |
| Pestaña oculta         | `refetchIntervalInBackground: false`; al volver, `refetchOnWindowFocus`/`visibilitychange` refetch inmediato (con `staleTime` 5 s para no duplicar)               |
| Sin solapamiento       | TanStack deduplica solicitudes en vuelo; el siguiente ciclo se programa al TERMINAR la anterior; `signal` cancelable al desmontar o cambiar de pedido             |
| Error de red/5xx/503   | `retry: false` a nivel de consulta y backoff propio: espera `min(120 s, 15 s × 2^(n−1))` ±20 % de jitter; tras 8 fallos seguidos se detiene y ofrece «Reintentar» |
| 429                    | Espera `Retry-After` (acotada a [5, 120] s) y continúa; NO se interpreta como acceso perdido                                                                      |
| 404/401/403            | Detiene el polling y muestra «acceso perdido»                                                                                                                     |
| Estado terminal        | Se muestra el estado final y se detiene; no hay más solicitudes aunque se enfoque la pestaña                                                                      |
| Último estado conocido | Ante error se conserva `data` anterior (atenuada, con aviso «Sin conexión: mostrando la última información (hace X)»); NUNCA se marca el pedido como cancelado    |

Presupuesto frente al límite del servidor (60/min por IP y por actor en invitado): a 15 s => 4 solicitudes/min por pestaña; 3 pestañas => 12/min; a 30 s => 6/min con 3 pestañas. Con backoff el ritmo solo baja. Cabe un NAT compartido de ~12–15 clientes sondeando a 15 s sin 429; el 429 es recuperable (Retry-After) y no pierde datos.

### 9.4 Pantalla

Cabecera con número `MON-…`, fase pública grande (`aria-live="polite"` en el cambio de fase, foco no robado), `fulfillmentType` y sucursal (pública), lista ordenada de fases (hecha / actual / pendiente; deshabilitada/atenuada para futuras, sin hora), línea de tiempo con horas en `America/Guatemala` (es/en), bloque de entrega propia sin repartidor/ETA, aviso honesto para PedidosYa, pedido pendiente («La sucursal aún no lo procesa»), cancelado/rechazado visibles y sin etapas futuras, «Sin eventos registrados». No dice «pagado». Tema claro/oscuro, responsive (Pixel 7), botones ≥ 44 px, `prefers-reduced-motion`. Referencia visual: sección de seguimiento del prototipo público (skill `prototype-analysis`; no copiar código); no inventar ETA.

### 9.5 Mock y retiro del seguimiento simulado

- En `http` NUNCA se usa `useOrder`/`getDraftOrder`/`/v1/demo/orders/{id}/advance` ni `SimulatedOrderDetail`.
- En `mock`: se añade el handler `GET /v1/orders/{id}/tracking` que (a) comprueba el acceso como el real (token del registro de `order-placement.ts` o sesión de demostración; 404 uniforme), (b) localiza el BORRADOR enlazado por `displayNumber`, (c) produce `OrderTracking` real: `events` desde `draft.history` filtrando `kind === 'order'` (mapeando `received→pending`, `delivered→delivered|picked_up` según modalidad), `steps`, `terminal`, `pollAfterSeconds`, `delivery` con solo proveedor. Así el botón «Ver siguiente estado (simulación)» (`/v1/demo/orders/{id}/advance`, solo mock) alimenta el historial real del mock y la pantalla nueva funciona idéntica. `parity.test.ts` valida la forma contra el contrato.
- `/pedidos/[id]` en mock mantiene `SimulatedOrderDetail` (borrador) hasta F22, que retira los borradores `DraftOrder*`; F21 no los elimina para no romper el backoffice simulado.

## 10. Estados de error en la web (resumen)

| Situación                                  | Presentación                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 404/401/403, token ausente o vencido       | «Se perdió el acceso a este pedido»; sin revelar existencia; muestra el número guardado si lo hay; sin polling               |
| 429                                        | Aviso discreto «Demasiadas consultas, reintentamos en N s»; datos anteriores visibles; polling retoma                        |
| 503/5xx                                    | Aviso + backoff; datos anteriores atenuados                                                                                  |
| Sin red (`navigator.onLine=false` o fallo) | «Sin conexión»; conserva el último estado atenuado con su antigüedad; reanuda al volver la red (`online`); nunca «cancelado» |
| `pending`                                  | «Recibimos tu pedido; la sucursal aún no lo procesa»; no dice aceptado ni pagado                                             |
| Sin eventos adicionales                    | Solo «Pedido recibido» con su hora                                                                                           |
| Datos incompletos (p. ej. `steps` vacío)   | Se muestra lo disponible: estado y eventos; sin romper                                                                       |
| `rejected` / `cancelled`                   | Estado final destacado, recorrido cortado, sin motivo (P64), enlace a contactar la sucursal                                  |

## 11. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec BD real · W Vitest web · P Playwright)

La lista de 47 puntos del solicitante no está en el repositorio: esta matriz los cubre por familias y `qa-engineer` debe conciliarla uno a uno contra esa lista antes de cerrar (no se afirma equivalencia).

| #   | Caso                                                                                                                                                                                            | Nivel   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Mapeo `status → publicStatus/terminal` para los 9 estados (tabla §3); estado desconocido no revienta                                                                                            | U       |
| 2   | `steps` PICKUP, DELIVERY OWN y DELIVERY PEDIDOSYA: fases correctas, sin `on_the_way` en PICKUP; futuras con `reachedAt: null`                                                                   | U, S    |
| 3   | `rejected`/`cancelled` cortan el recorrido (sin fases futuras) desde cada fase previa                                                                                                           | U, S    |
| 4   | Salto de estados y evento duplicado: `events` tal cual, `steps` sin inventar horas; `status` manda sobre el último evento                                                                       | U, S, I |
| 5   | Orden `changed_at, id` estable con empates de `changed_at`; `seq` 1..N; >50 eventos => 50 + `eventsTruncated: true`                                                                             | U, I    |
| 6   | Sin historial => `events: []`, sin error; `pollAfterSeconds` por estado y `null` en terminal                                                                                                    | U, S    |
| 7   | Nunca aparecen `changed_by`, `reason`, `old_status`, id de fila, contacto, dirección, notas, importes ni tokens (inspección del JSON con valores sembrados)                                     | S, E, I |
| 8   | Dueño por JWT => 200; pedido de otro cliente => 404; invitado con JWT => 404 (P59)                                                                                                              | S, E, I |
| 9   | Invitado con token vigente => 200; sin token, inválido, de OTRO pedido, vencido, revocado => el MISMO 404 (cuerpo y cabeceras idénticos a `getOrder`)                                           | S, E, I |
| 10  | `id` no UUID o token con formato inválido => 400 sin consultar la BD                                                                                                                            | E       |
| 11  | `Cache-Control: private, no-store`, `Vary` y SIN `ETag`, también en 404/429/503                                                                                                                 | E       |
| 12  | Throttle propio: 429 `RATE_LIMITED` con `Retry-After`; contador independiente de `getOrder`; token inválido cuenta                                                                              | E       |
| 13  | Gate: saturación => 503 `ORDERS_BUSY` con `Retry-After`, libera cupo; UNA adquisición por poll; sin anidar                                                                                      | S, I    |
| 14  | Presupuesto de consultas: invitado ≤ 2, dueño ≤ 2, token fallido + JWT ≤ 4, sin N+1 con 50 eventos (contador)                                                                                   | S, I    |
| 15  | `delivery`: PICKUP `null`; OWN `{provider:'OWN', status:null}`; PEDIDOSYA `{provider:'PEDIDOSYA', status:null}`; sin consulta a `deliveries`                                                    | U, S, I |
| 16  | Solo lectura: no inserta tokens/auditoría ni cambia `orders`; sin llamadas externas                                                                                                             | S, I    |
| 17  | Int-spec con eventos insertados DIRECTAMENTE en la BD de prueba (sin implementar F22): `pending→accepted→preparing→ready→picked_up`, rechazo, cancelación, duplicados, desorden; se limpia todo | I       |
| 18  | Contrato: `contracts:check` verde tras implementar; cuerpo de respuesta valida contra `OrderTracking`; paridad del mock                                                                         | U, W    |
| 19  | Web: `useOrderTracking` — intervalo por `pollAfterSeconds` (fake timers), acotado a [10, 120] s, defecto 30 s                                                                                   | W       |
| 20  | Web: pausa con pestaña oculta y refetch inmediato al volver; sin solapamiento; cancelación al desmontar/cambiar de pedido                                                                       | W       |
| 21  | Web: parada en estado terminal; parada en 404/401/403; 429 respeta `Retry-After` y NO es «acceso perdido»                                                                                       | W       |
| 22  | Web: backoff exponencial con tope y jitter, parada tras 8 fallos con «Reintentar»; reanuda con `online`                                                                                         | W       |
| 23  | Web: red caída conserva el último estado atenuado con antigüedad y nunca muestra «cancelado»                                                                                                    | W       |
| 24  | Web: query keys por pedido + identidad (`guest`/cuenta); al cambiar de cuenta se descarta la caché; sin mezcla al cambiar de pedido; token fuera de la clave; sin persistencia                  | W       |
| 25  | Web: invitado sin token ni sesión => «acceso perdido» sin solicitud; con token envía `X-Order-Token` (cabecera, nunca URL)                                                                      | W       |
| 26  | Web: pantalla para cada fase y modalidad, `pending`, rechazado/cancelado, sin eventos, datos incompletos, PedidosYa (aviso sin repartidor), OWN (sin ETA/repartidor)                            | W       |
| 27  | Web: i18n es/en (todas las claves de fase/ayuda/errores), fechas en `America/Guatemala` con zona UTC distinta en el entorno de prueba                                                           | W       |
| 28  | Web: enlace «Ver estado de mi pedido» en la confirmación de F20 y vuelta al detalle; la confirmación no sondea                                                                                  | W       |
| 29  | Web `http`: no se invoca ni importa el seguimiento simulado ni `/v1/demo/orders/{id}/advance`; `mock`: rotulado «Simulación» y alimenta `OrderTracking` real                                    | W       |
| 30  | `/consultar` en `http` no muestra formulario de número+teléfono (aviso honesto); en `mock` se conserva                                                                                          | W       |
| 31  | Playwright contra la API real: pickup invitado — seguimiento inicial `received`; con un estado avanzado por SQL de prueba la pantalla se actualiza sin recargar; terminal detiene el polling    | P       |
| 32  | Playwright: a11y (axe) claro/oscuro, `aria-live`, foco, móvil Pixel 7, es/en, `prefers-reduced-motion`                                                                                          | P       |
| 33  | Playwright: otra pestaña/dispositivo sin token => «acceso perdido»                                                                                                                              | P       |

## 12. Criterios de aceptación

1. Un pedido de F20 se consulta con su token (invitado) o con su sesión (dueño) y devuelve estado, fase pública, recorrido y eventos REALES; nada más.
2. Acceso solo dueño/token; 404 uniforme; sin enumeración por número; sin `lookup` ni token en URL.
3. Estados consistentes con el catálogo cerrado; F21 no escribe ni transiciona nada.
4. Sin ETA, GPS, repartidor ni tracking externo; PedidosYa `BLOCKED_EXTERNAL` sin simulaciones presentadas como reales.
5. Polling controlado (pausa oculta, parada terminal/acceso perdido, backoff, `Retry-After`), dentro del límite del servidor con 3 pestañas.
6. La web en `http` no usa el seguimiento simulado; el mock tiene la forma real.
7. `pnpm contracts:check` y `pnpm check` verdes; int-spec contra PostgreSQL real ejecutada (sin ella el estado no pasa de `API_IMPLEMENTED`).

## 13. Riesgos

| #   | Riesgo                                                                                       | Mitigación                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | F22 inserta eventos con `changed_at` iguales (misma transacción) y el orden queda arbitrario | Nota para F22: una transacción por transición o `clock_timestamp()`; el desempate por `id` es determinista pero no semántico (P-F22)                                                      |
| R2  | Divergencia entre `orders.status` y el último evento del historial                           | `status` es la fuente del estado actual; los eventos se muestran tal cual; no se reparan; F22 debe actualizar ambos en la misma transacción                                               |
| R3  | El sondeo compite con `createOrder` por `ORDERS_DB_GATE`                                     | Una adquisición por poll, `pollAfterSeconds`, throttle propio; medir con performance-reviewer; si hace falta, gate propio con ADR (no antes)                                              |
| R4  | NAT compartido agota 60/min por IP                                                           | 429 recuperable con `Retry-After`; backoff; intervalo sugerido ajustable por servidor (P63); `TRUST_PROXY_HOPS` sigue siendo requisito de despliegue                                      |
| R5  | Pérdida del token de invitado (otra pestaña/dispositivo) sin `lookup`                        | Aceptado (P49/P62): mensaje honesto y contactar a la sucursal con el número; el `lookup` verificado depende de F31/P55                                                                    |
| R6  | Un `rejected`/`cancelled` sin motivo genera consultas al restaurante                         | P64 (`publicReason` aditivo cuando negocio apruebe); la web orienta a contactar a la sucursal                                                                                             |
| R7  | Etiquetas por modalidad (`completed`, `ready`) mal interpretadas                             | La web decide el texto con `fulfillmentType`; pruebas #26/#27                                                                                                                             |
| R8  | El mock diverge del contrato real                                                            | `parity.test.ts` + handler que construye `OrderTracking` desde el historial del borrador (§9.5)                                                                                           |
| R10 | Sondeo masivo agota el cupo/cola de `ORDERS_DB_GATE` y deja sin sitio a `createOrder`        | Admisión de lecturas (`rejectIfWaiting: 2`, §6.6): el tracking/detalle se rechaza con 503 + `Retry-After` antes de ocupar las plazas 3–8 reservadas a la escritura; ver riesgos aceptados |
| R9  | Enumeración/abuso por sondeo con tokens aleatorios                                           | Token de 256 bits, throttle por IP, 404 uniforme; sin diferencia de tiempo apreciable entre casos (misma consulta indexada)                                                               |

## 14. Reparto

- **api-engineer** (cambios ADITIVOS en `sushimon-api/src/orders/`): `order-tracking.mapper.ts` (+`.spec.ts`; funciones puras `toPublicStatus`, `isTerminalStatus`, `flowFor`, `buildSteps`, `pollAfterSeconds`, `toOrderTracking`); `order-tracking.types.ts` (`OrderTrackingRecord { id, orderNumber, customerId, branchId, fulfillmentType, deliveryProvider, status, placedAt, updatedAt, history: {newStatus, changedAt}[] }`, desacoplado de Prisma); `OrdersRepository.findTrackingForGuestToken(id, tokenHash, now)` y `findTrackingForCustomer(id, customerId)` con `TRACKING_SELECT` mínimo (+ `orders.repository.spec.ts`); `OrdersService.getTracking(principal, id, rawToken)` con helper privado de autorización compartido con `get()` (sin cambio de comportamiento) y UNA adquisición de `db()`; `dto/order-tracking.dto.ts` (Swagger alineado al contrato); `OrdersController` `@Get(':id/tracking')` con `ORDER_TRACKING_THROTTLE` (añadir en `app-throttler.guard.ts`: default 120/min, actor 60/min); `ParseUUIDPipe`; `res.vary`. SIN nuevos códigos de error, SIN cambios en `PUBLIC_5XX_CODES`, SIN módulo ni gate nuevo, SIN cambios en `schema.prisma`. Pruebas S/E (`test/orders-tracking.e2e-spec.ts`) e I (`test/orders-tracking.int-spec.ts`, eventos insertados con SQL de prueba; limpiar al terminar).
- **web-engineer**: `src/services/orders.ts` (`getOrderTracking(client, id, {guestToken, signal})`), `src/lib/data-access/paths.ts` (`orderTracking(id)`), `models.ts` (alias `OrderTracking`, `OrderTrackingEvent`, `OrderPublicStatus`), `features/query-keys.ts` (`orders.tracking`), `features/orders/hooks.ts` (`useOrderTracking` con la política §9.3; NO usa `useOrder`), `features/tracking/` nuevos: `order-tracking-screen.tsx`, `tracking-phases.tsx`, `tracking-timeline.tsx`, `use-tracking-poll.ts` (intervalo/backoff/visibilidad) y `tracking-copy` en i18n `tracking.*` es/en; ruta `src/app/(public)/pedidos/[id]/seguimiento/page.tsx`; enlace en `OrderReceived`/`OrderReceivedScreen`; ajuste de `customer-scope` (guard de caché) y `/consultar` en `http`; mock: handler `GET /v1/orders/{id}/tracking` en `mocks/handlers/order-placement.ts` (ver §9.5) + `parity.test.ts`; `docs/ui/mock-data-strategy.md`. Se RETIRA del flujo `http`: `SimulatedOrderDetail`, `useOrder`, `getDraftOrder`, `advanceOrderDemo` y la insignia (siguen solo en `mock`); `TRACKING_POLL_MS` fijo de 15 s queda solo para el borrador del mock.
- **database-engineer**: NO aplica (sin migración). Solo revisar que el plan de `EXPLAIN` use `order_status_history_order_idx` (opcional, en la int-spec) y confirmar que F22 insertará transiciones con `changed_at` distintos o en transacciones separadas.
- **security-reviewer** (solo lectura) tras la API: 404 uniforme, ausencia de PII/`reason`/`changed_by`, throttle, cabeceras. **performance-reviewer**: presupuesto de consultas y gate. **qa-engineer**: matriz §11 y conciliación con los 47 puntos. **ui-ux-reviewer**: pantalla y a11y.

## 15. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                     | Estado                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Contrato `getOrderTracking` y esquemas    | `CONTRACT_DEFINED` (`pnpm contracts:check` verde)                                         |
| API `GET /v1/orders/{id}/tracking`        | `API_IMPLEMENTED`; SQL verificado contra PostgreSQL real (ver 15.1)                       |
| Web `/pedidos/[id]/seguimiento` y polling | `INTEGRATED` como invitado contra la API real (ver 15.1); `/consultar` en http solo avisa |
| Eventos de estado reales                  | Solo `pending` hasta F22 (las pruebas insertan eventos por SQL)                           |
| `delivery.status`, GPS, ETA, repartidor   | Pendiente de F28; PedidosYa `BLOCKED_EXTERNAL` (F29)                                      |
| `lookup` número + teléfono                | Diferido (P62; requiere verificación de teléfono)                                         |
| Notificaciones de cambio de estado        | F31                                                                                       |

### 15.1 Verificación real (2026-11-18, BD de pruebas de Supabase, datos `zz-test` sembrados y borrados)

- **`test/orders-tracking.int-spec.ts`: 12/12** contra PostgreSQL real (orden `changed_at, id`, truncado a 50 con `eventsTruncated`, 404 uniforme, solo lectura, sin PII). Presupuesto de consultas MEDIDO: invitado 2, dueño 2, **token fallido + JWT 4** (una búsqueda por token sin resultado cuesta 2 sentencias, no 1; la spec decía ≤ 3 y se corrigió a ≤ 4).
- **API real (puerto propio, secreto temporal en memoria)**: 8 pedidos sembrados por SQL (pending, preparing, on_the_way OWN, delivered, picked_up, rejected, cancelled, DELIVERY PEDIDOSYA): estados públicos, pasos, `terminal`, `pollAfterSeconds` (15/30/ausente al terminar) y `delivery` correctos; sin token 404, token ajeno 404, formato inválido 400, UUID inválido 400; `Cache-Control: private, no-store`, `Vary: Authorization, X-Order-Token`; sin ninguna PII en el cuerpo.
- **Navegador real (Chromium, web en modo http contra esa API, invitado con token en `sessionStorage`)**: los 8 estados se muestran bien, móvil 390 px sin desbordamiento, el token nunca viaja en la URL, un cambio de estado hecho por SQL aparece en el siguiente sondeo (~21 s) y se anuncia una sola vez en `aria-live`; sin token ni sesión aparece «Se perdió el acceso» y NO se pide el pedido (corregido: el resumen también se pedía sin credenciales).
- **NO verificado**: cliente autenticado con JWT real (requiere sesión de Supabase), carga de sondeos concurrentes contra el gate, axe en navegador real sobre datos reales, `QUOTE_EXPIRED` real.

### 13.1 Riesgos aceptados (revisiones de seguridad y rendimiento de la API)

- **Throttles por instancia (M4)**: `@nestjs/throttler` cuenta en memoria de cada instancia (serverless/varias réplicas multiplican el límite efectivo). Aceptado: el límite es defensa en profundidad; el control real es `Retry-After`, el gate y la admisión de lecturas. Un almacenamiento compartido (Redis) queda fuera de alcance (ADR-0027).
- **Invitado por IP / CGNAT (M2)**: sin sesión el contador «por actor» cae a la IP, así que 60/min efectivos por IP; un NAT/CGNAT compartido puede recibir 429 (recuperable con `Retry-After`) y, en sentido contrario, un atacante con muchas IPs no se frena por este contador. `TRUST_PROXY_HOPS` correcto es requisito de despliegue.
- **`DB_POOL_MAX ≥ 9` para que el cupo de pedidos sea 2**: `splitGateBudget` da `orders = max(1, floor((DB_POOL_MAX − 1) / 4))`: con el requisito actual `DB_POOL_MAX = 5` el cupo de pedidos SIGUE siendo 1 (y 2 solo desde `DB_POOL_MAX = 9`). Con cupo 1 la lectura y la creación se serializan; la admisión de lecturas evita que el sondeo monopolice la cola, pero no aumenta el cupo.
- **Ráfaga sincronizada y jitter**: varias pestañas/clientes que arrancan a la vez (p. ej. tras un aviso F31 o al volver la red) sondean en fase; la web aplica jitter ±20 % en el backoff y `pollAfterSeconds` es ajustable en el servidor (P63). No hay jitter del lado del servidor.
- **Estimación de carga (ESTIMADA, no medida)**: ~100 pedidos/día con pedidos en curso simultáneos de decenas en el pico implican del orden de 60–100 sondeos/min en el pico (cada uno ≈ 2 sentencias SQL por una adquisición del gate). Con un pool de 3 conexiones por instancia y cupo de pedidos 1, el tope razonable es ~30–40 sondeadores concurrentes por instancia a 15–30 s antes de ver 503. Debe validarse con medición (performance-reviewer) antes de afirmarlo.

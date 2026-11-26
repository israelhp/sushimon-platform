# ADR-0036 Pedidos solo a domicilio e inmediatos: se retiran «Recoger en sucursal» y «Programar pedido»

**Estado**: **propuesta** (2026-11-26, dentro del PR `feature/F16-banners-simplify`). Reemplaza parcialmente ADR-0025 (D de modalidad y horarios), ADR-0026, ADR-0027, ADR-0028, ADR-0030 y ADR-0032 en lo que mencionan PICKUP o pedidos programados. Migración 0024 propuesta (solo añade una restricción) y 0025 diferida (borrador, ver D3). Cierra P42 y P84.

**Contexto**: el dueño decidió que la plataforma ofrezca SOLO pedidos a domicilio e inmediatos. Ya no se ofrecen «Programar pedido» ni «Recoger en sucursal». Estado verificado por lectura antes de decidir:

- `app.orders.fulfillment_type` (`PICKUP|DELIVERY`, CHECK `orders_fulfillment_chk`, `schema.prisma:616`) lo usan los triggers de F28 (0022: entrega propia solo para `DELIVERY`), la dirección obligatoria de `DELIVERY` (0018), los reportes y el histórico.
- `app.orders.scheduled_for` (`schema.prisma:619`) nunca se escribió: siempre `NULL`. El admin lo devolvía como `null` (`AdminOrderSummary.scheduledFor`, «P42 … `MOCK_ONLY`») y con el adaptador `http` la web ya fuerza «ahora».
- PICKUP es real hoy en la cotización (F19), la creación (F20), el seguimiento (F21), la gestión (F22: `complete` → `picked_up`), el historial y el recibo (F23) y los pagos en efectivo (F24: `collectionContext = BRANCH`). Existen pedidos PICKUP históricos y puede haber en curso.
- El DBML (`docs/references/monsushi_dbdiagram.dbml`, inmutable) admite `PICKUP` y no se edita.

## Decisión

1. **D1 Solo se crean pedidos `DELIVERY` e inmediatos.** Cotizar (`POST /v1/checkout/quote`) o crear (`POST /v1/orders`) con `fulfillment.type = PICKUP` responde **400** de validación (el enum del request pasa a `[DELIVERY]`). Los pedidos PICKUP **históricos y en curso se conservan**: siguen siendo legibles (seguimiento, historial, detalle, recibo, admin) y gestionables hasta drenarse; la acción `complete` («entregado en mostrador», `ready` → `picked_up`) y el cobro en mostrador (`collectionContext = BRANCH`) se conservan para ellos. El retiro de esos caminos (estado `picked_up`, `complete`, `BRANCH`) es una **fase posterior** y no forma parte de este cambio.
2. **D2 `orders.fulfillment_type` se conserva** con `PICKUP|DELIVERY` (D5): las filas nuevas son solo `DELIVERY`. No se renombra ni se elimina.
3. **D3 `scheduled_for` se elimina en una migración posterior (0025)**, no ahora. Desde este cambio la API deja de leerla y de exponerla (`AdminOrderSummary.scheduledFor` desaparece del contrato). La 0024 solo restringe y marca la columna como obsoleta (`COMMENT`).
4. **D4 Cambio rompiente aceptado, sin `/v2`** (las features F19–F24 siguen sin consumidores externos en producción, igual que en ADR-0030):
   - `fulfillment.type = PICKUP` en cotización y creación => 400.
   - El parámetro de consulta `fulfillmentType` de `GET /v1/admin/orders` se **elimina** (enviarlo => 400, como cualquier parámetro desconocido).
   - `scheduledFor` desaparece de `AdminOrderSummary` y de sus ejemplos.
   - `OrderCreateRequest.deliveryAddress`: como todo pedido es a domicilio, es obligatorio con `fulfillment.municipalityId` y sigue prohibido con `customerAddressId` (no hay PICKUP sin dirección). No se puede declarar como `required` del esquema porque depende de qué campo de `fulfillment` se envíe; lo valida el servidor (400).
   - Se retiran los esquemas borrador `OrderSchedule` y `FulfillmentType` y `StoreConfig.schedule`, y `Order`/`CreateOrderRequest` borrador pierden `schedule` (el borrador `Order.fulfillment` pasa a un enum inline `[pickup, delivery]` y `CreateOrderRequest.fulfillment` a `[delivery]`).
   - **Sin códigos de error nuevos.**
5. **D5 Cobertura y cierre: solo mensajes informativos.** Sin cobertura a domicilio (`DELIVERY_UNAVAILABLE`) la web informa de que por ahora no se llega a esa dirección; sucursal cerrada o fuera de horario (`BRANCH_CLOSED`) bloquea el pedido e informa la próxima apertura (`nextOpensAt` de `getBranchAvailability`). Sin WhatsApp, sin ofrecer programar ni recoger.

## Qué se conserva y qué se retira

| Elemento                                                                              | Destino                                          | Nota                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `orders.fulfillment_type` y `orders_fulfillment_chk` (`PICKUP\|DELIVERY`)             | **Se conserva**                                  | Histórico y triggers de F28/0022; filas nuevas solo `DELIVERY`. |
| `orders_delivery_only_chk` (0024)                                                     | **Nuevo**                                        | `fulfillment_type = 'DELIVERY' OR placed_at < <corte>`.         |
| Estado `picked_up` y acción `completeAdminOrder`                                      | **Se conserva** (solo PICKUP histórico/en curso) | Retiro en una fase posterior.                                   |
| `payments.collection_context = BRANCH`                                                | **Se conserva** (solo PICKUP histórico/en curso) | Retiro en una fase posterior.                                   |
| Respuestas de seguimiento, historial, detalle, recibo, reordenar y admin con `PICKUP` | **Se conserva** `[PICKUP, DELIVERY]`             | Documentado como «solo históricos».                             |
| `CheckoutFulfillmentInput.type`, `CheckoutQuote.fulfillment.type`                     | **`[DELIVERY]`**                                 | PICKUP => 400.                                                  |
| `GET /v1/admin/orders?fulfillmentType`                                                | **Se retira**                                    | 400 como parámetro desconocido.                                 |
| `AdminOrderSummary.scheduledFor`                                                      | **Se retira**                                    | Siempre fue `null` (P42).                                       |
| `orders.scheduled_for`                                                                | **Obsoleta (0024), se elimina en 0025**          | Ver D3 y «Plan de 0025».                                        |
| Esquemas borrador `OrderSchedule`, `FulfillmentType`, `StoreConfig.schedule`          | **Se retiran**                                   | Sin uso real; la web los importaba en `models.ts`.              |
| `branch_hours`, `branch_closures`, `GET /v1/branches/{id}/availability` (F08)         | **Se conserva**                                  | Sirven para `BRANCH_CLOSED` y el aviso de apertura.             |
| Entrega propia (`deliveries`, F28) y PedidosYa (`BLOCKED_EXTERNAL`)                   | **Se conserva**                                  | Sin cambios.                                                    |

## Corte temporal del CHECK

La migración 0024 fija el corte **al aplicarse**: toma `clock_timestamp()` con `app.orders` bloqueada en `SHARE ROW EXCLUSIVE` (no bloquea lecturas) y crea `CHECK (fulfillment_type = 'DELIVERY' OR placed_at < <literal>)`. `placed_at` es inmutable (trigger `orders_immutable_fields`), por lo que:

- Toda fila existente cumple la restricción (su `placed_at` es anterior al corte) y se valida completa (sin `NOT VALID`, que bloquearía cambiar el estado de los PICKUP en curso).
- Los `UPDATE` de los PICKUP históricos (estado, cancelación, `updated_at`) siguen permitidos.
- Un `INSERT` PICKUP posterior falla con SQLSTATE 23514 y `CONSTRAINT = orders_delivery_only_chk` (la API ya no los emite: el 400 sale antes).
- El valor del corte queda en `COMMENT ON CONSTRAINT` y en `pg_get_constraintdef`.

Orden de despliegue: primero la API que ya no crea PICKUP ni lee `scheduled_for`, después la 0024 (con la API anterior viva, sus `INSERT` PICKUP fallarían con 23514). La 0024 no se aplica sin aprobación humana.

## Drenaje de pedidos PICKUP en curso

No se migran ni se cancelan automáticamente. Hasta que el último PICKUP en curso llegue a un estado terminal el backoffice conserva `complete`, el cobro `BRANCH` y la lectura. Criterio para la fase posterior de retiro de esos caminos: no existir pedidos PICKUP no terminales (consulta de verificación) y haber conservado la lectura histórica. El retiro requiere su propio ADR/PR.

## Plan de 0025 `drop scheduled_for` (diferido)

- Solo después de desplegar la API que no lee ni escribe la columna ni el campo de Prisma (`scheduledFor`).
- Guarda: si existe la columna y hay filas con `scheduled_for IS NOT NULL`, la migración **aborta** con mensaje (datos históricos); si no, `ALTER TABLE app.orders DROP COLUMN scheduled_for`. Relanzable (comprueba `information_schema`). El borrador textual está al inicio de `0024_orders_delivery_only/migration.sql`.
- Revisar la guarda de columnas esperadas de la 0018 (fallaría si la 0018 se relanzara sobre una base ya migrada).
- Requiere aprobación humana y se numera tras la última migración de `develop` (CLAUDE.md, «dos computadoras»).

## Cierre de P42 y P84

- **P42 (pedidos programados)**: cerrada. No habrá programación; no hace falta contrato de paso, anticipación ni último pedido. La parte de «último pedido» de P6 sigue abierta de forma independiente (corte antes del cierre).
- **P84 (pagar antes de entregar en PICKUP)**: cerrada por no aplicable a pedidos nuevos. Para los PICKUP históricos o en curso se mantiene el comportamiento provisional (no se exige pago para `picked_up`).

## Consecuencias

- Contrato: ver la lista de operaciones y esquemas afectados en el PR; `pnpm contracts:check` queda rojo hasta que la API implemente el nuevo contrato (esperado).
- La web debe retirar de checkout el selector de modalidad y la programación, y cambiar los textos de cobertura y cierre (informativos). Los mocks que generan pedidos `pickup`/`schedule` deben ajustarse (`models.ts`, handlers de pedidos, fixtures, `StoreConfig.schedule`).
- La API: cotización y creación solo `DELIVERY` (sin ramas PICKUP), `deliveryAddress` exigido con `municipalityId`, lista admin sin filtro `fulfillmentType`, sin `scheduledFor`. Las lecturas siguen tolerando PICKUP.
- Se pierde la opción de recoger: la cobertura de `OWN` y PedidosYa pasa a ser requisito de toda compra (cuello de botella comercial conocido; mensaje informativo, sin alternativa).
- Desviación del DBML documentada en `docs/database/README.md`.

## Alternativas descartadas

- **Eliminar `fulfillment_type` y `picked_up`**: rompe triggers de F28, el histórico y los reportes, y obligaría a reescribir pedidos legales. Se conserva.
- **Reescribir los PICKUP históricos como `DELIVERY`**: falsea el registro y rompe el CHECK de coherencia de proveedor (`delivery_provider` NULL).
- **Restricción `NOT VALID` o sin corte (`CHECK fulfillment_type = 'DELIVERY'`)**: bloquearía la gestión de los PICKUP en curso o invalidaría el histórico.
- **Eliminar `scheduled_for` en la 0024**: una API desplegada antes del cambio podría seguir leyéndola; se difiere a la 0025 con guarda.
- **Ofrecer «recoger» o «programar» como alternativa cuando no hay cobertura o la sucursal está cerrada, o WhatsApp**: contradice la decisión del dueño; solo mensajes informativos.
- **`/v2` del contrato**: sin consumidores externos de F19–F24 en producción; se acepta el cambio rompiente.
- **Código de error nuevo para PICKUP** (p. ej. `FULFILLMENT_NOT_SUPPORTED`): innecesario; el enum del esquema ya produce el 400 de validación.

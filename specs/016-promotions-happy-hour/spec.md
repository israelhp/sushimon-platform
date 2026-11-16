# F15 — Promociones, cupones y Happy Hour

**Rama**: `feature/F15-promotions-happy-hour` (desde `develop`)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F07 (sucursales), F11 (productos), F13 (precio por sucursal), F03 (RBAC); F12 solo como límite (los extras no se descuentan) · **Integración posterior**: F08 (horario, solo contraste), F16 (banners), F19 (cotización: consume el evaluador), F20 (pedidos: `order_promotions`)
**Decisiones**: `docs/adr/0021-promociones-cupones-happy-hour.md` · **Pendientes de negocio**: P14, P15, P16 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `IN_PROGRESS`. Contrato `CONTRACT_DEFINED`; migración, API y web los hacen sus dueños en esta rama y se reportan por componente.

## Alcance

Gestionar las promociones de la cadena: **automáticas** (sin código; p. ej. Happy Hour) y **cupones** (con código), con vigencia en fechas, horario semanal, sucursales y productos; exponer a la tienda las
promociones vigentes y próximas de una sucursal (solo informativo) y entregar a F19 un **evaluador puro** (`PromotionEvaluator`) más un cargador de candidatas. F15 **no calcula totales de pedido, no
crea pedidos y no valida cupones en un endpoint de tienda** (lo hace F19 con este evaluador).

Fuera de alcance: banners y campañas editoriales (F16), agregados de Home/menú (F17), cotización/checkout (F19), pedidos y `order_promotions` (F20), **límites de uso por cliente y cupones de un solo uso**
(requieren política aprobada y un modelo persistente de canjes: pendiente P15), `2x1` y «precio especial» (P15), descuento de extras/modificadores (F12), texto promocional en inglés (pendiente).

## Estados por componente

| Componente                                                                                             | Estado             | Nota                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (6 operaciones nuevas, 15 esquemas) + tipos                                           | `CONTRACT_DEFINED` | `contracts:check` en verde con la API implementada (6 operaciones conformes)                                                                                                                                                                                                     |
| Migración `0016_promotions` (4 tablas) + Prisma                                                        | propuesta          | La hace el `database-engineer`; **sin aplicar**; requiere aprobación humana                                                                                                                                                                                                      |
| API `src/promotions/` (público + admin + `PromotionEvaluator` + `PromotionCandidatesService`)          | `API_IMPLEMENTED`  | Implementada y probada con repositorio en memoria (unit + e2e); SQL real verificado el 2026-11-16 con `test/promotions.int-spec.ts` (11/11) contra la BD de pruebas con la 0016 aplicada por el propietario; `migration-0016.int-spec` se omite contra Supabase y corre en el CI |
| Web: tienda (Happy Hour, promociones, precios indicativos) y backoffice (listado, formulario, activar) | `MOCK_ONLY`        | Sigue con `/v1/promotions` y `/v1/backoffice/promotions` simulados hasta integrar                                                                                                                                                                                                |
| Cupón en el carrito, total con descuento                                                               | pendiente          | F19/F20                                                                                                                                                                                                                                                                          |
| Límites de uso, cupón de un solo uso, 2x1, precio especial                                             | pendiente (P15)    | No se implementan                                                                                                                                                                                                                                                                |
| Política de combinación (apilamiento)                                                                  | pendiente (P14)    | F15 implementa la estrategia CONSERVADORA de abajo; negocio puede cambiarla                                                                                                                                                                                                      |

## Hechos verificados del repo

- **No existe ninguna tabla de promociones en las migraciones 0001–0015** (`grep -i promotion` en `sushimon-api/prisma/migrations` solo encuentra los permisos de `0002`/`0005`; tampoco hay modelos en `schema.prisma`). La 0016 **crea** las 4 tablas
  (no las altera). `order_promotions` depende de `orders` y queda para F20.
- DBML (`docs/references/monsushi_dbdiagram.dbml:208-247`): `promotions(id, code unique, name, kind text, value numeric(12,2), starts_at, ends_at timestamptz, dine_in_only default false, active default true)`; `promotion_branches(promotion_id, branch_id)`,
  `promotion_products(promotion_id, product_id)`, `promotion_weekdays(promotion_id, weekday smallint, starts_at time, ends_at time)` con PK `(promotion_id, weekday, starts_at)`; FK de las tres hijas a `promotions` con `ON DELETE CASCADE` (líneas 475-479). `code` es nullable y
  `UNIQUE`: **el DBML ya permite distinguir automática (`code IS NULL`) de cupón (`code NOT NULL`) sin columna nueva**; PostgreSQL admite varias filas con `NULL` en una restricción `UNIQUE`.
- Permisos sembrados: `promotions.read|create|update` (`0005_staff_rbac/migration.sql:99-101`). Solo `admin` los recibe (el permiso grueso `promotions` de `0002` era solo de `admin`; `manager` y `kitchen` no lo tenían; `0005` no añade promociones a `manager`).
  **No se crean permisos ni RBAC paralelo.** La web ya lo mapea: `promociones: 'promotions.read'` (`sushimon-web/src/lib/permissions.ts:37`).
- Alcance por sucursal: `AuthorizationService.scopeFor/canAccess` (`sushimon-api/src/auth/authorization.service.ts:43-49`); patrón F13: fuera de alcance = 404.
- Precio de sucursal: `BranchOffersService.resolve(branchId, productIds)` devuelve `price` (override o base), `basePrice`, `available` (`sushimon-api/src/branch-products/branch-offers.service.ts`). **Base de precio de F15 = `price`, nunca `basePrice`.**
- Convención de tiempo (F08, ADR-0011, spec 007 D1/D4): día ISO 1–7 (lunes = 1), intervalos `[inicio, fin)`, `24:00` admitido solo como fin, medianoche = estrategia B (dividir), zona única `America/Guatemala` (`BUSINESS_TIMEZONE`),
  helpers `toLocal`, `isoWeekdayOf`, `parseClock`, `parseInstant` en `sushimon-api/src/branch-schedule/business-time.ts`, `Clock` inyectable. `branch_hours` usa `TIME(0)` y `EXCLUDE gist` con `btree_gist` (`0006_branch_hours_closures`).
- Patrones de la API: errores con `code` (`codedException`), 5xx públicos en lista blanca (`PUBLIC_5XX_CODES`, `sushimon-api/src/common/filters/http-exception.filter.ts:29`), `Cache-Control` solo en éxito con interceptor
  (`common/http/cache-control.ts`; `availabilityCacheControl` acota `max-age` por el próximo cambio, `branch-schedule/availability-cache.interceptor.ts`), concurrencia optimista `expectedVersion` + 409 `*_VERSION_CONFLICT` (F08/F09), RLS sin políticas + `REVOKE`
  (0011–0015).
- Modos de pedido existentes: `FulfillmentType` = `pickup | delivery` (borrador del contrato) y `orders.fulfillment_type text` (DBML:257). **No existe un modo «consumo en el local».**
- Simulado hoy (web): `GET /v1/promotions` y `GET|POST|PATCH /v1/backoffice/promotions[/:id]` (`sushimon-web/src/lib/data-access/paths.ts:30,62-63`, `src/mocks/handlers/{public,backoffice-admin,index}.ts`). El mock admite `2x1`, `percent` y `fixed_price` (precio especial), un único
  tramo horario para todos los días y fechas sin hora; el Happy Hour de la tienda es una promoción `id='happy-hour'` con ítems de texto libre (`priceLabel`) y `dineInOnly=true`.

## Decisiones

- **D1 Modelo**: se reutilizan las 4 tablas del DBML y se **crean** en la migración `0016_promotions` (siguiente a la 0015; verificar la última de `develop` antes de numerar). Ampliaciones mínimas, todas no destructivas (sección «Modelo de datos»): `description`,
  `version`, `created_at`, `updated_at`; CHECKs; índices; RLS. El DBML no se edita. Sin triggers (los invariantes entre filas los hace cumplir la API y las restricciones declarativas bastan).
- **D2 Automática vs cupón**: `code IS NULL` = automática; `code IS NOT NULL` = cupón. Sin columna nueva. `code` normalizado (recortado, mayúsculas) por la API **y** por `CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')`; el `UNIQUE` existente resulta así insensible a mayúsculas.
- **D3 `kind` y `value`**: `kind IN ('PERCENT','FIXED_AMOUNT')` (CHECK; sustituye al `text` libre, brecha A1 de `docs/database/schema-gap-analysis.md`). `PERCENT`: `0 < value <= 100`. `FIXED_AMOUNT`: monto en GTQ **por unidad** de la línea elegible, `0 < value <= 999999.99`.
  `2x1` y «precio especial» del prototipo NO se soportan (P15): exigen reglas de cantidad/precio fijo que negocio no ha aprobado. Un `PERCENT` de 100 % se permite (producto gratis) pero el contrato exige que sea un acto explícito del administrador (sin valor por defecto).
- **D4 `dine_in_only`**: significa «promoción de consumo en el local». Como solo existen los modos `pickup` y `delivery`, **una promoción `dine_in_only=true` nunca aplica a pedidos en línea** (el evaluador la rechaza con `DINE_IN_ONLY` salvo que se evalúe con `mode='dine_in'`, que ningún
  endpoint de F15–F20 acepta hoy). La tienda la muestra con la leyenda «solo en el restaurante» y sin botón de compra. Si negocio aprueba un modo «en el local» con pedido, será otra feature.
- **D5 Alcance de sucursales y productos, explícito**: ausencia de filas en `promotion_branches` = **todas las sucursales** (incluidas las futuras); ausencia en `promotion_products` = **todos los productos**. Para que un descuento global no nazca por un descuido, el contrato exige
  `branchScope` y `productScope` (`ALL | SELECTED`) y rechaza `SELECTED` con lista vacía (`422 PROMOTION_SCOPE_INVALID`). Ausencia de filas en `promotion_weekdays` = sin restricción semanal (rige todo el día dentro de la vigencia; es seguro porque la vigencia la acota).
- **D6 Vigencia ≠ horario de apertura**: «vigente» combina solo `active`, `[starts_at, ends_at)` y el horario semanal de la promoción. NO consulta F08: una promoción puede estar vigente con la sucursal cerrada; F19 valida ambas cosas por separado.
- **D7 Concurrencia**: `PATCH` exige `expectedVersion` (`version` integer, 409 `PROMOTION_VERSION_CONFLICT`), como F08/F09, porque varias personas pueden editar los tramos y el alcance; `PATCH .../status` es idempotente sin versión (el último valor gana). Un cambio real sube `version` en 1.
- **D8 Sin borrado físico**: solo `active=false` (F20 referenciará `promotions.id` desde `order_promotions`). No hay `DELETE`.
- **D9 Precio y aritmética**: todos los importes son cadenas decimales de 2 posiciones (`"85.00"`); cálculo en **centavos enteros** (`bigint`/`number` entero seguro, nunca `float`); el porcentaje se trata como basis points enteros (`value*100`).
- **D10 Alcance de autorización** (permisos existentes; sin permiso nuevo): lectura `promotions.read`, alta `promotions.create`, edición y estado `promotions.update`, todos con `aal2` y respuestas `no-store`.
  - **Lectura**: global = todas; acotado = las promociones que aplican a alguna de sus sucursales (incluidas las `ALL`), con `branches` recortado a su alcance y `editable=false` si no cubre todas. Una que no toca su alcance = 404 `PROMOTION_NOT_FOUND`.
  - **Escritura**: la promoción es de la cadena, no de una sucursal. `branchScope=ALL` => exige alcance **GLOBAL**; `SELECTED` => el actor debe cubrir **todas** las sucursales de la promoción (en un `PATCH`: las actuales **y** las nuevas). Sucursal nueva inexistente o fuera de alcance => 404
    `BRANCH_NOT_FOUND`; promoción que toca el alcance pero no se cubre entera => 403 `PROMOTION_SCOPE_FORBIDDEN` (distinto de 404 porque el actor ya la ve; evita editar promociones ajenas por la puerta de una sucursal compartida).
  - **Por defecto solo `admin`** tiene `promotions.*`. Si negocio quiere que el encargado gestione promociones de su sucursal basta con otorgarle estos permisos acotados (sin migración); la decisión de otorgarlos por defecto es P16 y **no** se toma aquí.
- **D11 Auditoría** (misma transacción, sin PII; `audit_events`): `promotion.created` (id, name, kind, value, active, branchScope, productScope, conteos), `promotion.updated` (old/new solo de lo cambiado; listas como ids/conteos), `promotion.status_changed` (`oldActive`/`newActive`, `reason`). Sin cambio no se audita.
  El código del cupón se registra en `promotion.created|updated` (dato de negocio, no personal; la tabla es solo para personal con `audit.read`); jamás se escribe en logs de aplicación ni en la respuesta pública.
- **D12 Errores** (forma = 400, regla de negocio = 422, como F11–F14): 400 forma (tipo, patrón, `kind` desconocido, `value` no decimal, instante sin zona, `branchIds` con `ALL`, campos desconocidos, `expectedVersion` ausente); 422 `PROMOTION_VALUE_INVALID` (p. ej. `PERCENT` > 100, `"0.00"`),
  `PROMOTION_PERIOD_INVALID` (`endsAt <= startsAt`), `PROMOTION_SCHEDULE_INVALID` (violations por tramo: `SLOT_ENDS_BEFORE_START`, `SLOT_OVERLAP`, `SLOT_LIMIT`), `PROMOTION_SCOPE_INVALID` (violations por `productIds[i]`: `PRODUCT_UNKNOWN`; `SELECTED` vacío); 409 `PROMOTION_CODE_TAKEN`,
  `PROMOTION_VERSION_CONFLICT`; 404 `PROMOTION_NOT_FOUND`, `BRANCH_NOT_FOUND`; 403 `PROMOTION_SCOPE_FORBIDDEN`; 503 `PROMOTIONS_BUSY` (timeout/bloqueo; añadir a `PUBLIC_5XX_CODES`); 429 `RATE_LIMITED`.
- **D13 Módulos**: `src/promotions/` (`PromotionsModule`): `PublicPromotionsController`, `AdminPromotionsController`, `AdminPromotionsService`, `PromotionsRepository` (SQL propio, sin N+1), `promotion-policy.ts` (validación pura), `promotion-schedule.ts` (vigencia/horario/`nextChangeAt` puros),
  `promotion-evaluator.ts` (puro), `PromotionCandidatesService` (lectura para F19), filtro de errores BD. Importa `BranchProductsModule` (precio de sucursal e indicativos), `CategoriesModule` (visibilidad) y `AuthModule`; **exporta** `PromotionEvaluator` y `PromotionCandidatesService`.
  No modifica `ProductsModule`, `ModifiersModule` ni `BranchProductsModule`.

## Semántica temporal (D14)

- Zona única `America/Guatemala` (UTC−6, sin horario de verano; los helpers de F08 resuelven la zona con `Intl`, no con desplazamientos fijos). Cualquier cálculo de día y hora usa la **hora local del instante**, nunca la UTC ni `Date.getDay()`.
- `starts_at`/`ends_at` de la promoción son **instantes** `[starts_at, ends_at)` (fin exclusivo). La API acepta y devuelve ISO 8601 **con zona** (`Z` u offset); sin zona => 400 (igual que los cierres de F08). La UI convierte fecha+hora local a instante.
- Un tramo semanal `{weekday, startsAt, endsAt}` es `[startsAt, endsAt)` en hora local del día ISO `weekday`; `endsAt='24:00'` cubre hasta la medianoche exclusive. La promoción está **en horario** en el instante `t` si no hay tramos o si existe un tramo con `weekday = isoWeekday(local(t))` y `startsAt <= hora(local(t)) < endsAt`.
- **Vigente** (`live`) en `t`: `active` Y `starts_at <= t < ends_at` Y en horario. **Próxima** (`upcoming`): activa, no vigente, y su próximo inicio de vigencia ocurre antes de `t + 14 días` (horizonte como F08 D10; iteración acotada).
- **Franja que cruza la medianoche — estrategia B de F08 (dividir)**: no se acepta `endsAt <= startsAt` en un tramo. «Viernes 22:00 a sábado 02:00» se guarda como viernes `22:00–24:00` + sábado `00:00–02:00`. **Cuenta el día calendario local del instante evaluado**: a las 00:30 del sábado rige el tramo del
  sábado, aunque la franja «empezó» el viernes. Consecuencias: (a) cada mitad se evalúa por separado y es correcta; (b) para `nextStartsAt`/`nextEndsAt`/`nextChangeAt` los tramos contiguos (`24:00` de un día + `00:00` del siguiente) se **fusionan**, de modo que no se reporta un falso fin/inicio a medianoche;
  (c) la vigencia (`starts_at`/`ends_at`) corta la franja en su instante exacto, aunque caiga a mitad de un tramo; (d) la UI puede ofrecer «cruza la medianoche» y partirlo al guardar. Una franja que cubre el domingo→lunes sigue la misma regla (7 → 1).
- `nextChangeAt` (respuesta pública) = el menor instante futuro, dentro de 14 días, en que cambia el conjunto de promociones vigentes de la sucursal: inicio o fin de vigencia, o inicio/fin de tramo (con la fusión de contiguos); `null` si no hay.

### Casos de prueba temporales (obligatorios; reloj inyectado, zona `America/Guatemala`)

| #   | Escenario                                                                                                   | Esperado                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T1  | Tramo lun `15:00–18:00`, instante lun 15:00:00                                                              | live (inicio inclusivo)                                                                                                |
| T2  | Mismo tramo, lun 17:59:59 / lun 18:00:00                                                                    | live / NO live (fin exclusivo)                                                                                         |
| T3  | `ends_at` = 2026-12-31T06:00:00Z (= 31 dic 00:00 local), instante 30 dic 23:59:59 local / 31 dic 00:00:00   | live / expirada (`EXPIRED`)                                                                                            |
| T4  | `starts_at` futuro por 1 s                                                                                  | no live; `NOT_STARTED`; en `upcoming`                                                                                  |
| T5  | Instante `2026-11-16T03:00:00Z` (domingo 21:00 local; en UTC ya es lunes)                                   | día ISO 7, NO 1: un tramo del lunes no rige                                                                            |
| T6  | `2026-11-16T06:00:00Z` = lunes 00:00:00 local                                                               | día ISO 1                                                                                                              |
| T7  | Vie `22:00–24:00` + sáb `00:00–02:00`: vie 23:59:59, sáb 00:00:00, sáb 01:59:59, sáb 02:00:00               | live, live, live, NO live                                                                                              |
| T8  | Caso T7 con `nextEndsAt` en vie 23:00                                                                       | `nextEndsAt` = sáb 02:00 (tramos fusionados), NO vie 24:00                                                             |
| T9  | Tramo dom `22:00–24:00` + lun `00:00–01:00`, instante dom 23:59:59 y lun 00:00:00                           | live en ambos                                                                                                          |
| T10 | Vigencia termina sáb 00:30 con T7                                                                           | sáb 00:29:59 live; sáb 00:30:00 NO live (la vigencia corta el tramo)                                                   |
| T11 | Tramo con `endsAt <= startsAt` (`18:00–15:00`, `10:00–10:00`)                                               | 422 `PROMOTION_SCHEDULE_INVALID` (`SLOT_ENDS_BEFORE_START`)                                                            |
| T12 | Dos tramos solapados el mismo día (`15:00–18:00` y `17:00–19:00`); contiguos (`15:00–18:00`, `18:00–19:00`) | 422 `SLOT_OVERLAP`; los contiguos son válidos                                                                          |
| T13 | Sin tramos, dentro de la vigencia                                                                           | live todo el día                                                                                                       |
| T14 | Sucursal cerrada por horario/cierre (F08) con promoción vigente                                             | la promoción sigue `live` (D6); no se consulta F08                                                                     |
| T15 | `active=false` con vigencia y horario correctos                                                             | nunca live; `INACTIVE`                                                                                                 |
| T16 | `weekday` 0 y 8; `startsAt='24:00'`; `'7:5'`                                                                | 400 (forma)                                                                                                            |
| T17 | `nextChangeAt` con dos promociones; `max-age`                                                               | el menor de los cambios; `s-maxage = N = clamp(segundos hasta él, 1, 30)`, `max-age = min(N, 5)`; pasado => `no-store` |

## Combinación y descuentos (D15) — estrategia CONSERVADORA, política pendiente (P14)

Negocio no ha aprobado ninguna regla de apilamiento. F15 implementa lo más prudente y lo deja explícito; cambiarlo es una decisión comercial (P14) que tocaría solo `promotion-evaluator.ts` y este apartado.

1. **Elegibilidad por línea**. Una promoción es candidata para una línea si: `active`; vigencia `[starts_at, ends_at)`; en horario; la sucursal está en su alcance; `dine_in_only` compatible con el modo (D4); el producto está en su alcance; y si tiene código, el código enviado (normalizado) coincide. Una promoción con código **jamás** es
   candidata sin el código (no se aplica «por si acaso»).
2. **Una sola promoción por línea de producto**: la de **mayor ahorro** para el cliente en esa línea. **Nunca** se apilan porcentaje + monto, ni cupón + automática, ni dos automáticas.
3. **Desempate determinista** (mismo ahorro en centavos): (a) la promoción con código (el cliente la solicitó), (b) la que vence antes (`ends_at` menor), (c) `id` menor (orden lexicográfico). El resultado no depende del orden de entrada.
4. **Líneas distintas pueden recibir promociones distintas** (p. ej. un cupón en un producto y el Happy Hour en otro): no es apilamiento, es una promoción por línea. Alternativa más estricta (una promoción por pedido) queda como opción de P14.
5. **Tope**: el descuento de una línea nunca supera el precio base de la línea (`unitPrice × cantidad`); no hay importes negativos. Un descuento que resulta `0.00` (p. ej. precio muy bajo) no cuenta como aplicado (`NO_SAVING`).
6. **Base de precio**: el precio vigente de la sucursal de F13 (`price` de `BranchOffersService.resolve`), nunca `basePrice`. **No se descuentan modificadores/extras (F12)**: el evaluador solo recibe el precio unitario del producto; sumar extras sin descuento es cosa de F19.
7. **Aritmética** (D9): `lineBase = unitPriceCents × quantity`. `PERCENT`: `discount = round_half_up(lineBase × valueBp / 10000)` (basis points enteros; redondeo medio hacia arriba sobre el total de la línea, no por unidad, para evitar deriva).
   `FIXED_AMOUNT`: `discount = min(valueCents × quantity, lineBase)`. En ambos `discount = min(discount, lineBase)`. `finalPrice = lineBase − discount`.
8. **Ejemplos**: `PERCENT 15.00` sobre `Q85.00 × 2` = `lineBase 17000`, `17000×1500/10000 = 2550` → descuento `25.50`, final `144.50`. `PERCENT 33.33` sobre `Q10.01 × 1`: `1001×3333/10000 = 333.63` → `334` → `3.34`, final `6.67`. `FIXED_AMOUNT 20.00` sobre `Q15.00 × 3`: `min(6000, 4500)` → `45.00`, final `0.00`.

### Firma del `PromotionEvaluator` (dominio, sin I/O; F19 lo reutiliza)

```ts
type OrderMode = 'pickup' | 'delivery' | 'dine_in';
interface EvaluatorLineInput { productId: string; unitPrice: string /* "85.00": precio de sucursal F13 */; quantity: number /* entero 1..99 */ }
interface EvaluatorPromotion {            // candidata ya leída por PromotionCandidatesService
  id: string; code: string | null; kind: 'PERCENT' | 'FIXED_AMOUNT'; value: string;
  startsAt: Date; endsAt: Date; dineInOnly: boolean; active: boolean;
  branchIds: readonly string[] | 'ALL'; productIds: readonly string[] | 'ALL';
  schedule: readonly { weekday: number; startsAt: string; endsAt: string }[];
}
interface EvaluatorInput {
  at: Date; branchId: string; mode: OrderMode;
  lines: readonly EvaluatorLineInput[];   // máx. 100
  couponCode?: string | null;
  promotions: readonly EvaluatorPromotion[];
}
type RejectionReason = 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'OUTSIDE_SCHEDULE' | 'BRANCH_NOT_ELIGIBLE'
  | 'DINE_IN_ONLY' | 'CODE_REQUIRED' | 'NO_ELIGIBLE_LINES' | 'NO_SAVING' | 'NOT_BEST_OFFER';
interface EvaluatedLine {
  index: number; productId: string; quantity: number; unitPrice: string; lineBase: string;
  applicable: boolean; promotionId: string | null;
  discountAmount: string /* "0.00" si no aplica */; finalPrice: string /* total de la línea tras descuento */;
  reason: 'APPLIED' | 'NO_CANDIDATE' | 'NO_SAVING';
}
interface EvaluatorResult {
  at: string; lines: EvaluatedLine[];
  rejected: { promotionId: string; reason: RejectionReason }[];   // una entrada por promoción candidata que no aplicó a ninguna línea (o NOT_BEST_OFFER)
  coupon: null | { status: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN'; reason?: RejectionReason };
  discountTotal: string;    // suma de los descuentos de las líneas; NO es el total del pedido
}
evaluate(input: EvaluatorInput): EvaluatorResult   // puro, determinista, sin reloj ni BD
```

Reglas del evaluador: valida todo otra vez (no confía en el cargador); entradas inválidas (precio fuera de patrón, cantidad no entera o fuera de 1..99, más de 100 líneas, `at` inválida) lanzan `PromotionEvaluationInputError` (error de programación, no se enmascara). `coupon.status='UNKNOWN'` cubre código inexistente
**y** código de promoción inactiva/vencida: F19 debe mostrar **un único mensaje genérico** («cupón no válido») para evitar la enumeración de códigos; el motivo detallado es interno. El evaluador exporta también `computeLineDiscount(kind, value, unitPrice, quantity)` (puro), que F15 usa para los precios indicativos
de la tienda.

`PromotionCandidatesService.load(branchId, at, couponCode?)` (lectura): devuelve las promociones `active` de esa sucursal (propias y `ALL`) con `starts_at <= at < ends_at`, automáticas y la del cupón enviado (comparación normalizada), con sus tramos y productos, en ≤ 3 consultas; tope 200. F19 lo llama y pasa el resultado al evaluador.

## Contrato (resumen)

Tag `promotions`. Operaciones: `listStorePromotions` (GET `/v1/store/promotions`) · `listAdminPromotions` (GET `/v1/admin/promotions`) · `createAdminPromotion` (POST) · `getAdminPromotion` (GET `/v1/admin/promotions/{id}`) · `updateAdminPromotion` (PATCH) · `updateAdminPromotionStatus` (PATCH `.../status`).
Esquemas nuevos: `PromotionKind`, `PromotionScope`, `PromotionDecimal`, `PromotionScheduleSlot`, `StorePromotionItem`, `StorePromotion`, `StorePromotionList`, `AdminPromotionBranchRef`, `AdminPromotionProductRef`, `AdminPromotionSummary`, `AdminPromotion`, `AdminPromotionPage`,
`CreatePromotionRequest`, `UpdatePromotionRequest`, `UpdatePromotionStatusRequest`; parámetro `PromotionId`; `ErrorResponse.code` ampliado. Los esquemas borrador `Promotion`, `PromotionInput` y `HappyHourItem` fueron **retirados** del OpenAPI (ni la API ni la web los referenciaban desde `schema.d.ts`; comprobado con `grep`). No hay cambios incompatibles para código en uso.
**No se añade endpoint de validación de cupón**: el cupón se valida al cotizar (F19) con el evaluador, junto con el carrito y el modo; un endpoint suelto sería enumerable (fuerza bruta de códigos) y devolvería un resultado sin contexto de carrito.

### Público (`GET /v1/store/promotions`)

- Datos públicos únicamente. Una promoción con código sale con `requiresCode=true` **sin** `kind`, `value`, `productIds` ni `items`: no se revela el descuento de un cupón ni se confirma un código (no hay forma de enviar uno). Nunca se devuelve `code`.
- `isHappyHour` (derivado) = promoción **automática** con `schedule` no vacío. No hay columna ni bandera de «Happy Hour»; si negocio quiere varias promociones recurrentes que NO sean Happy Hour, hará falta una columna (pendiente).
- `items` (≤ 50, solo automáticas con productos seleccionados): `regularPrice` y `promoPrice` del producto **a cantidad 1** con el precio de sucursal de F13 y esa promoción por sí sola (`computeLineDiscount`), solo productos públicamente visibles (F10/F11) y disponibles en la sucursal. Es **indicativo**: otra promoción mejor o la
  composición del carrito pueden cambiar el precio final, que solo fija F19. La web no calcula descuentos por su cuenta.
- **Caché** (D16): `Cache-Control: public, max-age=min(N,5), s-maxage=N` con `N = clamp(floor(segundos hasta nextChangeAt), 1, 30)` (el navegador cachea como máximo 5 s; la caché compartida hasta N) y `no-store` si `nextChangeAt` ya pasó (mismo patrón que `availabilityCacheControl`; sin `stale-while-revalidate` ni `ETag`; sin Redis). `nextChangeAt` se calcula con el reloj del servidor. Con `nextChangeAt=null`, `N=30`. `Vary` solo `Accept-Encoding`:
  la respuesta no depende de cookies, `Authorization` ni idioma. Una edición del backoffice puede tardar hasta 30 s en verse; el servidor (F19) siempre revalida al cotizar. Los errores llevan `no-store`. Límite de tasa 60/min por IP.
- Query keys de la web a invalidar tras mutaciones del backoffice: `queryKeys.catalog.promotions` (hoy `['catalog','promotions']`; pasa a incluir `branchId` y `state`: `['catalog','promotions', branchId, state]`) y `queryKeys.backoffice.promotions` (listados y detalle). `invalidateQueries` por prefijo al crear, editar o cambiar estado; `staleTime` ≤ 30 s en la tienda;
  `refetchOnWindowFocus`; programar un refetch en `nextChangeAt` (setTimeout acotado) para refrescar el Happy Hour al cambiar de fase.

## Modelo de datos (propuesta para `database-engineer`, migración `0016_promotions`)

Incremental y no destructiva (solo `CREATE`), relanzable (`IF NOT EXISTS` / guardas), numerada tras la última migración de `develop`. Requiere 0003 (branches), 0006 (`btree_gist`) y 0012 (products). RLS sin políticas + `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` (guardado por existencia de rol), como 0011–0015.
`updated_at` lo mantiene la API (sin trigger, como 0007/0011–0015).

```
app.promotions (
  id uuid pk default gen_random_uuid(),
  code text null UNIQUE,                         -- NULL = automática; cupón = NOT NULL
  name text not null,
  description text null,
  kind text not null,
  value numeric(12,2) not null,
  starts_at timestamptz(6) not null, ends_at timestamptz(6) not null,
  dine_in_only boolean not null default false,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  CHECK name_len        : char_length(btrim(name)) BETWEEN 1 AND 120
  CHECK description_len : description IS NULL OR char_length(description) <= 500
  CHECK code_format     : code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'      -- mayúsculas => UNIQUE insensible a mayúsculas
  CHECK kind            : kind IN ('PERCENT','FIXED_AMOUNT')
  CHECK value_range     : (kind='PERCENT' AND value > 0 AND value <= 100) OR (kind='FIXED_AMOUNT' AND value > 0 AND value <= 999999.99)
  CHECK period          : ends_at > starts_at
  CHECK version         : version >= 1 )
INDEX promotions_active_window_idx ON (ends_at, starts_at) WHERE active      -- vigentes/próximas por fecha (lectura pública y F19)

app.promotion_branches (promotion_id uuid not null REFERENCES promotions ON DELETE CASCADE, branch_id uuid not null REFERENCES branches ON DELETE RESTRICT ON UPDATE CASCADE, PK (promotion_id, branch_id))
INDEX promotion_branches_branch_idx ON (branch_id, promotion_id)                -- «promociones de una sucursal»

app.promotion_products (promotion_id uuid not null REFERENCES promotions ON DELETE CASCADE, product_id uuid not null REFERENCES products ON DELETE RESTRICT ON UPDATE CASCADE, PK (promotion_id, product_id))
INDEX promotion_products_product_idx ON (product_id, promotion_id)              -- «promociones de un producto»

app.promotion_weekdays (promotion_id uuid not null REFERENCES promotions ON DELETE CASCADE, weekday smallint not null, starts_at time(0) not null, ends_at time(0) not null,
  PK (promotion_id, weekday, starts_at),
  CHECK weekday_iso  : weekday BETWEEN 1 AND 7                                   -- convención F08
  CHECK slot_order   : starts_at < ends_at                                       -- cubre «ends_at != starts_at» y prohíbe cruzar medianoche (24:00 admitido como fin)
  CHECK minute_grain : EXTRACT(SECOND FROM starts_at)=0 AND EXTRACT(SECOND FROM ends_at)=0
  EXCLUDE USING gist (promotion_id WITH =, weekday WITH =, tsrange(DATE '2000-01-01' + starts_at, DATE '2000-01-01' + ends_at, '[)') WITH &&) )   -- sin solapes (contiguos permitidos), como branch_hours
```

Justificación de cada desviación del DBML (el DBML no se edita): (1) **crear** las tablas, que no existían; (2) `kind` con CHECK (brecha A1); (3) `description` (el prototipo la muestra; opcional, solo español: el texto en inglés queda pendiente); (4) `version` (concurrencia optimista de D7) y `created_at`/`updated_at` (auditoría operativa, como F11–F14);
(5) formato de `code` (normalización e insensibilidad a mayúsculas sin índice funcional); (6) FKs con acción explícita: `RESTRICT` a sucursales y productos (no se borran físicamente), `CASCADE` desde `promotions` en las hijas (DBML; solo alcanzable por SQL manual porque la API nunca borra); (7) tipo `time(0)` y `EXCLUDE` como F08;
(8) índices por acceso real, sin más: la PK ya sirve «hijas de una promoción» y los FK; `(ends_at, starts_at) WHERE active` sirve «vigentes/próximas»; **con decenas de filas el planificador puede preferir un scan** (se conserva por claridad del acceso y bajo coste; reevaluar). Sin índice para `name`/`code ILIKE` (listado admin sobre decenas de filas).
Sin triggers. `order_promotions` **no** se crea (F20 con `orders`). La migración debe fallar de forma clara si alguna tabla ya existe con otra definición (guarda), nunca reescribir datos.
Reversión manual: `DROP TABLE` de las 4 tablas en orden hijas→`promotions` (solo sin datos que conservar y sin `order_promotions` apuntando a ellas).

## Autorización y seguridad

Matriz (todas `@RequireStaff()`, `aal2`, `no-store`): ver D10. Casos de IDOR a probar: ID de promoción ajena (404), `branchId` de otra sucursal en el filtro (404), `branchIds` con una sucursal fuera de alcance (404), `branchScope=ALL` con alcance acotado (403), edición de una promoción compartida con una sucursal ajena (403),
`promotions.read` sin `promotions.update` no escribe, sin `aal2` (403). Público: nunca `code`, nunca descuentos de cupones, solo sucursales activas. Entradas con `__proto__`/`constructor` rechazadas (middleware existente). Límite de tasa en la ruta pública y en las escrituras (30/min por actor).
Sin SQL concatenado (parámetros), `ILIKE` con comodines escapados (patrón F11). El código del cupón no se registra en logs de aplicación.

## Impacto en la web (`sushimon-web`; lo implementa el `web-engineer`)

Rutas mock actuales → contrato: `GET /v1/promotions` → `GET /v1/store/promotions?branchId=&state=`; `GET|POST /v1/backoffice/promotions` → `GET|POST /v1/admin/promotions`; `PATCH /v1/backoffice/promotions/:id` → `PATCH /v1/admin/promotions/{id}` (+ `PATCH .../status` para activar/desactivar y `GET .../{id}`).
Archivos afectados (a verificar al integrar):

- Rutas y servicios: `src/lib/data-access/paths.ts` (`promotions`, `boPromotions`, `boPromotion`), `src/services/store.ts` (`listPromotions`), `src/services/backoffice-admin.ts`, `src/lib/data-access/models.ts` (los tipos propios derivan de los esquemas reales; los borradores `Promotion`/`PromotionInput`/`HappyHourItem` ya no existen en el contrato), `src/lib/data-access/parity.test.ts`.
- Hooks y claves: `src/features/catalog/hooks.ts` (`usePromotions` ahora por sucursal), `src/features/backoffice/hooks.ts` (`useBoPromotions`, `useSavePromotion`), `src/features/query-keys.ts` (líneas 137 y 180).
- Mocks/fixtures: `src/mocks/handlers/{public,backoffice-admin,index}.ts`, `src/mocks/domain.ts` (`promotionView`, `isPromotionLiveAt`), `src/mocks/fixtures/promotions.ts` (`PROMOTION_SEEDS`, `HAPPY_HOUR_ITEMS`), `src/mocks/{seed,store}.ts`, `src/mocks/scenarios/index.ts` (`promotion-expired`), `src/mocks/fixtures/rbac.ts`; mocks alineados con el contrato (códigos de error, `version`, alcance).
- Tienda: `src/features/promos/*` (`happy-hour.ts` pasa a trabajar con `[validFrom, validUntil)`, tramos por día y `nextStartsAt/nextEndsAt` del servidor en lugar de `startTime/endTime/daysOfWeek` únicos; `isHappyHour` sustituye a `id==='happy-hour'`), `src/features/menu/components/menu-happy-banner.tsx`,
  `src/features/store-shell/components/StoreFooter.tsx`. Datos a mostrar: promociones vigentes, Happy Hour con sus días y horas, próximas (con fecha de inicio), leyenda «solo en el restaurante» si `dineInOnly`, «requiere cupón» si `requiresCode` (sin descuento), y precio promocional indicativo **solo** si viene en `items`.
  Los ítems del Happy Hour (hoy texto libre `priceLabel`/`group`) se construyen con `productIds`/`items` + el catálogo (F11/F17); el agrupamiento «Entradas/Rolls/Cervezas» sale de la categoría del producto.
- Backoffice: `src/features/bo-catalog/components/{PromotionsScreen,PromotionModal}.tsx`, `catalog-view.ts`: listado paginado con filtros (sucursal, estado, tipo, fechas, búsqueda), formulario con instantes locales, tramos por día (partir al cruzar medianoche), alcance de sucursales/productos explícito, código opcional, `expectedVersion`, manejo de 409/422 por `code`, ocultar acciones si `editable=false` o falta el permiso.
- i18n `src/i18n/messages/{es,en}.json`; `e2e/visual/bo-catalog.spec.ts`; pruebas `backoffice-flow`, `backoffice-validation`, `store-flow`, `seed.test`, `catalog-view*.test`, `nav.test`.
- El modo `2x1` y «precio especial» del mock se retiran de la UI real (P15); si negocio los quiere se amplía `kind` con otra migración y ADR.

## Criterios de aceptación del backlog

| Criterio                                   | Cómo se cumple                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promoción vencida nunca aplica             | `[starts_at, ends_at)` con fin exclusivo evaluado en el servidor; `EXPIRED`/`NOT_STARTED` en el evaluador; la caché pública se acota por `nextChangeAt`; T3, T4, T10               |
| Total consistente con API                  | F15 no calcula totales; el evaluador es la única fuente de descuento y F19 lo usará con el precio de sucursal; los precios indicativos usan la misma función `computeLineDiscount` |
| Política de apilamiento testeada           | D15: una promoción por línea, mayor ahorro, desempate determinista; pruebas de no apilamiento (%+monto, cupón+automática) y de independencia del orden de entrada                  |
| Happy hour por zona horaria, fechas/semana | D14: `America/Guatemala` con helpers de F08, día ISO local, T1–T17                                                                                                                 |
| Descuento no excede límites                | Tope por línea, `PERCENT <= 100`, `FIXED_AMOUNT` ≤ precio por unidad; sin negativos; CHECK en BD                                                                                   |

## Pruebas exigidas

Evaluador (unitarias, sin BD): T1–T17, ejemplos numéricos de D15.8, propiedades (descuento ≤ `lineBase`, `finalPrice ≥ 0`, independencia del orden, determinismo del desempate, `quantity` y precios en los bordes, sin `Number` con decimales: ninguna aritmética en coma flotante), `dine_in_only` con `pickup`/`delivery`/`dine_in`, cupón con
mayúsculas/espacios, cupón desconocido vs inactivo (misma salida `UNKNOWN`), no apilamiento, promoción con código sin código. Servicio admin: validaciones y códigos (D12), `expectedVersion`, idempotencia sin escritura ni auditoría, código duplicado concurrente (23505 → 409), reemplazo de tramos/sucursales/productos atómico,
auditoría sin PII en la misma transacción, `PROMOTIONS_BUSY`. Alcance/IDOR (D10). Público: nunca `code` ni descuento de cupón, solo sucursal activa, `Cache-Control` por `nextChangeAt`, `items` solo visibles y disponibles, indicativo = `computeLineDiscount`. Contrato: `contracts:check`. BD real (pendiente de aprobación): CHECK
de `kind/value/code/period/weekday/slot`, `EXCLUDE`, FKs `RESTRICT`, unicidad de `code`, varias filas con `code NULL`, reaplicación. Web: Happy Hour por fase, estados vacíos, errores por `code`, invalidación por query key.

## Tareas por dueño

1. `database-engineer`: migración `0016_promotions` (4 tablas, CHECK, EXCLUDE, índices, RLS), `schema.prisma`, prueba de integración `migration-0016.int-spec.ts`, actualizar `docs/database/README.md` (ya hay párrafo propuesto).
2. `api-engineer`: módulo `src/promotions/`, evaluador y candidatas, `PROMOTIONS_BUSY` en `PUBLIC_5XX_CODES`, auditoría, pruebas; `contracts:check` verde.
3. `web-engineer`: integración de tienda y backoffice, retirada de los mocks (ver «Impacto en la web»).
4. `security-reviewer`/`qa-engineer`: IDOR por sucursal, enumeración de cupones, caché pública, matriz T1–T17.

## Verificado / No verificado

**Verificado** (comandos ejecutados en esta rama): lectura de los hechos citados arriba con `archivo:línea`; `pnpm contracts:generate` regenera `packages/contracts/src/schema.d.ts` sin error con las 6 operaciones y 15 esquemas nuevos; `pnpm contracts:check` falla **solo** con «Contrato sin implementar en la API» para las 6
operaciones nuevas (los tipos están al día y no hay endpoints fuera del contrato), igual que en F08–F13 antes de implementar la API.
**No verificado / pendiente**: ninguna migración existe ni se ha aplicado; no hay SQL probado (el SQL de arriba es una propuesta de modelo, no una migración); nada de API, evaluador ni web está implementado; los casos T1–T17 y los ejemplos numéricos son especificación, no pruebas ejecutadas (los ejemplos de D15.8 se calcularon a mano);
el comportamiento de `tsrange`/`time` con `24:00` se asume igual que en `0006` (verificado entonces en PGlite); la cifra de 14 días de horizonte y los topes (100/50/200/42) son decisiones de diseño sin medición.

### Implementación de la API (api-engineer)

**Implementado** (`sushimon-api/src/promotions/`, registrado en `AppModule`): `PromotionEvaluator` + `computeLineDiscount` + `PromotionEvaluationInputError` (puros, exportados con `PromotionCandidatesService` para F19); `promotion-schedule.ts` (vigencia, tramos, fusión de contiguos, `nextStartsAt/nextEndsAt/nextChangeAt`) y `PromotionTimeService`;
`PromotionCandidatesService.load` (1 consulta, tope 200); admin `GET|POST /v1/admin/promotions`, `GET|PATCH /v1/admin/promotions/{id}`, `PATCH .../status` (`@RequireStaff('promotions.*')`, aal2, alcance D10, `expectedVersion`, auditoría en la misma transacción, `no-store`, 30 escrituras/min por actor); público `GET /v1/store/promotions` (sin `code`, `Cache-Control` acotado por `nextChangeAt`,
60/min por IP); `PROMOTIONS_BUSY` en `PUBLIC_5XX_CODES`.
**Decisiones y desviaciones menores**: (1) `productIds` no vacío con `productScope=ALL` => 400 y más de 42 tramos => 400 (acordado en el contrato; el tope por día de 6 sigue siendo 422 `SLOT_LIMIT`); (2) el `code` se recorta antes de validar el patrón; (3) Express añade un `ETag` débil a todas las respuestas JSON: F15 lo **suprime solo en `GET /v1/store/promotions`** (interceptor por ruta; el resto de la API no cambia); (4) `max-age = min(N,5)` y `s-maxage = N`; con `nextChangeAt` a menos de 1 s, `N` queda en 1 s (F19 revalida); una edición del backoffice puede tardar hasta 30 s en verse en público;
(5) `coupon.status='UNKNOWN'` cubre inactiva, no iniciada, vencida **y fuera de horario**; `NOT_APPLIED` solo para sucursal/solo-en-el-local/sin ahorro/mejor oferta (F19 debe mostrar un único mensaje genérico ante todo lo que no sea `APPLIED`); (6) `nextEndsAt` solo se informa si la promoción está `live`; (7) los precios de `items` se calculan con `computeLineDiscount` (misma función que el evaluador).
**Verificado** (ejecutado): `typecheck`, `lint`, `test` (84 archivos, 1430 pruebas), `test:e2e` (18 archivos, 631 pruebas), `contracts:check`, `secrets:scan`; T1–T17, ejemplos numéricos D15.8, propiedades del evaluador, permisos/aal2/IDOR, auditoría, caché y 409 de versión con repositorio en memoria.
**Verificado (2026-11-16)**: SQL real de la API contra PostgreSQL (BD de pruebas con la 0016 aplicada): `test/promotions.int-spec.ts` 11/11 (candidatas, listado con `folded`/`LIKE`, EXCLUDE, UNIQUE de `code`, FK RESTRICT, `FOR UPDATE`, 409 por versión, B1 con fila bloqueada). **NO verificado**: `migration-0016.int-spec` (se omite contra Supabase; corre en el CI); carga/rendimiento (no medido); integración web con API real.

### Revisiones de seguridad y rendimiento (correcciones aplicadas)

**REQUISITO DE SEGURIDAD de F19 (cupones, M2).**

- `EvaluatorResult.coupon` es la vista DESTINADA AL CLIENTE: solo `APPLIED` o `NOT_APPLIED`, sin motivo. `couponPublicOutcome()` colapsa `UNKNOWN` en `NOT_APPLIED`. Código inexistente, vencido, inactivo, fuera de horario, de otra sucursal, «solo en el local» y sin ahorro producen la MISMA respuesta (probado). Las líneas públicas tampoco distinguen `NO_SAVING` de `NO_CANDIDATE`.
- El detalle (`UNKNOWN`, motivos, `rejected`, `lineReasons`) vive en `result.internal` y es SOLO para logs y pruebas: F19 no debe serializarlo hacia el cliente.
- F19 debe mostrar un mensaje único y genérico («cupón no válido») ante todo lo que no sea `APPLIED` y aplicar un throttle ESPECÍFICO del cotizador con cupón (por IP y por sesión/cliente), porque el cotizador es el único punto de prueba de códigos.
- `PromotionCandidatesService.load` devuelve `{ promotions, truncated }`: si había más de 200 candidatas se recorta (el cupón pedido va primero y nunca se recorta), se registra un warning sin códigos ni PII y F19 NO debe tratar el recorte como «cupón inválido» en silencio.

**Aviso (M1): `name` y `description` de un cupón son PÚBLICOS.** `GET /v1/store/promotions` lista los cupones con su nombre y descripción (sin código, descuento ni productos). El backoffice debe advertirlo junto a esos campos. Ocultar cupones de la tienda, un tope comercial de porcentaje y un permiso `promotions.publish` / `reason` obligatorio quedan como decisión de negocio P17 (no implementados).

**Correcciones de implementación**: autorización de PATCH/status por lectura SIN bloqueo y re-verificación de alcance y versión tras `FOR UPDATE` (un actor sin alcance recibe 404/403 sin tocar el candado); 409 de código solo por `promotions_code_key` (objetivo exacto); `name`/`description` rechazan NUL y controles bidi (400) y reutilizan el saneado de productos; `value` canónico (`"000001.00"` = `"1.00"`: sin cambio, sin `version`, sin auditoría); la tienda no lee `product_ids` de cupones (`has_products`); `findProductBasics` en lotes de 1000 y solo los primeros 50 productos por promoción (los `items` salen del subconjunto por `id`, no por nombre); evaluador con conjuntos por promoción y `toLocal` una vez por evaluación.

**Notas aceptadas (no implementadas)**: B2/B4/B7/B9 de la revisión de seguridad quedan como riesgos conocidos y aceptados para esta feature; se reevalúan junto con F19.

## Preguntas abiertas y asunciones

- **P14 (negocio)**: política de combinación. F15 aplica la estrategia conservadora de D15; falta decidir si se permite apilar, si el cupón puede coexistir con una automática y si es «por línea» o «por pedido».
- **P15 (negocio)**: `2x1`, «precio especial», límite de usos por cliente/total, cupón de un solo uso, restricción por monto mínimo de pedido y por primer pedido. Requieren política aprobada y, para los límites, un modelo persistente de canjes (tabla nueva) que **no** se diseña aquí.
- **P16 (negocio)**: si el `manager` debe recibir `promotions.read|update` por defecto para sus sucursales y si puede crear promociones. Hoy solo `admin`.
- **Asunción**: redondeo medio hacia arriba sobre el total de la línea (D15.7); si negocio prefiere redondear a favor del cliente o por unidad, es un cambio del evaluador.
- **Asunción**: una promoción `ALL` incluye las sucursales creadas después; es lo esperable para promociones de cadena y es la razón de exigir alcance global para crearlas.
- **Asunción**: `isHappyHour` derivado de «automática con horario semanal». Una bandera explícita requiere columna.
- **Riesgo**: una promoción automática `ALL`/`ALL` con `PERCENT` alto afecta a todo el menú; mitigado por alcance global, `aal2`, auditoría y exigir los alcances explícitos; sin tope comercial inventado.
- **Riesgo TOCTOU (F19/F20)**: entre cotizar y crear el pedido la promoción puede vencer o desactivarse; F20 debe reevaluar dentro de la transacción de creación y guardar snapshot del monto en `order_promotions.amount`.

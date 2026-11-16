# ADR-0021 Promociones, cupones y Happy Hour: tablas del DBML con alcance explícito, vigencia en instantes, una promoción por línea y evaluador puro

**Estado**: **propuesta** (2026-11-16, F15). Se acepta al fusionar `specs/016-promotions-happy-hour`. La política de combinación (P14) es **provisional** hasta que negocio la apruebe.

**Contexto**: el DBML define `promotions`, `promotion_branches`, `promotion_products` y `promotion_weekdays`, pero ninguna migración 0001–0015 las crea y no hay API; la web usa mocks con modalidades (`2x1`, precio especial) que el DBML no respalda. F13 ya entrega el precio de sucursal
(`BranchOffersService`) y F19 necesitará descuentos consistentes en servidor. Negocio no ha aprobado reglas de apilamiento, límites de uso ni un modo de pedido «en el local».

## Decisión

1. **Modelo = DBML + evolución mínima**, migración `0016_promotions` que **crea** las 4 tablas (no existían). Desviaciones: `description`, `version`, `created_at`, `updated_at`; CHECKs de `kind`, `value`, `code`, periodo y tramos; `EXCLUDE` de solapes (patrón `branch_hours`); índices por acceso real; FKs con `RESTRICT` a sucursales y productos. Sin triggers. RLS sin políticas + `REVOKE`.
2. **Automática vs cupón sin columna**: `code NULL` = automática. El `UNIQUE` del DBML permite múltiples `NULL`. `code` en mayúsculas por CHECK, de modo que el `UNIQUE` es insensible a mayúsculas sin índice funcional. Alternativa descartada: columna `type`/`requires_code` (redundante y contradecible).
3. **`kind` = `PERCENT | FIXED_AMOUNT`** con CHECK (`PERCENT` 0<v≤100; `FIXED_AMOUNT` 0<v≤999999.99 **por unidad**). `2x1` y precio especial quedan fuera (P15). Alternativa descartada: enumerado de PostgreSQL (más costoso de evolucionar que un CHECK, como en el resto del esquema).
4. **Alcance explícito**: ausencia de filas en `promotion_branches`/`promotion_products` = todas; el contrato obliga a declarar `branchScope`/`productScope` (`ALL|SELECTED`) y rechaza `SELECTED` vacío. Sin tramos = sin restricción semanal. Alternativa descartada: una columna `scope` (redundante con las filas).
5. **`dine_in_only`**: solo consumo en el local. Con los modos `pickup|delivery` existentes nunca aplica a pedidos en línea; el evaluador solo la admite con `mode='dine_in'`, que ningún endpoint acepta hoy.
6. **Tiempo**: vigencia `[starts_at, ends_at)` en instantes `timestamptz`; horario semanal `[starts_at, ends_at)` en hora local `America/Guatemala` con día ISO 1–7 y `24:00` solo como fin; **medianoche = estrategia B de F08 (dividir)**, cuenta el día calendario local del instante y se fusionan los tramos contiguos al calcular
   transiciones. Vigencia ≠ horario de apertura: no se consulta F08. Alternativa descartada: tramos con `ends_at <= starts_at` que cruzan el día (ambigüedad y CHECK complejo, ya rechazada en ADR-0011).
7. **Combinación CONSERVADORA (provisional, P14)**: una sola promoción por línea de producto (la de mayor ahorro; desempate: con código, vence antes, `id` menor); nunca se apilan %+monto ni cupón+automática; el descuento nunca supera el precio base de la línea; no se descuentan modificadores; base = precio de sucursal de F13. Líneas distintas pueden llevar promociones distintas.
   Alternativas descartadas por no estar aprobadas: apilar en cascada, prioridad manual por promoción, una promoción por pedido (queda como opción de P14).
8. **Aritmética exacta**: centavos enteros; porcentaje en basis points; redondeo medio hacia arriba sobre el total de la línea; cadenas decimales de 2 posiciones en la API. Jamás `float`.
9. **Evaluador puro** `PromotionEvaluator.evaluate(input)` (sin I/O ni reloj; entrada con instante, sucursal, modo, líneas, cupón y candidatas; salida por línea más rechazadas y estado del cupón). Lo consume F19; F15 no calcula totales de pedido ni crea pedidos. `PromotionCandidatesService` (lectura, ≤ 3 consultas) provee las candidatas. Un cupón
   desconocido o de una promoción no vigente produce el mismo estado `UNKNOWN` para evitar la enumeración de códigos.
10. **Sin endpoint de validación de cupón**: se valida al cotizar (F19) con contexto de carrito. Un endpoint propio sería enumerable por fuerza bruta y sin contexto.
11. **Público informativo**: `GET /v1/store/promotions?branchId=&state=live|upcoming`, sin `code` (nunca) ni descuento/productos de cupones (`requiresCode=true`); `isHappyHour` derivado; precios indicativos solo si los devuelve la API (misma función `computeLineDiscount`, cantidad 1, precio de sucursal, productos visibles y disponibles).
12. **Caché pública sin infraestructura nueva**: `public, max-age=min(N,5), s-maxage=N`, `N = clamp(segundos hasta nextChangeAt, 1, 30)` (el navegador cachea como máximo 5 s; la caché compartida hasta N), `no-store` si ya pasó; sin SWR/Redis y sin cabecera `ETag` en esta ruta; `Vary: Accept-Encoding`. Invalidación web por query key (`catalog.promotions` por sucursal y estado) + refetch en `nextChangeAt`. La verdad la fija el servidor al cotizar.
13. **Autorización** con permisos existentes (`promotions.read|create|update`, ADR-0010; por defecto solo `admin`): alcance por sucursal con `scopeFor/canAccess`; escribir una promoción exige cubrir **todas** sus sucursales (`ALL` => alcance global); fuera de alcance = 404, cubierta parcialmente = 403 `PROMOTION_SCOPE_FORBIDDEN`. No hay permiso nuevo ni RBAC paralelo;
    otorgar `promotions.*` al `manager` por defecto es P16.
14. **Concurrencia y auditoría**: `PATCH` con `expectedVersion` (409 `PROMOTION_VERSION_CONFLICT`); estado idempotente sin versión; `FOR NO KEY UPDATE` sobre la fila; auditoría `promotion.created|updated|status_changed` en la misma transacción sin PII; `Cache-Control: no-store` en `/v1/admin`; 503 `PROMOTIONS_BUSY` (añadir a `PUBLIC_5XX_CODES`); sin borrado físico.
15. **Fronteras**: `src/promotions/` depende de `BranchProductsModule`, `CategoriesModule` y `AuthModule`; no modifica `Products`, `Modifiers` ni `BranchProducts`; exporta evaluador y candidatas. Sin dependencias nuevas.

## Consecuencias

- Hasta 30 s de desfase en la tienda tras editar; el servidor revalida al cotizar (F19). Vencimiento: la caché nunca cruza un cambio de estado (acotada por `nextChangeAt`).
- Sin bandera explícita de «Happy Hour»: se deriva de «automática con horario semanal». Varias promociones recurrentes no-Happy-Hour requerirían una columna.
- La estrategia conservadora puede dar menos descuento del que negocio espera; cambiarla solo toca el evaluador (P14).
- Sin límites de uso ni cupones de un solo uso: un cupón vigente lo puede usar cualquiera, cualquier número de veces, hasta que se desactive o venza (P15). Mitigación: vigencia corta, `active=false`, auditoría.
- El mock soporta `2x1` y precio especial; se retiran al integrar (P15).
- `order_promotions` y su snapshot de monto llegan con F20; F20 debe reevaluar dentro de la transacción de creación (TOCTOU).
- Texto promocional solo en español (`name`, `description`); i18n del contenido queda pendiente (F16 o campo posterior).
- La migración 0016 debe aplicarse antes de desplegar la API de F15; sin ella `GET /v1/store/promotions` responde 500 (misma línea de despliegue que F12–F14).

## Alternativas descartadas

Columna de tipo de promoción o de ámbito; `2x1`/precio especial en F15; apilamiento en cascada; prioridad manual; cupón de un solo uso o contador de canjes sin política aprobada; endpoint público de validación de cupón; tramos que cruzan la medianoche; permiso nuevo `promotions.manage_branch`; RBAC paralelo; Redis o colas para invalidar la caché;
`float`/`Decimal` binario para el cálculo; mostrar el código o el descuento de un cupón en el listado público; triggers de BD para invariantes entre filas.

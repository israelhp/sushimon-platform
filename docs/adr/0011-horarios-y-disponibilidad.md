# ADR-0011 Horarios, cierres y disponibilidad operativa de sucursales

**Estado**: **propuesta** (2026-11-14, F08). Se acepta al fusionar `specs/007-branch-hours-closures`.

**Contexto**: el DBML define `branch_hours` (`weekday`, `opens_at`, `closes_at`) y `branch_closures` (`starts_at`, `ends_at`,
`reason`), pero no existen en migraciones ni API. El mock de la web usa `day 0-6` con un solo intervalo y calcula «abierto»
en el cliente. Checkout (F19/F20) necesita una única respuesta fiable a «¿esta sucursal acepta pedidos en `at`?».

## Decisión

1. **Hora local vs instante**: el horario semanal es **hora local del restaurante** (`HH:mm`, `America/Guatemala`, constante de
   negocio; no hay columna de zona por sucursal). Los cierres son **instantes** (`timestamptz`). Toda conversión vive en un único
   módulo puro basado en `Intl.DateTimeFormat(timeZone)`; el resultado no depende de la TZ del servidor, la BD ni el navegador.
2. **Convención ISO de instantes**: salida siempre UTC con `Z` y milisegundos (`toISOString`); entrada ISO 8601 con zona obligatoria
   (`Z` o `-06:00`), sin zona => 400, normalizada a UTC y truncada al segundo. Un solo formato de salida evita ambigüedades de
   offset y DST en clientes; la UI formatea con `timezone`.
3. **`weekday` ISO 1–7** (1 = lunes, 7 = domingo; `CHECK` en BD). Nunca `Date.getDay()`.
4. **Intervalos semiabiertos** `[opensAt, closesAt)`, `opensAt < closesAt`, `closesAt` admite `24:00`; contiguos permitidos y
   fusionados solo al calcular transiciones; solapados => 422.
5. **Medianoche: estrategia B (dividir)**: «vie 18:00-02:00» = vie `18:00-24:00` + sáb `00:00-02:00`. No se acepta `closesAt <= opensAt`.
   El cálculo de `nextClosesAt`/`nextOpensAt` fusiona tramos contiguos entre días (incluido dom→lun). Elegida porque mantiene
   cada fila autocontenida, el `CHECK closes > opens` válido y las consultas por día sin lógica de desborde.
6. **Concurrencia optimista sin columnas**: el horario se reemplaza completo (7 días) con `SELECT … FOR UPDATE` de la sucursal;
   `version` = SHA-256 del horario canónico, devuelta por GET y exigida como `expectedVersion` en PUT (409
   `HOURS_VERSION_CONFLICT`). No se añade `updated_at`/`version` a `branch_hours` (cambiaría el DBML sin necesidad).
7. **Cierres**: no se rechaza silenciosamente ni se consolida: solapamiento => 409 `CLOSURE_OVERLAP`. Edición/cancelación sin
   columnas nuevas (futuro: editable y borrable; en curso: solo acortar/terminar con `endsAt`; terminado: inmutable). El historial
   queda en `audit_events`.
8. **Un solo motor**: `BranchAvailabilityService` (función pura + adaptador de datos) es el único lugar donde se decide
   disponibilidad; HTTP público, backoffice y el puerto interno para F19/F20 lo reutilizan. Orden de evaluación: inactiva →
   horario sin configurar → cierre → fuera de horario → abierta.
9. **Sin pausa ni «último pedido»**: no hay política de negocio aprobada ni modelo de datos. El enum `reason` NO incluye
   `ORDER_CUTOFF_REACHED` ni `OPERATIONS_PAUSED`; `isAcceptingOrders = isOpenNow` (**BLOQUEADO** hasta decisión de negocio).
   El puerto acepta `orderCutoffMinutes` opcional como punto de extensión, sin valor por defecto (no se hardcodea 30).
10. **Respuestas públicas cacheables solo informativas**: hours (`s-maxage=300`) y availability (`s-maxage=10`). La validación
    definitiva en checkout (F20) llama al puerto contra la BD y puede rechazar aunque el estado público previo fuera `OPEN`.
11. **Errores**: `ErrorResponse` gana `code` y `violations[]` opcionales (compatibles) para códigos de negocio estables.
12. **Sin dependencias nuevas**: ni librería de fechas, ni Redis/colas para invalidar caché o programar aperturas.

## Consecuencias

- Migración `0006` incremental no destructiva (tablas nuevas); `AuthorizationService.scopeFor` por permiso en todas las rutas.
- Los esquemas draft `BranchHours`/`BranchAvailability` pasan a `DraftBranchHours`/`DraftBranchAvailability` hasta que la web migre.
- Cambiar la zona horaria por sucursal, DST o política de último pedido exige nueva columna/ADR; el módulo `business-time` aísla el impacto.
- Si `manager` debe editar horarios hay que otorgar `branches.manage_hours` (decisión de negocio, RBAC F03).

## Alternativas descartadas

- **Cruce de medianoche con `closesAt <= opensAt`** (estrategia A): filas ambiguas, `CHECK` complejo y desbordes en cada consulta.
- **Offset `-06:00` en salida**: dos representaciones del mismo instante según origen; peor para comparar y cachear.
- **Columna `version`/`updated_at` o ETag en BD**: cambia el modelo; el hash canónico lo evita.
- **Consolidar cierres solapados**: pierde la intención de cada registro y complica la edición.
- **Campo `cancelled_at`** o endpoint «terminar ahora»: más superficie; `PATCH endsAt <= ahora` basta.
- **Polling/WebSocket de disponibilidad**: la UI programa un refetch en `nextTransitionAt`.

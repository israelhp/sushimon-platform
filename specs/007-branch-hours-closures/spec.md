# F08 — Horarios, cierres y disponibilidad operativa de sucursales

**Rama**: `feature/F08-branch-hours-closures` (desde `develop` con F03 y F07 integrados)
**Prioridad**: P0 · **Dependencias**: F00, F01, F02, F03, F07 · **Estado**: `API_IMPLEMENTED` (contrato + API en `sushimon-api/src/branch-schedule/`; integración con PostgreSQL real NO ejecutada; web pendiente)
**Relacionadas (solo contratos reutilizables)**: F09, F15, F17, F19, F20, F22

## Alcance

`app.branch_hours` (horario semanal, hora local) y `app.branch_closures` (cierres extraordinarios, instantes), más el motor
único de disponibilidad (`BranchAvailabilityService`) que el resto de features consume. Fuera: checkout (F19/F20), pedidos (F22),
cobertura (F09), promociones/Happy Hour (F15), `/v1/store/bootstrap` (F17), pausa operativa y política de «último pedido» (ver D9).

## Hechos verificados del repo

- `branch_hours` y `branch_closures` están en el DBML pero NO en migraciones ni en `schema.prisma`: migración `0006` incremental no destructiva.
- Permisos F03 vigentes: `branches.read` y `branches.manage_hours` (hoy solo `admin`; que `manager` lo reciba es una decisión de negocio pendiente: F08 NO toca RBAC).
- Alcance por sucursal: `AuthorizationService.scopeFor/canAccess` (nunca la unión plana). Fuera de alcance => 404 (como F07).
- Sin librería de fechas en api ni web: se usa `Intl` (sin dependencias nuevas).
- Web mock actual: `BranchHours {day 0-6, open, close, closed}` con un intervalo y `isWithinHours`; migra a la convención ISO 1–7 con varios intervalos.
- F07: `active` es administrativo; el público solo ve sucursales activas. Admin `no-store`. Auditoría en la misma transacción (`app.audit_events`, append-only).

## Decisiones

- **D1 weekday ISO**: 1=lunes … 7=domingo. NUNCA `Date.getDay()`. `CHECK weekday BETWEEN 1 AND 7`. Documentado en OpenAPI, DTOs y UI.
- **D2 Zona horaria**: constante de negocio `America/Guatemala` (config validada con zod, default Guatemala; el modelo no tiene columna por sucursal). Las horas semanales son hora LOCAL del restaurante; los cierres son instantes (`timestamptz`). Conversión con `Intl.DateTimeFormat(timeZone)` en UN módulo puro (`business-time`), independiente de la TZ del servidor, BD y navegador. Pruebas con `TZ` distinta (UTC, Asia/Tokyo…) deben dar resultados idénticos. Instantes serializados en ISO-8601 de forma consistente (el arquitecto fija formato y lo documenta).
- **D3 Intervalos semiabiertos** `[opensAt, closesAt)`. Contiguos (`11:00-15:00` + `15:00-21:00`) se permiten y se fusionan al calcular transiciones; solapados => 422 con detalle. `opensAt < closesAt` estricto. Formato público `HH:mm`; `closesAt` puede ser `24:00` (solo cierre; `time` de PG admite `24:00:00`).
- **D4 Cruce de medianoche — ESTRATEGIA B (dividir)**: viernes `18:00-02:00` se guarda como viernes `18:00-24:00` + sábado `00:00-02:00`. NO se acepta `closesAt <= opensAt` ni «cierre al día siguiente» (error claro). nextClosesAt/nextOpensAt fusionan tramos contiguos entre días para no reportar falsas transiciones a medianoche. La UI puede ofrecer un atajo de presentación que parta el intervalo al guardar.
- **D5 Semana completa**: `PUT /v1/admin/branches/{id}/hours` reemplaza los 7 días en una transacción (delete+insert con `SELECT … FOR UPDATE` de la fila de la sucursal). Concurrencia optimista SIN columnas nuevas: GET devuelve `version` (SHA-256 hex del horario canónico); PUT exige `expectedVersion`; si no coincide => 409 `HOURS_VERSION_CONFLICT` sin guardar. `intervals: []` = día sin atención. La respuesta SIEMPRE trae los 7 días con intervalos ordenados.
- **D6 Límites**: máx. 6 intervalos por día. PUT sin cambios => 200 idempotente, sin escritura ni auditoría. Sin ningún intervalo en la semana => `SCHEDULE_NOT_CONFIGURED` (no se asume abierto).
- **D7 Cierres** `[startsAt, endsAt)`: `endsAt > startsAt` (CHECK en BD). Duración máx. 366 días; `startsAt` entre «ahora − 1 hora» (retroactividad máx. 1 h, `STARTS_TOO_EARLY`; también en PATCH de cierres futuros) y 2 años a futuro; máx. 100 cierres vigentes o futuros (`endsAt > ahora`) por sucursal (`CLOSURE_LIMIT_REACHED`, 422); no se aceptan cierres ya terminados (`endsAt <= ahora` => 422). `reason` opcional, trim, máx. 200, NUNCA público. Solapamiento entre cierres de la misma sucursal => 409 `CLOSURE_OVERLAP` (se rechaza, no se consolida; contiguos permitidos). Garantía: bloqueo de la fila de la sucursal en la transacción + verificación; el database-engineer evalúa `EXCLUDE USING gist` (btree_gist) si es viable en Supabase y PGlite (si no, se documenta). Un cierre = un registro aunque dure varios días.
- **D8 Edición y cancelación sin columnas nuevas** (no se inventa `cancelled_at`):
  - cierre futuro (`startsAt > ahora`): PATCH de `startsAt/endsAt/reason`; DELETE físico permitido (el historial queda en `audit_events` con old/new, append-only).
  - cierre en curso: PATCH solo de `endsAt` (únicamente para ACORTAR: `startsAt < endsAt_nuevo <= endsAt_actual`; si `endsAt_nuevo <= ahora` el servidor lo fija a «ahora» = termina ya) y de `reason`; DELETE => 409.
  - cierre terminado (`endsAt <= ahora`): inmutable (409 en PATCH y DELETE).
- **D9 Motor de disponibilidad** (`BranchAvailabilityService`; función pura de dominio + adaptador de datos). Orden: (1) inexistente => NotFound; (2) inactiva => `INACTIVE`; (3) sin intervalos en toda la semana => `SCHEDULE_NOT_CONFIGURED`; (4) dentro de cierre => `EXCEPTIONAL_CLOSURE`; (5) fuera de intervalos => `OUTSIDE_BUSINESS_HOURS`; (6) si no => `OPEN`. `isOpenNow` ⇔ `OPEN`. `isAcceptingOrders` = `isOpenNow` hoy: NO hay política aprobada de «último pedido» ni columna de pausa operativa => `ORDER_CUTOFF_REACHED` y `OPERATIONS_PAUSED` NO existen en el enum (bloqueo documentado y punto de extensión: el puerto acepta `orderCutoffMinutes` opcional, default ausente; NO hardcodear 30). `isAcceptingOrders ⇒ isOpenNow` siempre.
- **D10 Transiciones**: `nextOpensAt` (si cerrada), `nextClosesAt` (si abierta), `nextTransitionAt` = menor no nulo. Horizonte máximo 14 días; considera varios intervalos, fusión de contiguos (incl. medianoche) y cierres excepcionales (la apertura real es el fin del cierre si cae en horario, o la siguiente apertura semanal posterior); `null` si no hay en el horizonte. Iteración acotada (sin bucles infinitos).
- **D11 Reloj**: `Clock` inyectable (`now(): Date`); el servidor es la única fuente de tiempo. Los endpoints públicos NO aceptan fecha para el estado actual. Para pedidos programados (F19/F20) el puerto interno `getAvailability({branchId, at})`/`canAcceptOrder` acepta `at` (uso interno, no HTTP). Sin endpoint de previsualización en F08.
- **D12 Públicos**: `GET /v1/branches/{id}/hours` (7 días + `timezone` + `upcomingClosures [{startsAt,endsAt}]` sin motivo, ≤ 30 días, máx. 10; `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`). `GET /v1/branches/{id}/availability` (compacto; `public, max-age=10, s-maxage=10`, sin stale-while-revalidate; incluye `serverTime` y `nextTransitionAt`; inexistente o inactiva => 404 como F07 pública; `INACTIVE` solo lo ve el puerto interno). Checkout/pedidos NUNCA usan estas respuestas cacheadas.
- **D13 Admin** (no-store; JWT + staff + aal2): `GET …/hours` [`branches.read`], `PUT …/hours` [`branches.manage_hours`], `GET …/closures` [`branches.read`; `status=current|upcoming|active|past|all` (default `current` = activos + futuros), `from`, `to`, `page`, `pageSize`], `POST …/closures`, `PATCH …/closures/{closureId}`, `DELETE …/closures/{closureId}` (204) [`branches.manage_hours`]. La UI reutiliza el endpoint público de disponibilidad (no se duplica).
- **D14 Auditoría** (misma tx, solo diff real): `branch.hours_updated` (old/new de los días cambiados), `branch_closure.created`, `branch_closure.updated`, `branch_closure.cancelled`. Sin PII.
- **D15 Módulo API**: UN módulo `src/branch-schedule/` (hours + closures + availability: comparten el motor, evita dependencias circulares). Exporta `BranchAvailabilityService` como puerto para checkout. Depende de `BranchesQueryService` (F07) y `AuthorizationService` (F03). F07 no depende de F08.
- **D16 Caché cliente**: query keys jerárquicas `branches.hours(id)`, `branches.availability(id)`, `admin.branches.hours(id)`, `admin.branches.closures(id, filters)`. Disponibilidad: refetch programado en `nextTransitionAt` (timeout con tope) + `refetchOnWindowFocus`; sin polling por segundo. Al guardar: invalidar hours, availability y closures de ESA sucursal.
- **D17 Fuera de alcance / bloqueos**: checkout, pedidos, pausa operativa (sin modelo), política de último pedido (sin aprobación de negocio), horarios por zona (F09), promociones (F15), `/v1/store/bootstrap` (F17).

## Correcciones y huecos resueltos por el arquitecto

1. **D8 «terminar un cierre en curso»**: no hay endpoint ni campo nuevo. Se hace con `PATCH { endsAt }` con cualquier instante `<= ahora`; el servidor lo fija a «ahora». Si «ahora» coincidiera con `startsAt` (rango vacío) responde 422 `CLOSURE_RANGE_INVALID` y un reintento posterior funciona.
2. **Definición de estados** (reloj del servidor): `upcoming` = `startsAt > ahora`; `active` = `startsAt <= ahora < endsAt`; `past` = `endsAt <= ahora`. D7 permite crear con `startsAt` pasado si `endsAt > ahora` (cierre de emergencia ya en curso); queda `active`.
3. **Códigos de error**: `ErrorResponse` no tenía campo de código de negocio. Se añadieron `code` (string, opcional) y `violations[]` (`ErrorViolation {path, code, message}`), ambos opcionales y compatibles. `AllExceptionsFilter` debe propagar `code` y `violations` si el payload de la excepción los trae (tarea api-engineer). `error` sigue siendo el nombre HTTP (`CONFLICT`, `UNPROCESSABLE_ENTITY`).
4. **422 vs 400**: forma inválida (formato `HH:mm`, `weekday` fuera de 1..7, no son 7 días, días repetidos, >6 intervalos, `expectedVersion` malformada, instantes sin zona) => 400 con `details` (convención existente). Reglas de negocio de horario (solape, `opensAt >= closesAt`) => 422 `SCHEDULE_INVALID` con `violations`. Reglas de cierre (rango, duración, horizonte, ya terminado) => 422 `CLOSURE_RANGE_INVALID`; solapamiento de cierres => 409.
5. **Colisión de nombres**: el contrato ya tenía los esquemas draft `BranchHours` y `BranchAvailability` (modelo mock con `day 0-6`). Se renombraron a `DraftBranchHours` y `DraftBranchAvailability`; `sushimon-web/src/lib/data-access/models.ts` mantiene los alias `BranchHours`/`BranchAvailability` apuntando a ellos (cambio de 2 líneas). La web de F08 migra al esquema nuevo y retira los drafts.
6. **`INACTIVE` en el enum** `reason`: lo comparte el puerto interno; en HTTP público nunca aparece (404).
7. **PUT con la semana vacía** (7 días sin intervalos) es válido: deja la sucursal en `SCHEDULE_NOT_CONFIGURED`. Se puede editar el horario de una sucursal inactiva (preparar antes de activar).
8. **Intervalos contiguos** se guardan tal como se enviaron (no se fusionan en BD ni afectan `version`); la fusión es solo de cálculo.
9. **429** es transversal (cabecera del contrato); no se repite por operación.
10. **Reloj** `ms`: las comparaciones usan milisegundos; los instantes de entrada se truncan al segundo.

## Convención de tiempo (ADR-0011)

- Horas semanales: `HH:mm` locales de `America/Guatemala` (UTC-6 fijo, sin horario de verano), campo `timezone` informativo en las respuestas.
- Instantes (`startsAt`, `endsAt`, `serverTime`, `next*At`): ISO 8601 en **UTC con sufijo `Z`**, siempre con milisegundos (`2026-11-16T17:00:00.000Z`, salida de `Date#toISOString`). Entrada: ISO 8601 con zona obligatoria (`Z` o `±hh:mm`; `-06:00` aceptado); sin zona => 400; se normaliza a UTC y se trunca al segundo. La UI convierte a hora local con `Intl` y `timezone`.

## Reglas de evaluación

Evaluación de `getAvailability({branchId, at})` (primera regla que aplica gana):

| #   | Condición                                                           | `reason`                  | `isOpenNow` | HTTP público |
| --- | ------------------------------------------------------------------- | ------------------------- | ----------- | ------------ |
| 1   | La sucursal no existe                                               | (NotFound)                | —           | 404          |
| 2   | `active = false`                                                    | `INACTIVE`                | false       | 404          |
| 3   | Ningún intervalo en toda la semana                                  | `SCHEDULE_NOT_CONFIGURED` | false       | 200          |
| 4   | Existe cierre con `startsAt <= at < endsAt`                         | `EXCEPTIONAL_CLOSURE`     | false       | 200          |
| 5   | Ningún intervalo local del día de `at` cumple `opens <= t < closes` | `OUTSIDE_BUSINESS_HOURS`  | false       | 200          |
| 6   | Si no                                                               | `OPEN`                    | true        | 200          |

`t` = hora local de `at` (`Intl`, `America/Guatemala`), `weekday` ISO del día local. `isAcceptingOrders = isOpenNow` (D9).

Límites exactos (todos con semiabierto `[inicio, fin)`):

| Evento                              | Instante exacto        | Resultado                          |
| ----------------------------------- | ---------------------- | ---------------------------------- |
| Inicio de intervalo                 | `t == opensAt`         | abierta (incluido)                 |
| Un instante antes del fin           | `t == closesAt - 1 ms` | abierta                            |
| Fin de intervalo                    | `t == closesAt`        | cerrada (excluido) salvo contiguo  |
| Inicio de cierre                    | `at == startsAt`       | `EXCEPTIONAL_CLOSURE` (incluido)   |
| Fin de cierre                       | `at == endsAt`         | cierre ya no aplica (excluido)     |
| Cierres contiguos `[a,b)` + `[b,c)` | `at == b`              | `EXCEPTIONAL_CLOSURE` (por el 2.º) |
| `24:00`                             | `t` nunca iguala 24:00 | equivale a «hasta fin del día»     |

## Ejemplos numéricos

Horario de referencia **S** (hora local; UTC = local + 6 h): lun–jue (1–4) `11:00-15:00` y `15:00-22:00`; vie (5) `11:00-24:00`; sáb (6) `00:00-02:00` y `11:00-24:00`; dom (7) `00:00-02:00` y `12:00-21:00`. («Viernes 18:00-02:00» se modela como vie `-24:00` + sáb `00:00-02:00`.) Fechas: 2026-11-16 es lunes. Sin cierres salvo indicación.

| `at` (local)    | `at` (UTC)                 | reason                   | `nextOpensAt`                             | `nextClosesAt`                                                               |
| --------------- | -------------------------- | ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------- |
| lun 16 10:59:59 | `2026-11-16T16:59:59.000Z` | `OUTSIDE_BUSINESS_HOURS` | lun 11:00 = `…17:00:00Z`                  | null                                                                         |
| lun 16 11:00:00 | `2026-11-16T17:00:00.000Z` | `OPEN`                   | null                                      | lun 22:00 = `2026-11-17T04:00:00.000Z`                                       |
| lun 16 15:00:00 | `2026-11-16T21:00:00.000Z` | `OPEN` (2.º intervalo)   | null                                      | lun 22:00 (no 15:00: contiguo fusionado)                                     |
| lun 16 22:00:00 | `2026-11-17T04:00:00.000Z` | `OUTSIDE_BUSINESS_HOURS` | mar 11:00 = `2026-11-17T17:00:00.000Z`    | null                                                                         |
| vie 20 23:59:59 | `2026-11-21T05:59:59.000Z` | `OPEN`                   | null                                      | sáb 21 02:00 = `2026-11-21T08:00:00.000Z` (vie 24:00 + sáb 00:00 fusionados) |
| sáb 21 00:00:00 | `2026-11-21T06:00:00.000Z` | `OPEN`                   | null                                      | sáb 02:00 (igual)                                                            |
| sáb 21 02:00:00 | `2026-11-21T08:00:00.000Z` | `OUTSIDE_BUSINESS_HOURS` | sáb 11:00 = `…17:00:00Z`                  | null                                                                         |
| dom 22 21:00:00 | `2026-11-23T03:00:00.000Z` | `OUTSIDE_BUSINESS_HOURS` | lun 23 11:00 = `2026-11-23T17:00:00.000Z` | null                                                                         |

Domingo→lunes (variante **V**: dom `18:00-24:00`, lun `00:00-01:00` y `11:00-22:00`): en dom 20:00 local (`2026-11-23T02:00:00.000Z`) `nextClosesAt` = lun 01:00 local (`2026-11-23T07:00:00.000Z`), no dom 24:00: la semana es cíclica (dom 7 → lun 1) y se fusiona igual que vie→sáb.

Cierre **C** = `[lun 16 13:00, lun 16 17:00)` local = `[2026-11-16T19:00:00.000Z, 2026-11-16T23:00:00.000Z)`:

| `at` (local) | reason                | `nextOpensAt`                                                           | `nextClosesAt`                                   |
| ------------ | --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| lun 12:59:59 | `OPEN`                | null                                                                    | lun 13:00 = `…19:00:00.000Z` (inicio del cierre) |
| lun 13:00:00 | `EXCEPTIONAL_CLOSURE` | lun 17:00 = `2026-11-16T23:00:00.000Z` (fin del cierre, cae en horario) | null                                             |
| lun 16:59:59 | `EXCEPTIONAL_CLOSURE` | lun 17:00                                                               | null                                             |
| lun 17:00:00 | `OPEN`                | null                                                                    | lun 22:00                                        |

Cierres contiguos `[13:00,15:00)` + `[15:00,17:00)`: en lun 15:00 sigue cerrada y `nextOpensAt` = 17:00 (se fusionan; no se reporta una falsa apertura a las 15:00). Cierre que termina fuera de horario, `[lun 21:00, mar 00:00)`: en lun 21:30 `nextOpensAt` = mar 11:00 (la siguiente apertura semanal, no la medianoche).

Horizonte de 14 días: una transición `t` se reporta si `at < t <= at + 14 días` (14 × 24 h de reloj). Con `at` = lun 2026-11-16 12:00 local y un cierre `[2026-11-16 00:00, 2026-11-30 12:00)` local, `nextOpensAt` = `2026-11-30T18:00:00.000Z` (exactamente en el límite: incluido). Si el cierre termina a las 12:00:01, `nextOpensAt` = null y `nextTransitionAt` = null. Con un cierre `[2026-11-16 00:00, 2026-12-10 00:00)` también null. La iteración recorre como máximo 15 días calendario y un número acotado de tramos (≤ 7 × 6 × 3).

## Formato de errores

Cuerpo base `ErrorResponse` + `code` + `violations` opcionales. Ejemplo 422 por día/intervalo (PUT hours):

```json
{
  "statusCode": 422,
  "error": "UNPROCESSABLE_ENTITY",
  "code": "SCHEDULE_INVALID",
  "message": "Horario inválido",
  "requestId": "…",
  "violations": [
    {
      "path": "days[4].intervals[1]",
      "code": "INTERVAL_OVERLAP",
      "message": "Se solapa con days[4].intervals[0] (11:00-15:00)"
    },
    {
      "path": "days[5].intervals[0]",
      "code": "INTERVAL_RANGE_INVALID",
      "message": "opensAt debe ser menor que closesAt; para cruzar la medianoche divide el turno en dos días"
    }
  ]
}
```

`path` usa índices 0-based del arreglo recibido (`days[i]` = posición en el request, no `weekday`). `details` (strings) solo en 400.

| HTTP | `code`                   | Cuándo                                                                                                                                                                                          |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | —                        | Forma inválida (usa `details`)                                                                                                                                                                  |
| 404  | —                        | Sucursal/cierre inexistente o fuera de alcance, o inactiva en público                                                                                                                           |
| 409  | `HOURS_VERSION_CONFLICT` | `expectedVersion` no coincide con la vigente                                                                                                                                                    |
| 409  | `BRANCH_SCHEDULE_BUSY`   | Espera de candado agotada (`lock_timeout` 2 s, SQLSTATE 55P03) o transacción sin conexión/tiempo (P2028) en cualquier escritura; reintentable, sin detalle interno                              |
| 409  | `CLOSURE_OVERLAP`        | Solapa con otro cierre; `violations[0].path = "closures/<id>"`                                                                                                                                  |
| 409  | `CLOSURE_NOT_EDITABLE`   | PATCH a cierre terminado, o en curso que cambia `startsAt`/alarga `endsAt`                                                                                                                      |
| 409  | `CLOSURE_NOT_DELETABLE`  | DELETE a cierre en curso o terminado                                                                                                                                                            |
| 422  | `SCHEDULE_INVALID`       | `violations[].code` ∈ `INTERVAL_OVERLAP`, `INTERVAL_RANGE_INVALID`                                                                                                                              |
| 422  | `CLOSURE_LIMIT_REACHED`  | Ya hay 100 cierres vigentes o futuros en la sucursal (evaluado con el candado tomado)                                                                                                           |
| 422  | `CLOSURE_RANGE_INVALID`  | `endsAt <= startsAt`, duración > 366 d, `startsAt` > 2 años, `endsAt <= ahora`; `violations[].code` ∈ `RANGE_EMPTY`, `DURATION_EXCEEDED`, `STARTS_TOO_FAR`, `ALREADY_ENDED`, `STARTS_TOO_EARLY` |

## Puerto interno `BranchAvailabilityPort` (F19/F20)

Exportado por `BranchScheduleModule` (token DI `BRANCH_AVAILABILITY_PORT`; implementación `BranchAvailabilityService`). Sin HTTP.

```ts
interface BranchAvailabilityPort {
  getAvailability(input: {
    branchId: string;
    at: Date;
    orderCutoffMinutes?: number;
  }): Promise<BranchAvailabilityResult>;
  canAcceptOrder(input: {
    branchId: string;
    at: Date;
  }): Promise<{ accepted: boolean; reason: BranchAvailabilityReason; nextOpensAt: Date | null }>;
}
// BranchAvailabilityResult = { branchId; timezone; at; isOpenNow; isAcceptingOrders; reason; nextOpensAt; nextClosesAt; nextTransitionAt }  (Date | null)
```

- Siempre lee de la BD (nunca de caché); `getAvailability` lanza `NotFoundException` si la sucursal no existe. Sí devuelve `INACTIVE`.
- `canAcceptOrder = getAvailability(...).isAcceptingOrders`.
- `at` lo fija el llamador: ahora (pedido inmediato) o la hora programada (pedido programado). Un pedido programado es válido si la sucursal acepta pedidos en `at` (más reglas de anticipación de F19/F20, fuera de F08).
- `orderCutoffMinutes` ausente = sin política; presente solo en pruebas/extensión futura (no se cablea en F08).
- **Cierre durante el checkout**: la respuesta pública `OPEN` puede estar hasta ~10 s (CDN) o más (cliente) desactualizada. La validación definitiva ocurre en F20 al crear el pedido, en la misma transacción lógica, llamando al puerto con `at = ahora` (o la hora programada); si `accepted = false` rechaza (409 propio de F20, p. ej. `BRANCH_NOT_ACCEPTING_ORDERS`, a definir en su contrato) aunque el estado público previo fuera `OPEN`. F08 no reserva ni bloquea la sucursal.

## Contrato (resumen)

| Operación                  | Método y ruta                                               | Permiso                 | Caché                                       |
| -------------------------- | ----------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| `getBranchHours`           | GET `/v1/branches/{id}/hours`                               | público                 | `public, max-age=60, s-maxage=300, swr=600` |
| `getBranchAvailability`    | GET `/v1/branches/{id}/availability`                        | público                 | `public, max-age=10, s-maxage=10`           |
| `getAdminBranchHours`      | GET `/v1/admin/branches/{id}/hours`                         | `branches.read`         | `no-store`                                  |
| `replaceAdminBranchHours`  | PUT `/v1/admin/branches/{id}/hours`                         | `branches.manage_hours` | `no-store`                                  |
| `listAdminBranchClosures`  | GET `/v1/admin/branches/{id}/closures`                      | `branches.read`         | `no-store`                                  |
| `createAdminBranchClosure` | POST `/v1/admin/branches/{id}/closures`                     | `branches.manage_hours` | `no-store`                                  |
| `updateAdminBranchClosure` | PATCH `/v1/admin/branches/{id}/closures/{closureId}`        | `branches.manage_hours` | `no-store`                                  |
| `deleteAdminBranchClosure` | DELETE `/v1/admin/branches/{id}/closures/{closureId}` (204) | `branches.manage_hours` | `no-store`                                  |

`version`: SHA-256 hex de `weekday|opensAt|closesAt` por intervalo (orden `weekday`, `opensAt`), unidos con `\n`, `24:00` sin normalizar; semana vacía = SHA-256 de la cadena vacía. Se calcula dentro de la transacción tras el bloqueo.

## Pruebas exigidas (api/web)

Unitarias del motor puro con `TZ` = UTC y `Asia/Tokyo` (resultados idénticos); todos los ejemplos de arriba como tabla; integración (PGlite/BD de prueba): alcance (otra sucursal => 404), `HOURS_VERSION_CONFLICT` con dos PUT, `CLOSURE_OVERLAP`, PATCH/DELETE por estado, auditoría en la misma transacción, caché headers; e2e web: editor de horarios y cierres, estado público.

## Tareas por agente

1. database-engineer: migración `0006` (tablas, `CHECK weekday 1..7`, `CHECK ends_at > starts_at`, `closes_at > opens_at`, índices, EXCLUDE si viable), `schema.prisma`.
2. api-engineer: módulo `src/branch-schedule/`, filtro (`code`, `violations`), DTOs, auditoría, puerto, `contracts:check` verde.
3. web-engineer: servicios http, editor de horarios (varios intervalos, atajo de turno nocturno que divide), cierres, estado público, migrar fuera de `DraftBranchHours`.
4. qa-engineer / security-reviewer: matriz de pruebas y revisión de alcance (404 vs 403) y no exposición de `reason` en público.

## Pendiente de decisión de negocio

1. ¿`manager` recibe `branches.manage_hours` (limitado a su sucursal)? Hoy solo `admin` puede editar horarios.
2. Política de «último pedido» (minutos, global o por sucursal/modalidad) y pausa operativa (columna/tabla propia): bloquean `isAcceptingOrders ≠ isOpenNow`.
3. Zona horaria por sucursal (hoy constante Guatemala).

## Estado de implementación de la API (api-engineer)

**Implementado** (módulo `sushimon-api/src/branch-schedule/`, un solo módulo; `BranchScheduleModule` exporta `BRANCH_AVAILABILITY_PORT` y `BranchAvailabilityService`):

- Los 8 `operationId` del contrato (`pnpm contracts:check` verde): públicos con `Cache-Control` de D12 (solo en 2xx) y admin con `no-store` (middleware por prefijo, incluye 401/403), `@RequireStaff('branches.read'|'branches.manage_hours')`, alcance por `canAccess` (fuera de alcance = 404).
- `business-time` puro (solo `Intl.DateTimeFormat` + `Date.UTC`; `isoWeekdayOf` por aritmética), dominio puro `evaluateAvailability` (D3/D4/D9/D10, horizonte 14 días, 17 días de ventana fija), `Clock` inyectable (`CLOCK`), `BUSINESS_TIMEZONE` validada con zod (default `America/Guatemala`, vacío = default).
- Horarios: lectura con `$queryRaw` (`::text`), escritura con `$executeRaw` (`::time`, un `DELETE` + un `INSERT … unnest`) dentro de la transacción tras `SELECT … FOR UPDATE` de la sucursal; versión SHA-256 según la spec; PUT idéntico idempotente; `422 SCHEDULE_INVALID` con `violations`.
- Cierres: CRUD con D7/D8, estados `upcoming/active/past`, listado `status/from/to/page/pageSize`, `409 CLOSURE_OVERLAP` (verificación previa con `violations[0].path = closures/<id>` + red de seguridad del EXCLUDE `23P01`), `CLOSURE_NOT_EDITABLE/NOT_DELETABLE`, `422 CLOSURE_RANGE_INVALID`.
- Auditoría en la misma transacción solo con diff real (`branch.hours_updated` con claves `weekday_N` + `version`; `branch_closure.created|updated|cancelled`).
- `AllExceptionsFilter` propaga `code` y `violations[]` (solo campos conocidos y bien formados; nunca en 5xx).
- Cambios mínimos en F07 (aditivos): `BranchesQueryService.getStatus(id)` + `BranchesRepository.findStatus` (existencia y `active`, necesarios para distinguir inexistente de `INACTIVE` en el puerto).

**Verificado** (comandos reales): `pnpm --filter sushimon-api lint|typecheck|test|test:e2e|build` y `pnpm contracts:check` (conteos en el informe del PR). Unitarias: todos los ejemplos numéricos de esta spec como tabla; misma salida con `TZ` = UTC, Asia/Tokyo y America/New_York (procesos hijos con control negativo que prueba que la `TZ` sí cambió); servicios con repositorio en memoria; e2e supertest con reloj inyectado.

**Escrito pero NO ejecutado**: `test/branch-schedule.int-spec.ts` (PostgreSQL real vía `DATABASE_URL_TEST`: `24:00` de ida y vuelta, PUT atómico, concurrencia con `expectedVersion`, EXCLUDE de horarios/cierres con el error real del driver, aislamiento entre sucursales, auditoría) y `test/migration-0006.int-spec.ts`. El SQL crudo (`unnest`, casts `::time`/`::text`, `FOR UPDATE`) y la traducción de `23P01` con el formato real de errores de Prisma 7 + adapter `pg` **no están verificados contra una BD**.

**Decisiones de implementación (no ambiguas en la spec, documentadas aquí)**:

1. Orden de comprobaciones del PUT: `expectedVersion` ≠ vigente => 409 antes de comparar contenido; un PUT con contenido idéntico pero versión vieja da 409 (un reintento tras respuesta perdida debe recargar).
2. «startsAt máx. 2 años» = 730 días de reloj. `reason` vacío tras `trim` se guarda como `null`; el tope de 200 caracteres se evalúa tras `trim` (400).
3. Instantes de entrada: regex estricta ISO 8601 con zona, fechas inexistentes (31-feb) => 400; salida siempre `toISOString()`.
4. `INACTIVE`, `SCHEDULE_NOT_CONFIGURED`: `nextOpensAt/nextClosesAt/nextTransitionAt = null`.
5. `isAcceptingOrders` con `orderCutoffMinutes` (solo extensión interna): `at < nextClosesAt - cutoff`; `reason` permanece `OPEN`.
6. `PATCH` con `startsAt` igual al actual en un cierre en curso no cuenta como cambio.

**Pendiente / bloqueado**: web (F08 UI), ejecución de las pruebas de integración en CI/BD de pruebas, aprobación humana de la migración 0006 (`btree_gist`), y las decisiones de negocio listadas arriba (RBAC de `manager`, último pedido/pausa, zona por sucursal).

## Ronda de correcciones tras revisión de seguridad y rendimiento

**Rendimiento (implementado)**

- P1: las rutas públicas hacen UNA consulta (`BranchScheduleRepository.loadSchedule`: estado + horario + cierres con subselects `json_agg`, una sola conexión); inexistente = 0 filas, inactiva = `active=false` (ambas 404 idénticas). El puerto ya no consulta `BranchesQueryService` (la existencia/estado salen de la misma consulta).
- P2: `lockBranch` usa `FOR NO KEY UPDATE` (serializa escritores y choca con el `FOR SHARE` de `allActiveForShare`, pero no bloquea las inserciones hijas por FK).
- P3: `Cache-Control` de availability dinámico: `max-age = s-maxage = min(10, segundos enteros hasta nextTransitionAt)`; menos de 1 s => `no-store`; sin stale-while-revalidate (`AvailabilityCacheInterceptor`).
- P4: puerto `BranchAvailabilityPort`: `tx?` opcional en `getAvailability`/`canAcceptOrder`/`loadSchedule`/`readHours` (se lee con la conexión del llamador); `getAvailabilityMany({branchIds, at})` (una consulta para N sucursales; `NotFoundException` si alguna no existe); `evaluate(snapshot, at)` puro; `canAcceptOrderNow(branchId, tx?)` con `clock.now()`: F19/F20 lo usan para «pedir ahora» y pasan `at` SOLO para pedidos programados. `at` inválido o fuera de 2000–2100, o `orderCutoffMinutes` fuera de 0..1440 => 400 `INVALID_AVAILABILITY_INPUT` (no `RangeError`/500).
  - **Recomendación (NO implementada, decisión de producto pendiente)**: endpoint agregado `GET /v1/branches/availability` para el selector de sucursales de la tienda (hoy N llamadas a `/availability`); F17 (`/v1/store/bootstrap`) puede usar `getAvailabilityMany`.
- P5: `listClosures` sin `$transaction` (`Promise.all` de `findMany` + `count`); `page` máx. 10 000; el desempate por `id` se MANTIENE en el orden para que la paginación sea estable cuando dos cierres comparten `starts_at`.
- P6: `memoizedOffsets` (solo dentro de una evaluación, jamás entre peticiones): calcula el desfase de la zona al inicio y al final de cada día UTC y lo reutiliza si coinciden; si no (día de cambio de horario) calcula cada instante exacto. Medición (7 × 6 intervalos, 14 cierres, 200 evaluaciones): **409 → 37 llamadas a `Intl.formatToParts` por evaluación; 4,4 ms → 1,1 ms**. Resultados idénticos (tabla de la spec, sonda de `TZ`, barrido por DST en America/New_York y Lord_Howe).

**Seguridad (implementado)**

- S1: escrituras con `SET LOCAL lock_timeout = '2s'` antes del candado y transacción interactiva con `maxWait` 2 s / `timeout` 8 s; 55P03 y P2028 => 409 `BRANCH_SCHEDULE_BUSY`. No hay patrón de `@Throttle` por ruta en F03/F07 (solo el guard global `AppThrottlerGuard`): no se inventó uno; queda como recomendación un límite más estricto por ruta en las escrituras admin.
- S2: tope de 100 cierres vigentes o futuros por sucursal (422 `CLOSURE_LIMIT_REACHED`, dentro de la transacción con el candado). `closuresIntersecting`/`loadSchedule` NO se trunca (un resultado truncado daría una disponibilidad errónea); los listados admin ya están acotados por `pageSize` ≤ 100.
- S3: `startsAt` no puede ser anterior a «ahora − 1 h» en POST ni en PATCH de cierres futuros (422 `CLOSURE_RANGE_INVALID`, violación `STARTS_TOO_EARLY`, path `startsAt`).
- S4: toda respuesta de error (4xx/5xx, públicas o admin) lleva `Cache-Control: no-store`, de forma central en `AllExceptionsFilter` (se ajustó la aserción de `branches.e2e-spec.ts` que esperaba la ausencia de cabecera en el 404 público de F07).
- S5: el filtro no registra mensajes ni argumentos de errores cuyo `name` empieza por `PrismaClient`: solo `name`, `code` y `requestId`.

**Riesgo residual aceptado (S7)**: (B2) lost update posible en `PATCH` de cierres entre dos administradores (no exige versión; el último gana, ambos auditados); (B3) `reason` libre puede contener PII y se copia a la auditoría (append-only); (B5) `/hours` público se cachea 5–15 min: la UI NO debe usarlo para decidir «abierto ahora» (usar `/availability`).

**Sin verificar contra BD real**: `loadSchedule` (`json_agg`, `LIMIT $n::int` nulo, `EXTRACT(EPOCH …)::bigint`), `SET LOCAL lock_timeout`, `FOR NO KEY UPDATE`, el tiempo de espera real de 2 s y la forma del error 55P03 de Prisma 7 + adapter `pg` están cubiertos solo en `branch-schedule.int-spec.ts` (escrito, NO ejecutado).

## Estado de la web (web-engineer, `sushimon-web`)

**Implementado contra el mock (listo para http)**: servicios y hooks de los 8 `operationId`; handlers mock con las reglas
de esta spec (400 forma / 422 `SCHEDULE_INVALID` y `CLOSURE_RANGE_INVALID` con `violations` / 409 `HOURS_VERSION_CONFLICT`,
`CLOSURE_OVERLAP`, `CLOSURE_NOT_EDITABLE`, `CLOSURE_NOT_DELETABLE` / 404 fuera de alcance); motor de disponibilidad del mock
con los ejemplos de la spec como pruebas (incl. TZ distinta); editor semanal (varios intervalos, conflictos `[a,b)`, máx. 6,
atajo de turno nocturno D4, `expectedVersion`, recarga ante 409); cierres (filtro de estado, crear, editar según estado,
terminar en curso, cancelar futuros, confirmaciones, motivo solo en admin); estado de sucursal diferenciado; horario
público (Más y hoja de modo de pedido), carrito y checkout con aviso si la sucursal no recibe pedidos; refetch en
`nextTransitionAt` (tope 10 min) + foco. `ApiError` ahora conserva `code` y `violations` de `ErrorResponse`.

**Decisiones de la web** (no contradicen la spec): `PUT` valida primero forma (400), luego negocio (422) y por último versión
(409); ids de cierres del mock no son UUID; las sucursales inactivas no consultan disponibilidad (404 público): el backoffice
muestra «Inactiva»; el mock sustituye `isOpen`/`openNow` por el motor (`branch-closed` = cierre en curso).

**MOCK_ONLY / pendiente**: `StoreConfig.weeklyHours`/`openingHours` (borrador, F17); reglas de programación de pedidos
(F19/F20) que usan el horario real; pausa operativa y «último pedido» (bloqueados por negocio); permisos: la UI usa
`can(grants, 'branches.manage_hours', branchId)` y hoy solo `admin` lo tiene (decisión de negocio sobre `manager` abierta).

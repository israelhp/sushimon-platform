# F12 — Grupos y opciones modificadoras

**Rama**: `feature/F12-product-modifiers` (desde `develop` cc4ac10)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F11 (productos), F10, F00, F03 (RBAC/seguridad admin) · **Integración posterior**: F13 (disponibilidad por sucursal, si aplica a opciones), F18 (carrito), F19 (cotización: valida y calcula), F20 (pedidos: snapshot en `order_item_modifiers`)
**Decisiones**: `docs/adr/0018-modificadores-de-producto.md`
**Estado global**: `IN_PROGRESS` (partida). Contrato `CONTRACT_DEFINED`; API/BD/web se implementan en la misma rama y se reportan por componente.

## Alcance

Gestionar grupos de modificadores (extras) con mínimo y máximo de selección, sus opciones con precio extra, asociarlos a productos en un orden, mostrarlos en la ficha pública
(`GET /v1/store/products/{slug}`) y ofrecer un **validador reutilizable** de selecciones (servicio, sin endpoint) que F19/F20 consumirán. Fuera: carrito (F18), cotización y subtotal
definitivo (F19), pedidos y snapshots (F20), precio/disponibilidad por sucursal (F13), cantidad por opción, borrado físico, textos por idioma, promociones (F15).

## Estados por componente

| Componente                                                                            | Estado                | Nota                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (9 operaciones nuevas + `modifierGroups` en la ficha) + tipos        | `CONTRACT_DEFINED`    | `pnpm contracts:check` en rojo hasta implementar la API (patrón F08–F11)                    |
| Migración (`modifier_groups`, `modifiers`, `product_modifier_groups`) + Prisma        | propuesta             | Sin aplicar a bases reales; requiere aprobación humana. Numerar tras la última de `develop` |
| API `src/modifiers/` (admin + `ModifierSelectionService`) y ficha pública enriquecida | pendiente             | `CONTRACT_DEFINED` → `API_IMPLEMENTED`                                                      |
| Web: selector en la ficha, pantalla admin de grupos/opciones, sección en el producto  | pendiente             | Mock hasta integrar. El selector no calcula totales definitivos                             |
| Carrito/cotización/pedidos con extras                                                 | pendiente             | F18 / F19 / F20. El validador queda listo pero SIN consumidores en F12                      |
| Disponibilidad por sucursal de opciones                                               | pendiente (si aplica) | F13 decide si `branch_products` cubre opciones; F12 las trata como globales                 |

## Hechos verificados del repo

- DBML (`docs/references/monsushi_dbdiagram.dbml:176-196`): `modifier_groups (id, name, min_select smallint default 0, max_select smallint default 1)`, `modifiers (id, group_id, name, extra_price numeric(12,2) default 0)`,
  `product_modifier_groups (product_id, group_id, pk compuesta)`; refs `modifiers.group_id > modifier_groups.id`, `product_modifier_groups.* > products/modifier_groups` (líneas 470-472);
  `order_item_modifiers (id, order_item_id, modifier_id null, modifier_name, quantity default 1, unit_extra_price)` con `modifier_id` `ON DELETE SET NULL` (líneas 291-298, 485-486; F20).
- El prototipo (`docs/ui/prototype-inventory.md:37`) **no tiene modificadores** (corregido en Etapa 1): la UI se deriva del DBML, no de un bundle.
- Permisos existentes (ADR-0010): `catalog.read`, `catalog.create`, `catalog.update` (rol «products.edit»). No se crean permisos.
- La web (F11) mantiene extras simulados (`SimulatedProductExtras`, `sushimon-web/src/features/catalog/catalog-product.ts`); los modificadores siguen simulados hasta integrar.
- Filtro de errores: `code` se propaga solo con `status < 500`; los 5xx con `code` van en lista blanca (`MODIFIERS_BUSY` se añade).

## Criterios de aceptación del backlog

| Criterio                         | Cómo se cumple                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `min <= max`, límites coherentes | `CHECK` de BD + 422 `MODIFIER_LIMITS_INVALID`; grupo activo con `min` > opciones activas es inalcanzable y se rechaza (D3)                                       |
| Selección válida                 | `ModifierSelectionService.validate` (D9): `MODIFIER_REQUIRED/TOO_MANY/NOT_IN_GROUP/GROUP_NOT_ON_PRODUCT/INACTIVE/DUPLICATED` => 422 `MODIFIER_SELECTION_INVALID` |
| Subtotal incluye extras          | El validador devuelve `extraTotal` exacto (céntimos) por unidad; el subtotal DEFINITIVO lo fija F19 (no se confía en el cliente)                                 |
| No selecciones fuera de min/max  | Validador (D9); la UI lo refleja pero el servidor decide                                                                                                         |
| Snapshot de extras en pedido     | Contrato futuro F20 (D10): copia `name` y `extra_price` en `order_item_modifiers`; F12 no crea pedidos (no verificable aquí)                                     |
| Cantidades inválidas             | No existe cantidad por opción: se elige 0 o 1 vez; repetir un id => `MODIFIER_DUPLICATED`. Cantidad por opción = extensión futura F18/F20 (D2)                   |
| UI coherente                     | Selector radio (`maxSelect = 1`) o casillas con tope; panel admin con errores por `code`                                                                         |

## Decisiones (resumen; razones en ADR-0018)

- **D1 Modelo**: DBML + evolución mínima. `modifier_groups` (+ `active`, `created_at`, `updated_at`; `name` 1–80, único sin distinguir mayúsculas; `CHECK 0 ≤ min_select ≤ max_select`, `max_select` 1–20),
  `modifiers` (+ `active`, `sort_order`, `created_at`, `updated_at`; `extra_price` `CHECK 0 ≤ x ≤ 9999.99`; nombre único dentro del grupo sin distinguir mayúsculas; máx. 30 opciones por grupo),
  `product_modifier_groups` (+ `sort_order`; máx. 10 grupos por producto). `required` es **derivado** (`min_select ≥ 1`), no almacenado. FK `modifiers.group_id` y `product_modifier_groups.group_id` `ON DELETE RESTRICT`;
  `product_modifier_groups.product_id` `ON DELETE CASCADE`.
- **D2 Sin cantidad por opción**: cada opción se elige 0 o 1 vez (el DBML lo permite en `order_item_modifiers.quantity` pero no hay `max_quantity` en el catálogo). `quantity` queda en 1 al snapshotear. Extensión futura (F18/F20).
- **D3 Invariante de satisfacibilidad**: un grupo ACTIVO debe tener ≥ `min_select` opciones activas. Se hace cumplir en cada escritura bajo bloqueo del grupo:
  crear/editar grupo y reactivar => 422 `MODIFIER_LIMITS_INVALID`; desactivar una opción (o subir `min`) que lo rompería => 422 `MODIFIER_GROUP_UNSATISFIABLE` (en `PATCH /modifiers/{id}`; en el grupo por límites es `LIMITS_INVALID`).
  Desactivar un grupo siempre es posible. Un grupo inactivo no tiene restricción (se puede preparar y activar al final).
- **D4 Sin borrado físico**: no hay DELETE de grupos ni opciones (solo `active=false`): `order_item_modifiers.modifier_id` (F20) las referencia con snapshot. Única eliminación: la fila de asociación producto–grupo, mediante el PUT que reemplaza la lista.
- **D5 Precio**: `extraPrice` cadena decimal `^[0-9]{1,4}\.[0-9]{2}$` (`"0.00"` permitido), nunca `number`; aritmética decimal exacta (céntimos enteros). Forma/rango inválido => 400.
- **D6 Administración**: `@RequireStaff()` (aal2), `no-store`. Lectura `catalog.read` (cualquier alcance); POST `catalog.create`; PATCH/PUT `catalog.update`; las escrituras exigen alcance GLOBAL (catálogo global) => si no, 403.
  PATCH parcial; campos desconocidos y cuerpo vacío => 400; sin cambios => 200 sin escribir ni auditar. Lista de grupos paginada (`pageSize` ≤ 100) con resumen y conteos agregados en una consulta (sin N+1); detalle con opciones.
  Creación de grupo admite `options[]` para crear un grupo obligatorio ya satisfecho.
- **D7 Concurrencia sin lock global**: cada escritura toma `SELECT … FOR NO KEY UPDATE` sobre la fila del **grupo** (crear/editar/reordenar opciones; `PATCH /modifiers/{id}` lee la opción, bloquea su grupo y relee) o del **producto** (PUT de asociación; los grupos se leen
  ordenados por `id` para evitar interbloqueos). Los topes (30 opciones, 10 grupos) se cuentan bajo ese bloqueo y, como respaldo, con triggers de BD. `P2028`/`55P03`/timeout => 503 `MODIFIERS_BUSY` (reintentable, mensaje fijo).
  Unicidad de nombres: índices únicos; `23505`/`P2002` se traducen por **target** (target desconocido => 500 genérico).
- **D8 Asociación producto–grupo**: `PUT /v1/admin/products/{id}/modifier-groups` con `{groupIds}` (≤ 10, ordenado, sin duplicados) reemplaza la lista en una transacción (insert de nuevos, `sort_order`, delete de ausentes). Cada grupo **nuevo** debe existir y estar activo
  (422 `MODIFIER_GROUP_INVALID`; también duplicados). Un grupo ya asociado que luego se desactivó puede permanecer (así reordenar o editar otros no obliga a quitarlo). Responde 200 con el estado resultante; igual al anterior => 200 sin escribir ni auditar.
- **D9 Público y validador comparten una sola definición de «ofrecible»**: grupo activo asociado con ≥ `max(min_select, 1)` opciones activas. La ficha pública incluye `modifierGroups[]` (solo ofrecibles, solo opciones activas, orden de asociación y de `sort_order`;
  `id, name, minSelect, maxSelect, required, options[{id,name,extraPrice}]`). Por D3 un grupo activo insatisfacible no debería existir; si aparece (carrera o dato manual) el producto **sigue visible** y ese grupo se **omite** con `warn` en logs
  (id de grupo y de producto, sin PII); nunca se rechaza la ficha. NO se agrega a la lista pública (evita tamaño y N+1). La ficha usa una consulta adicional por producto (grupos+opciones en un solo JOIN). Caché pública sin cambios (60 s + SWR 300 s): un precio extra
  cambiado puede verse hasta ~6 min; no es problema porque el precio es informativo y F19 recalcula.
- **D10 `ModifierSelectionService.validate(productId, selections)`** (exportado por `ModifiersModule`; **sin endpoint** en F12). Entrada `selections: {groupId, modifierIds[]}[]`. Una consulta (grupos asociados + opciones del producto; sin N+1) y validación en memoria.
  Salida `{ ok: true, extraTotal, items[{groupId, modifierId, name, extraPrice}] }` con `extraTotal` cadena decimal por UNIDAD de producto (suma exacta en céntimos; la multiplicación por cantidad es de F19), o lanza 422 `MODIFIER_SELECTION_INVALID` con
  `violations[{path, code, message}]` (todas las violaciones, no solo la primera). Códigos y `path`:
  - `MODIFIER_REQUIRED`: grupo ofrecible con `min ≥ 1` y menos de `min` opciones elegidas (o ausente); `path` `selections[i]` o `groups/<groupId>` si falta.
  - `MODIFIER_TOO_MANY`: más de `max` opciones en un grupo; `path` `selections[i].modifierIds`.
  - `MODIFIER_NOT_IN_GROUP`: el id de opción no pertenece al grupo o no existe; `path` `selections[i].modifierIds[j]`.
  - `MODIFIER_GROUP_NOT_ON_PRODUCT`: el grupo no está asociado al producto o no es ofrecible (D9); `path` `selections[i].groupId`.
  - `MODIFIER_INACTIVE`: opción o grupo asociado inactivo; `path` `selections[i]…`.
  - `MODIFIER_DUPLICATED`: `groupId` repetido en `selections` o `modifierId` repetido en un grupo.
    Producto inexistente => lanza 404 `PRODUCT_NOT_FOUND`. **NO valida la visibilidad del producto** (activo, categoría visible): F19 DEBE verificarla con `ProductsQueryService` antes de cotizar. Guardas defensivas de forma, antes de consultar la BD: `selections`/`modifierIds` que no sean arreglos de la forma esperada, más de 10 selecciones o más de 20 ids por selección => 422 `MODIFIER_SELECTION_INVALID` (violación `path` + code `MODIFIER_SELECTION_INVALID`, nunca TypeError); `violations` se corta en 50. Selección vacía es válida si ningún grupo ofrecible es obligatorio. El cliente nunca aporta nombres ni precios: salen de la BD.
- **Condición para F19 (M4)**: la cotización NUNCA acepta precios ni nombres del cliente; calcula todo desde `items`/`extraTotal` del validador y, ante un 422, devuelve el precio vigente (por ejemplo, las opciones y precios actuales) para que la UI se refresque. Los precios de la ficha cacheada son solo informativos.
- **D11 Contrato futuro de snapshot (NO implementado)**: F20 copiará `items[]` del validador a `order_item_modifiers` (`modifier_id`, `modifier_name = name`, `unit_extra_price = extraPrice`, `quantity = 1`) en la misma transacción que el `order_item`; el precio del renglón
  incluye `extraTotal`. Editar o desactivar luego una opción no altera pedidos. F19 invocará el validador en cada cotización/checkout y rechazará con 422 reutilizando estas violaciones.
- **D12 Auditoría** (misma transacción, sin PII): `modifier_group.created|updated|activated|deactivated`, `modifier.created|updated|activated|deactivated|reordered`, `product.modifier_groups_replaced` (ids antes/después). Sin cambios => no se audita.
- **D13 Módulos**: `src/modifiers/` (`ModifiersModule`, `AdminModifiersController`, `AdminModifiersService`, `ModifierSelectionService`, `ModifiersQueryService` para la ficha, repositorio, políticas de límites/precio). Dependencia `products → modifiers` (la ficha pública llama a
  `ModifiersQueryService`) o composición en el módulo de productos sin ciclos; `ModifiersModule` no importa `ProductsModule` (la validación del producto se hace por consulta SQL propia). Web: `features/catalog` (selector) y `features/backoffice/modifiers`.

## Modelo de datos (propuesta para `database-engineer`)

```
app.modifier_groups (id uuid pk default gen_random_uuid(), name text not null, min_select smallint not null default 0, max_select smallint not null default 1,
  active boolean not null default true, created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  CHECK char_length(name) BETWEEN 1 AND 80, CHECK min_select >= 0 AND max_select >= 1 AND max_select <= 20 AND min_select <= max_select)
UNIQUE INDEX modifier_groups_name_lower_key ON (lower(name))
app.modifiers (id uuid pk, group_id uuid not null REFERENCES app.modifier_groups(id) ON DELETE RESTRICT ON UPDATE CASCADE, name text not null,
  extra_price numeric(12,2) not null default 0, active boolean not null default true, sort_order integer not null default 0,
  created_at, updated_at, CHECK char_length(name) BETWEEN 1 AND 80, CHECK extra_price >= 0 AND extra_price <= 9999.99, CHECK sort_order >= 0)
UNIQUE (group_id, lower(name)); UNIQUE (group_id, sort_order) DEFERRABLE; INDEX (group_id, active, sort_order); trigger de tope 30 por grupo
app.product_modifier_groups (product_id uuid not null REFERENCES app.products(id) ON DELETE CASCADE, group_id uuid not null REFERENCES app.modifier_groups(id) ON DELETE RESTRICT,
  sort_order integer not null default 0, PRIMARY KEY (product_id, group_id), CHECK sort_order >= 0)
UNIQUE (product_id, sort_order) DEFERRABLE; INDEX (group_id); trigger de tope 10 por producto
```

RLS: `ENABLE ROW LEVEL SECURITY` sin políticas + `REVOKE` como 0006/0007/0011/0012. El DBML de `docs/references` no se edita. `order_item_modifiers` se crea en F20 (no aquí). Procedimiento: la migración la numera `database-engineer` tras la última de `develop`.

## Errores

| HTTP | `code`                         | Cuándo                                                                                                                                                                 |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación)                   | Forma/UUID inválidos, precio fuera de forma o > 9999.99 (5+ enteros), tipos no enteros, cuerpo vacío, desconocidos, `q` > 80, > 30 en `orderedIds`, > 50 en `groupIds` |
| 401  | —                              | Sin JWT válido                                                                                                                                                         |
| 403  | —                              | No es personal activo, falta permiso, no aal2, o alcance no global en escritura                                                                                        |
| 404  | `MODIFIER_GROUP_NOT_FOUND`     | Grupo inexistente (detalle, PATCH, crear opción, reordenar)                                                                                                            |
| 404  | `MODIFIER_NOT_FOUND`           | Opción inexistente (PATCH)                                                                                                                                             |
| 404  | `PRODUCT_NOT_FOUND`            | Producto inexistente (GET modifiers, PUT modifier-groups, validador)                                                                                                   |
| 409  | `MODIFIER_GROUP_NAME_TAKEN`    | Nombre de grupo repetido (sin distinguir mayúsculas)                                                                                                                   |
| 409  | `MODIFIER_NAME_TAKEN`          | Nombre de opción repetido en el grupo                                                                                                                                  |
| 422  | `MODIFIER_LIMITS_INVALID`      | `min > max`, `max < 1`, `max > 20`, `min < 0`, o grupo activo con `min` > opciones activas (inalcanzable)                                                              |
| 422  | `MODIFIER_GROUP_UNSATISFIABLE` | Desactivar una opción dejaría un grupo activo con menos opciones activas que `min`                                                                                     |
| 422  | `MODIFIER_LIMIT_REACHED`       | > 30 opciones por grupo (crear, `options[]`) o > 10 grupos por producto                                                                                                |
| 422  | `MODIFIER_REORDER_MISMATCH`    | `orderedIds` no es exactamente el conjunto de opciones del grupo                                                                                                       |
| 422  | `MODIFIER_GROUP_INVALID`       | `groupIds` con duplicados, inexistentes o inactivos recién añadidos                                                                                                    |
| 422  | `MODIFIER_SELECTION_INVALID`   | Solo del validador (servicio, F19/F20): con `violations` (D10); no figura en el OpenAPI de F12                                                                         |
| 503  | `MODIFIERS_BUSY`               | Bloqueo no disponible / timeout de la transacción; reintentable                                                                                                        |

## Contrato (resumen)

Tag `modifiers`. Operaciones: `listAdminModifierGroups` (GET `/v1/admin/modifier-groups`) · `createAdminModifierGroup` (POST) · `getAdminModifierGroup` (GET `/{id}`) · `updateAdminModifierGroup` (PATCH `/{id}`) ·
`createAdminModifier` (POST `/{id}/modifiers`) · `reorderAdminModifiers` (PUT `/{id}/modifiers/reorder`) · `updateAdminModifier` (PATCH `/v1/admin/modifiers/{id}`) · `getAdminProductModifiers` (GET `/v1/admin/products/{id}/modifiers`) ·
`replaceAdminProductModifierGroups` (PUT `/v1/admin/products/{id}/modifier-groups`). Modificada: `getStoreProduct` (`PublicProductDetail.modifierGroups`, requerido). Esquemas: `ModifierExtraPrice`, `PublicModifierOption`,
`PublicModifierGroup`, `AdminModifier`, `AdminModifierList`, `AdminModifierGroupSummary`, `AdminModifierGroup`, `AdminModifierGroupPage`, `AdminProductModifiers`, `ModifierOptionInput`, `CreateModifierGroupRequest`,
`UpdateModifierGroupRequest`, `CreateModifierRequest`, `UpdateModifierRequest`, `ReorderModifiersRequest`, `ReplaceProductModifierGroupsRequest`; parámetros `ModifierGroupId`, `ModifierId`. `contracts:check` exige que la API declare exactamente los códigos
documentados por operación (códigos HTTP; los `code` de negocio se documentan en las descripciones y en `ErrorResponse.code`).

## Pruebas exigidas

Servicio: límites (min/max, 0..20, relación, inalcanzable al crear/activar), D3 (desactivar opción/subir min/reactivar), nombres únicos case-insensitive (grupo y opción) incl. carrera por target, topes 30/10, precio decimal (formas, 0.00, 9999.99/10000.00, sin `Number`),
reordenar (exacto, duplicado, ajeno, idempotente), PUT de asociación (orden, nuevos inactivos/inexistentes/duplicados, grupo ya asociado desactivado permitido, vaciar, sin cambios no audita), sin borrado físico (no hay ruta), sin N+1 (consultas acotadas).
Ficha pública: solo grupos ofrecibles/opciones activas/orden, grupo insatisfacible omitido con log y producto visible, lista pública sin `modifierGroups`. Validador: matriz completa de violaciones (cada código, varias a la vez, `path`), `extraTotal` exacto
(0.10+0.20 = 0.30; sumas grandes), ids ajenos/otro producto, una sola consulta. Autorización: 401, 403 (no staff/sin aal2/sin permiso/alcance de sucursal en escrituras; lectura OK), público sin auth. Auditoría: una fila por operación real. Contrato: `contracts:check`.
Web: selector (radio vs. casillas, tope `max`, requisito `min`, extras informativos), admin crea/edita/activa/reordena/asocia y mapea cada `code` (nunca por `message`). BD (base real, pendiente de aprobación): CHECK, UNIQUE, RESTRICT, triggers de tope.

## Tareas por dueño

1. `database-engineer`: migración (3 tablas + índices + triggers de tope + RLS) y Prisma; sin tocar `order_item_modifiers`.
2. `api-engineer`: módulo `modifiers`, controlador/servicio admin, `ModifiersQueryService`, enriquecer la ficha, `ModifierSelectionService`, whitelist `MODIFIERS_BUSY`, auditoría, pruebas; `contracts:check` verde.
3. `web-engineer`: selector en ficha (reemplaza extras simulados en el flujo de la ficha), pantalla admin de grupos/opciones, sección «Extras» en el editor de producto, errores por `code`; mocks alineados al contrato.
4. `security-reviewer` / `qa-engineer`: alcance global en escrituras, confianza cero en cliente (validador), concurrencia (locks/topes), matriz de pruebas.

## Preguntas abiertas y asunciones

- **Asunción**: «obligatorio al asociar activo» se aplica a los grupos NUEVOS de la lista; uno ya asociado y luego desactivado puede permanecer (D8). Alternativa estricta (rechazar siempre) obligaría a quitarlo antes de reordenar.
- **Asunción**: lista de grupos paginada (no «completa») para respetar el patrón de F10/F11; el editor usa `pageSize=100`. Más de 100 grupos requeriría filtro `q` (aceptable para 3–5 sucursales).
- **Asunción**: nombre único case-insensitive solo por `lower()` (sin normalizar acentos), como `categories`/`products`.
- **Pendiente F13**: si negocio quiere opciones agotadas por sucursal, F13 añadirá su tabla/semántica; el validador recibirá `branchId` entonces. F12 no reserva campos.
- **Pendiente F18/F20**: cantidad por opción y snapshot (`order_item_modifiers.quantity` = 1 mientras tanto).
- **Orden de despliegue (A1)**: la migración 0013 debe aplicarse ANTES de desplegar la API de F12. `getStoreProduct` consulta `app.modifier_groups` y NO captura el error de modificadores (no se oculta un fallo de BD como «sin extras»): sin la 0013 la ficha pública responde 500. `/v1/health/ready` no se toca. Ver `docs/database/README.md`.
- **Errores de BD (revisión de seguridad)**: `23505`/`P2002` se traduce por operación aunque el driver no informe la restricción (grupo => `MODIFIER_GROUP_NAME_TAKEN`, opción => `MODIFIER_NAME_TAKEN`); `40P01`, `40001` y cualquier violación (también diferida) de `*_sort_key` => 503 `MODIFIERS_BUSY`; las transacciones de escritura fijan `isolationLevel: ReadCommitted`. Los nombres eliminan además caracteres Unicode de formato (categoría Cf: U+200B, U+202E, …).
- El 422 `MODIFIER_SELECTION_INVALID` no figura en OpenAPI de F12 (sin endpoint); lo documentará F19 al exponer cotización.
- Cambiar `minSelect` en un grupo ya usado no afecta pedidos existentes (snapshot) pero sí carritos abiertos: F19 revalida siempre.

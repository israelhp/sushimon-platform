# ADR-0018 Modificadores de producto: grupos globales con límites, opciones 0/1, sin borrado físico y validador servidor

**Estado**: **propuesta** (2026-11-15, F12). Se acepta al fusionar `specs/013-product-modifiers`.

**Contexto**: el DBML define `app.modifier_groups`, `app.modifiers`, `app.product_modifier_groups` y (F20) `app.order_item_modifiers`. F11 dejó productos globales (ADR-0017). F12 ofrece la gestión de extras y la
validación de selecciones, sin invadir F13 (disponibilidad por sucursal), F18 (carrito), F19 (cotización) ni F20 (pedidos).

## Decisión

1. **Modelo = DBML + evolución mínima** (migración posterior a la última de `develop`). Desviaciones del DBML, todas justificadas: `modifier_groups` +`active`, `created_at`, `updated_at` (desactivar sin borrar; auditoría), `name` 1–80 único con `lower(name)`,
   `CHECK 0 ≤ min_select ≤ max_select`, `max_select` 1–20 (una regla de integridad que el DBML no expresa); `modifiers` +`active`, `sort_order`, `created_at`, `updated_at`, `extra_price` `CHECK 0..9999.99`, nombre único por grupo, máx. 30;
   `product_modifier_groups` +`sort_order` (orden de presentación), máx. 10 por producto. FK: `RESTRICT` hacia grupos y opciones, `CASCADE` desde el producto en la asociación. RLS sin políticas + `REVOKE` (patrón 0006–0012). El DBML de `docs/references` no se edita.
2. **«Obligatorio» derivado**: `required = min_select ≥ 1` en la API; no se almacena (evita contradicciones con `min_select`).
3. **Opciones 0/1, sin cantidad**: ni el DBML del catálogo ni el prototipo contemplan `max_quantity`. Se elige cada opción 0 o 1 vez; repetir => `MODIFIER_DUPLICATED`. `order_item_modifiers.quantity` valdrá 1. Cantidad por opción queda como extensión futura (F18/F20) que exigiría columna y ADR.
4. **Sin borrado físico** de grupos ni opciones: solo `active=false`, porque F20 referencia opciones desde `order_item_modifiers` (snapshot de nombre y precio; `modifier_id` `SET NULL` por DBML) y un borrado rompería la trazabilidad. Única eliminación: la fila de asociación
   producto–grupo, mediante el PUT que reemplaza la lista (la asociación no tiene histórico).
5. **Invariante de satisfacibilidad**: un grupo activo mantiene ≥ `min_select` opciones activas; se hace cumplir en la API bajo bloqueo (`MODIFIER_LIMITS_INVALID` al crear/editar/reactivar; `MODIFIER_GROUP_UNSATISFIABLE` al desactivar una opción). Así la tienda nunca ofrece un grupo imposible
   de completar. Defensa en profundidad: el público y el validador omiten/ignoran grupos no ofrecibles (activo con ≥ `max(min,1)` opciones activas), con `warn` en logs, **sin ocultar el producto** (ocultar el producto por un dato de extras sería desproporcionado y bloquearía ventas).
   Alternativa descartada: trigger de BD para la invariante (lógica entre tablas con locks implícitos difíciles de traducir a errores de negocio; la API ya serializa por grupo).
6. **Concurrencia sin lock global**: `FOR NO KEY UPDATE` sobre la fila del grupo (o del producto en el PUT de asociación), grupos leídos ordenados por `id`; no hay invariante global como la de ciclos de F10, por lo que no se usa advisory lock. Topes (30/10) se cuentan bajo el bloqueo y tienen trigger de respaldo.
   `P2028`/`55P03`/timeout => 503 `MODIFIERS_BUSY` (reintentable). Unicidad por índices únicos con traducción por target.
7. **Precio extra como cadena decimal** `"0.00"`–`"9999.99"` (patrón de ADR-0017), nunca `number`; el cálculo usa céntimos enteros. Los precios extra de la ficha son **informativos**: el servidor recalcula y valida (F19) y nunca confía en importes del cliente.
8. **Ficha pública enriquecida, lista no**: `PublicProductDetail.modifierGroups` (solo ofrecibles y opciones activas). La lista pública no los incluye (tamaño y N+1; el selector solo se necesita en la ficha). Misma política de caché (60 s + SWR 300 s).
9. **Validador reutilizable** `ModifierSelectionService.validate(productId, selections)` exportado, sin endpoint en F12: una consulta, validación en memoria, devuelve `extraTotal` y `items` canónicos (nombre y precio desde BD) o 422 `MODIFIER_SELECTION_INVALID` con `violations` (`MODIFIER_REQUIRED|TOO_MANY|NOT_IN_GROUP|GROUP_NOT_ON_PRODUCT|INACTIVE|DUPLICATED`).
   F19 lo invocará en cada cotización y F20 copiará `items` a `order_item_modifiers`. Exponerlo ahora como endpoint sería inventar un flujo de cotización que pertenece a F19.
10. **Autorización** sin permisos nuevos: lectura `catalog.read`, POST `catalog.create`, PATCH/PUT `catalog.update`, escrituras con alcance global y aal2. Auditoría en la misma transacción; sin cambios no se audita.
11. **Errores** estables con `code` (ver spec): `MODIFIER_GROUP_NOT_FOUND`, `MODIFIER_NOT_FOUND`, `MODIFIER_GROUP_NAME_TAKEN`, `MODIFIER_NAME_TAKEN`, `MODIFIER_LIMITS_INVALID`, `MODIFIER_GROUP_UNSATISFIABLE`, `MODIFIER_LIMIT_REACHED`, `MODIFIER_REORDER_MISMATCH`, `MODIFIER_GROUP_INVALID`, `MODIFIERS_BUSY` (503).

## Desviaciones de BD respecto a la propuesta (migración 0013, reportadas por database-engineer)

- **Sin índice `(group_id, sort_order, name, id)`**: como `UNIQUE (group_id, sort_order)` ya existe, `name, id` nunca desempata y la propia restricción sirve `WHERE group_id = $1 ORDER BY sort_order` (y el FK). Un índice extra sería redundante.
- **`UNIQUE (…, sort_order)` `DEFERRABLE INITIALLY DEFERRED`** en `modifiers` y `product_modifier_groups` (como `product_media`, 0012): el choque se evalúa al COMMIT, de modo que reordenar reasigna `sort_order` 0..n-1 en una sola transacción. Consecuencia: **no se usa upsert/`ON CONFLICT`** (no puede arbitrarse con estas restricciones); al reemplazar listas se borra antes de insertar.
- **Nombres únicos por expresión** `lower(btrim(name))` (grupo) y `(group_id, lower(btrim(name)))` (opción): Prisma no expresa índices sobre expresiones, así que la API captura `23505`/`P2002` y traduce por constraint (`modifier_groups_name_lower_key` => `MODIFIER_GROUP_NAME_TAKEN`; `modifiers_group_name_lower_key` => `MODIFIER_NAME_TAKEN`; objetivo desconocido => 500 genérico). Antes de escribir, el servicio comprueba duplicados bajo el bloqueo del grupo.
- **Triggers de tope (30 opciones/grupo, 10 grupos/producto)** dependen de **READ COMMITTED** y de **borrar antes de insertar** en la misma transacción; el trigger toma `FOR NO KEY UPDATE` sobre la fila padre y cuenta después. ERRCODE `23514` con mensajes `modifier_group_max_options` / `product_max_modifier_groups` => 422 `MODIFIER_LIMIT_REACHED`. El servicio cuenta primero (respaldo en BD).
- **`updated_at` lo mantiene la API** en cada UPDATE (sin trigger), igual que 0007/0011/0012.

## Implementación de la API (F12)

`src/modifiers/`: `ModifiersModule` (importa solo `AuditModule`; `ProductsModule` importa `ModifiersModule`, sin ciclos) exporta `ModifiersQueryService` (ficha pública: una consulta producto→grupos→opciones) y `ModifierSelectionService`. Cada escritura es una transacción
`$transaction(fn, { timeout: 15000, maxWait: 5000 })` con `SET LOCAL lock_timeout = '3s'` y `FOR NO KEY UPDATE` sobre el grupo (o el producto) antes de validar; `P2028`/`55P03` => 503 `MODIFIERS_BUSY` (en la lista blanca de códigos 5xx públicos).
Criterio del validador para un grupo asociado **inactivo** que se selecciona: `MODIFIER_INACTIVE`; grupo activo pero no ofrecible: `MODIFIER_GROUP_NOT_ON_PRODUCT`.

## Endurecimiento tras la revisión de seguridad

- **Unicidad por operación (M1)**: `23505`/`P2002` se traduce según la operación (grupo => `MODIFIER_GROUP_NAME_TAKEN`, opción => `MODIFIER_NAME_TAKEN`) aunque el driver no informe el índice; se prueba con altas/renombres concurrentes (un éxito y un 409, nunca 500).
- **Reintentables (B1/B3)**: `40P01`, `40001` y `*_sort_key` (incluida la violación diferida al COMMIT) => 503 `MODIFIERS_BUSY`. **B2**: las transacciones de escritura fijan `isolationLevel: ReadCommitted` (los triggers de tope lo requieren).
- **Validador (M2/M3/M4)**: `ModifierSelectionService` NO comprueba la visibilidad del producto (solo que exista): F19 debe verificarla con `ProductsQueryService`. La cotización de F19 nunca acepta precios del cliente y devuelve el precio vigente en el 422 para refrescar la UI. Guardas defensivas: entradas que no sean arreglos, > 10 selecciones o > 20 ids por selección => 422 `MODIFIER_SELECTION_INVALID`; `violations` ≤ 50.
- **Despliegue (A1)**: aplicar la 0013 ANTES de desplegar la API; la ficha pública no captura el error de extras (un fallo de BD no se disfraza de «sin extras»).
- **Nombres (B5/B7)**: se eliminan caracteres Unicode de formato (Cf) en grupos y opciones. B7: los nombres (≤ 80, sin PII) se guardan en la auditoría y en los logs de forma deliberada; no se enmascaran.

## Consecuencias

- Los grupos son **globales** (compartibles entre productos); modificar un grupo cambia todos sus productos. Para variantes por producto se crea otro grupo.
- Un precio extra cambiado puede verse desactualizado hasta ~6 min en la ficha cacheada; el servidor recalcula, por lo que el cliente debe aceptar el total devuelto por F19.
- Los carritos abiertos pueden quedar inválidos tras cambios de `min/max` o desactivaciones: F19 revalida y devuelve violaciones.
- F13 podrá añadir disponibilidad por sucursal de opciones sin migrar datos de F12; el validador ganará `branchId` entonces.
- Hasta F18–F20 los extras no llegan a pedidos reales: la web seguirá con carrito mock y el validador no tiene consumidores.
- Sin cantidad por opción: «doble porción» se modela como otra opción.

## Alternativas descartadas

Almacenar `required`; borrado físico/cascada de opciones; cantidad por opción; asociar modificadores por categoría; grupos por producto (no compartibles); trigger de BD para la invariante; endpoint público de validación en F12; incluir modificadores en la lista pública;
advisory lock global; ocultar el producto cuando un grupo es insatisfacible.

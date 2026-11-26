# ADR-0034 Borrado de categorías (solo si no están en uso)

**Estado**: **propuesta** (2026-11-26; ampliación de F10 dentro del PR de banners F16). Reemplaza parcialmente ADR-0016 (punto 1, «sin borrado físico»).

**Contexto**: ADR-0016 decidió que las categorías solo se desactivan. El dueño pidió poder ELIMINAR una categoría desde el backoffice (por ejemplo, una creada por error o
una obsoleta que ya no tiene nada colgando). La desactivación se conserva, pero sin borrado la lista admin se llena de categorías muertas (tope 500).
Referencias a `app.categories` verificadas en `schema.prisma` y migraciones 0001–0023: `categories.parent_id` (RESTRICT, 0011), `products.category_id` (RESTRICT, 0012) y
`banners.cta_category_id` (RESTRICT, 0017; la migración 0023 simplifica banners y su CTA, pero la columna residual puede conservar filas). No hay más tablas ni columnas que la
referencien: favoritos (por producto), carrito (cliente, sin persistencia), pedidos y `order_items` (snapshots sin categoría), promociones F15 (alcance por producto/sucursal, sin categoría)
y el DBML solo declara las dos primeras FK.

## Decisión

1. `DELETE /v1/admin/categories/{id}` (`deleteAdminCategory`): `catalog.update` con alcance GLOBAL y `aal2`; **sin permiso nuevo** (el catálogo de permisos no cambia). 204 sin cuerpo, `no-store`.
   Sin `expectedVersion`: las categorías no tienen columna de versión y `PATCH` tampoco la usa.
2. **Borrado físico** y solo si la categoría **no está en uso**: sin subcategorías, sin productos (activos o inactivos) y sin banners residuales que la usen como destino.
3. En uso => 409 `CATEGORY_IN_USE` con `usage {children, products, banners}` (esquema `CategoryInUseError`, hereda `ErrorResponse`); el mensaje sugiere desactivarla. Nunca se
   borra en cascada ni se reasigna nada.
4. Concurrencia: la API valida y borra bajo el mismo `pg_advisory_xact_lock(1100110)` de `update`/`reorder`. Las FK RESTRICT son la red de seguridad (23503 => 409 `CATEGORY_IN_USE`).
   Inexistente => 404 (mismo cuerpo que PATCH); 503 `CATEGORIES_BUSY` reintentable. No se documenta 429: las escrituras de categorías no declaran límite propio.
5. Auditoría `category.deleted` (old: `id`, `slug`, `name`, `parentId`, `active`), en la misma transacción.
6. Los hermanos conservan su `sortOrder` (puede quedar un hueco; el orden estable `sortOrder, name, id` no se rompe) y no se renumera.
7. Caché pública: sin cambios de mecanismo. `/v1/store/categories` y `/v1/store/menu` (sin `branchId`) usan `max-age=60, stale-while-revalidate=300` (hasta ~6 min); bootstrap y menú
   por sucursal `max-age<=5, s-maxage<=15`. Sin `ETag`; `nextChangeAt` depende de horarios/promociones, no de categorías. Una categoría con productos no se puede borrar, así que no desaparecen platos.

## Consecuencias

- Se pierde el rastro de la fila (queda solo en `audit_events` con los datos mínimos); el slug queda libre y puede reutilizarse (URLs públicas viejas dan 404/vacío).
- La UI debe explicar el 409 con los conteos y ofrecer «Desactivar» como alternativa.
- La API añade un método de repositorio (conteos + delete) y la traducción de 23503; la web, acción «Eliminar» con confirmación en Categorías.
- Si una futura feature referencia categorías (p. ej. promociones por categoría), deberá añadirse su conteo a `usage` y mantener FK RESTRICT.
- Sin migración: las FK ya son RESTRICT.

## Alternativas descartadas

- **Borrado con reasignación de productos**: movería productos a otra categoría sin que nadie lo decida; puede cambiar lo que ve el cliente y rompe la intención de «solo si no está en uso».
- **Borrado en cascada** de hijas y productos: destruye catálogo y deja huecos en pedidos/promos; irreversible.
- **Soft-delete** (`deleted_at`): añade una columna y filtros en todas las consultas y el slug seguiría ocupado; ya existe `active=false` para el caso reversible.

# ADR-0035 Borrado de productos (solo sin historial ni referencias vivas)

**Estado**: **propuesta** (2026-11-26; ampliación de F11 dentro del PR de banners F16). Reemplaza parcialmente ADR-0017 (punto 1, «sin borrado físico»).

**Contexto**: ADR-0017 decidió que los productos solo se desactivan. El dueño pidió poder ELIMINAR un producto desde el backoffice (creado por error, duplicado, descontinuado
sin ventas). La desactivación se conserva. A diferencia de las categorías (ADR-0034), un producto tiene muchas referencias entrantes y el borrado puede dañar historial o
reglas de negocio, así que el diseño se apoya en un inventario verificado.

Referencias a `app.products(id)` verificadas con `grep` en `schema.prisma` y las migraciones 0001–0023 (y en `sushimon-api/src`):

| Tabla.columna                        | Migración | ON DELETE                        | Qué significa                                        | Tratamiento                                                                                                                                                    |
| ------------------------------------ | --------- | -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_items.product_id`             | 0018      | RESTRICT                         | historial de pedidos (el snapshot es la fuente)      | **Bloquea**: cualquier pedido, en cualquier estado => 409 `PRODUCT_IN_USE` (`usage.orders`, pedidos distintos). El historial jamás se rompe ni se anula la FK. |
| `promotion_products.product_id`      | 0016      | RESTRICT                         | alcance `SELECTED` de una promoción                  | **Bloquea** (`usage.promotions`, activas o no). Ausencia de filas = «todos los productos» (ADR-0021): borrar la fila ampliaría la promoción a todo el menú.    |
| `banners.cta_product_id`             | 0017      | RESTRICT                         | destino de banner (residuo; 0023 simplificó banners) | **Bloquea** (`usage.banners`). Reasignar o limpiar el CTA de un banner es decisión editorial, no de este endpoint.                                             |
| `branch_products.product_id`         | 0014      | RESTRICT                         | precio y disponibilidad por sucursal                 | **Se borra en la misma transacción, antes del producto** (configuración propia del producto). Auditado (`branchOffers` en `old`).                              |
| `product_media.product_id`           | 0012      | CASCADE                          | imágenes del producto                                | Cascada. Los assets (`product_media.asset_id`, FK RESTRICT hacia `media_assets`) se liberan best-effort tras confirmar (ver 6).                                |
| `product_modifier_groups.product_id` | 0013      | CASCADE                          | vínculo producto-grupo de modificadores              | Cascada del vínculo; los grupos y opciones NO se borran (son reutilizables).                                                                                   |
| `customer_favorites.product_id`      | 0009/0012 | CASCADE (FK `NOT VALID` en 0012) | favoritos de clientes                                | Cascada; el producto desaparece de los favoritos sin aviso. Impacto bajo y deseado (sin el producto no hay nada que mostrar; hoy ya se ve como `REMOVED`).     |

No hay más referencias: `order_item_modifiers`/`order_promotions` apuntan a modificadores/promociones, el carrito es local (sin tabla) y `audit_events` guarda `entity_id` sin FK.
El DBML solo declara parte de estas FK (`order_items` decía SET NULL; la migración 0018 lo cambió a RESTRICT, ver nota F20).

## Decisión

1. `DELETE /v1/admin/products/{id}` (`deleteAdminProduct`, tag `products`): `catalog.update` con alcance GLOBAL y `aal2`; **sin permiso nuevo**. 204 sin cuerpo, `no-store`.
   Sin `expectedVersion` (`PATCH` tampoco la usa). Borrado **físico** e irreversible.
2. **Solo si no tiene referencias bloqueantes**: sin pedidos (`order_items`), sin promociones en cuyo alcance esté y sin banners residuales. En uso => 409 `PRODUCT_IN_USE`
   con `usage {orders, promotions, banners}` (esquema `ProductInUseError`, hereda `ErrorResponse`; solo conteos, sin ids ni nombres). El mensaje sugiere **desactivar** si hay
   pedidos y «quitarlo de promociones/banners» en los otros casos. Nunca se desvincula ni reasigna nada de promociones/banners, y no se toca ningún pedido.
3. **Qué se borra junto al producto** (misma transacción): primero sus filas de `branch_products` (se cuentan y se auditan), luego el producto; la BD cascadea `product_media`,
   `product_modifier_groups` y `customer_favorites`. Nada más.
4. **Concurrencia**: se toma el mismo bloqueo de fila que `updateAdminProduct` (`lockProduct`, `FOR NO KEY UPDATE`; serializa con PATCH y con alta/orden de medios) y se valida bajo él:
   existe (404) → recuenta (409) → borra `branch_products` → borra producto → audita. El `DELETE` toma además el bloqueo de fila fuerte, que espera a las inserciones de hijos
   concurrentes (una `FK` insert toma `FOR KEY SHARE`). Las FK `ON DELETE RESTRICT` son la red de seguridad: 23503 => se recuenta FUERA de la transacción abortada (como
   `translateCategoryDeleteError`) y se responde 409 `PRODUCT_IN_USE`; si el recuento falla o no encuentra uso (carrera con una fila de `branch_products` nueva), 503 `PRODUCTS_BUSY`
   reintentable. Repetir la llamada => 404 sin efectos. No se documenta 429 (las escrituras de productos no declaran límite propio).
5. **Auditoría** `product.deleted` (old: `id`, `slug`, `sku`, `name`, `categoryId`, `active`, `basePrice`, y `branchOffers` = filas de sucursal retiradas), en la misma transacción.
   El resto de datos (imágenes, vínculos, favoritos) no se vuelca: es derivable o de bajo valor. El slug y el SKU quedan libres para reutilizarse.
6. **Medios**: los assets de imagen del producto se liberan **best-effort** después de confirmar, como en banners (ADR-0033): `AdminMediaService` expone `removeUnusedAsset`
   hoy restringido a `BANNER_IMAGE`; se amplía (p. ej. un parámetro `kind`) para `PRODUCT_IMAGE`. Solo se borra un asset cuyo `usageCount` (producto + banner) sea 0;
   `MEDIA_IN_USE` es esperado (otro producto o banner lo comparte por deduplicación) y se ignora; cualquier otro fallo se registra y deja el asset libre en la biblioteca F14
   (sin referencias colgantes). Las imágenes con URL externa (`asset_id` NULL) no tienen asset que liberar.
7. **Caché pública y carritos**: sin cambio de mecanismo. `GET /v1/store/products`, la ficha por slug y `GET /v1/store/menu` sin `branchId` usan `public, max-age=60,
stale-while-revalidate=300` (el producto puede seguir visible hasta ~6 min); bootstrap, búsqueda y menú por sucursal `max-age<=5, s-maxage<=15`. Sin `ETag`. Un carrito local o
   un checkout abierto con el producto no produce un 500: `POST /v1/checkout/quote` clasifica la línea como `NOT_FOUND` (`classifyLine`: oferta `UNKNOWN`) con `canProceed=false`,
   y `POST /v1/orders` con un token previo recotiza y responde 422 `CHECKOUT_BLOCKED`. (Si el borrado ocurre entre la recotización y la lectura de snapshots, `buildOrder` lanza
   409 `QUOTE_CHANGED`; ambos son errores existentes y limpios.) Los pedidos ya creados conservan su snapshot, pero el producto de la línea ya no es borrable mientras existan.

## Consecuencias

- Un producto que alguna vez se vendió ya no puede borrarse: solo desactivarse (ese es el comportamiento buscado). La UI debe dejar claro el «Desactivar» como alternativa.
- Se pierde la fila del producto; queda solo en `audit_events` con los datos mínimos. URLs públicas por slug viejas dan 404 al expirar la caché.
- Un cliente deja de ver el producto en favoritos sin notificación.
- Un producto cuyo alcance está en una promoción obliga a editar la promoción primero (es intencional: evita que una promoción «solo para X» pase a aplicar a todo).
- La API añade al repositorio de productos: recuento de uso (pedidos distintos, promociones, banners), borrado de `branch_products` y del producto, y la traducción de 23503;
  `AdminMediaService.removeUnusedAsset` se generaliza a `PRODUCT_IMAGE`. La web: acción «Eliminar» con confirmación y explicación del 409; se retira el botón «Sucursales» de la
  tarjeta de producto (cambio solo de web; la API de precio/disponibilidad por sucursal no cambia).
- Sin migración: todas las FK ya existen con la acción adecuada.

## Alternativas descartadas

- **Soft-delete/archivado** (`deleted_at`/estado `ARCHIVED`): ya existe `active=false`; un archivado oculto añadiría una columna, filtros en toda consulta y mantendría slug/SKU ocupados.
  No cumple la petición de «eliminar» y la UI quedaría llena de productos muertos.
- **Cascada total** (cambiar a CASCADE las FK de pedidos, promociones y banners): destruye el historial de ventas y reportes, y amplía alcances de promociones. Inaceptable.
- **Reasignación** (mover pedidos a otro producto, o poner `product_id = NULL` en `order_items`): falsea el historial y contradice la decisión de 0018 (RESTRICT, snapshot informativo).
- **Desvincular de promociones/banners automáticamente**: cambiaría silenciosamente reglas comerciales (una promoción `SELECTED` sin filas pasa a «todos»); se prefiere bloquear con conteo.
- **Borrar o conservar `branch_products`**: conservarlo bloquearía el borrado por una fila que el dueño ni ve como «uso»; se borra por ser configuración del propio producto.

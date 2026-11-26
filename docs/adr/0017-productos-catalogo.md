# ADR-0017 Productos: catálogo global, precio decimal como cadena, imágenes por URL y visibilidad derivada de la categoría

**Estado**: **propuesta** (2026-11-15, F11). Se acepta al fusionar `specs/012-products-catalog`. **Parcialmente reemplazado por ADR-0035** (borrado de productos): lo dicho abajo sobre «sin borrado físico» queda superado; el resto sigue vigente.

**Contexto**: el DBML define `app.products` y `app.product_media`; F10 dejó `CategoriesQueryService` y F06 un puerto `CatalogProductsPort` con adaptador "no disponible"
(ADR-0015). F11 ofrece el catálogo real y administración, sin invadir F12 (modificadores), F13 (precio/disponibilidad por sucursal), F14 (subida de imágenes), F15 (promociones) ni F17 (agregados).

## Decisión

1. **Tablas** `app.products` y `app.product_media` (migración `0012_products`): columnas del DBML + `updated_at`; `slug` único kebab ≤ 80; `sku` opcional único; `name` 1–120; `description` ≤ 2000
   (texto plano); `base_price numeric(12,2)` con `CHECK > 0 AND <= 999999.99`; `category_id` FK `ON DELETE RESTRICT`; media con `ON DELETE CASCADE`, URL https ≤ 2048, máx. 8 por producto; RLS sin
   políticas + `REVOKE`. **Sin borrado físico** (superado por ADR-0035: ahora se puede borrar un producto sin pedidos, promociones ni banners; sigue sin permiso nuevo): se desactiva con `active=false`; la FK `RESTRICT` desde futuros `order_items` protege el histórico y los pedidos guardarán
   snapshots (F20+).
2. **Precio como cadena decimal** (`"85.00"`) en entrada y salida; nunca `number`. Evita errores de coma flotante en dinero; la API opera con aritmética decimal. El precio es el **base global**; el precio
   por sucursal/disponibilidad es de F13 y se añadirá como `branchPrice`/`available` en una lectura por sucursal (no implementado ni reservado).
3. **Visibilidad pública derivada**: producto `active` Y categoría efectivamente visible según F10 (`CategoriesQueryService`). Administrar con categoría inactiva se permite; solo se exige categoría activa al
   crear o mover. Una consulta de visibilidad + un SELECT paginado con join + un SELECT de media por ids (sin N+1). Alternativa descartada: desnormalizar `visible` en productos (se desincroniza al
   desactivar categorías).
4. **Imágenes por referencia**: lista ordenada de URL https que ya existen; PATCH con `media` la reemplaza. F14 aportará subida y reutilizará la tabla. Se rechaza http/data/javascript/relativas (422
   `PRODUCT_MEDIA_INVALID`) para evitar contenido mixto y XSS por esquema; no se descarga ni valida contenido remoto (sin SSRF).
5. **Unicidad sin locks**: slug y SKU los garantizan los índices únicos; la API traduce `23505`/`P2002` por **target** (409 `PRODUCT_SLUG_TAKEN`/`PRODUCT_SKU_TAKEN`; otro target ⇒ 500). No hay advisory lock
   (F10 lo necesitaba por la invariante de ciclos). `503 PRODUCTS_BUSY` solo para el timeout de la transacción de escritura.
6. **Autorización** sin permisos nuevos: lectura `catalog.read` (cualquier alcance), POST `catalog.create`, PATCH `catalog.update`; las escrituras exigen alcance **global** (un producto afecta a todas las
   sucursales) y aal2. Auditoría en la misma transacción (`product.created|updated|activated|deactivated`); sin cambios no se audita.
7. **Lecturas públicas**: lista paginada (≤ 100) con `categorySlug` (incluye descendientes visibles) y `q` (solo nombre y descripción; el SKU solo se busca en admin; `ILIKE` con comodines escapados, ≤ 80); ficha por slug con ancestros de la categoría. `Cache-Control:
public, max-age=60, stale-while-revalidate=300`, sin `ETag`. No se expone `sku`. Sin extensiones trigram/full-text: el catálogo es de cientos de filas.
8. **Puerto de favoritos**: `ProductsModule` exporta `ProductsQueryService`; `FavoritesModule` importa `ProductsModule` y enlaza `CATALOG_PRODUCTS_PORT` a `ProductsCatalogAdapter` (en `src/favorites/`),
   sustituyendo `UnavailableCatalogAdapter`. Solo devuelve productos visibles (`ACTIVE`); fallos de BD ⇒ `CatalogUnavailableError`. Sin dependencia circular y sin cambiar el contrato de favoritos.
9. **FK de favoritos** (anunciada en ADR-0015): `customer_favorites.product_id → products(id) ON DELETE CASCADE` como `NOT VALID`; `VALIDATE` solo si no hay huérfanos, nunca se borran datos; con huérfanos queda
   `NOT VALID` y se documenta el procedimiento (revisar, limpiar con aprobación, validar). El DBML de `docs/references` no se edita.
10. **Errores** estables con `code`: `PRODUCT_NOT_FOUND` (404), `PRODUCT_SLUG_TAKEN`, `PRODUCT_SKU_TAKEN` (409), `PRODUCT_CATEGORY_INVALID`, `PRODUCT_MEDIA_INVALID` (422), `PRODUCTS_BUSY` (503). Los clientes ramifican por `code`.

11. **Host de imágenes**: IP literales, `localhost` y hostnames sin punto se rechazan siempre; `PRODUCT_MEDIA_ALLOWED_HOSTS` (opcional) limita los hosts permitidos. Pendientes: F14 fija el host del CDN/R2 y la web restringe `img-src` por CSP.

## Consecuencias

- Cambiar un slug rompe URLs públicas previas (sin historial). Con la caché pública, un producto desactivado puede seguir visible hasta ~6 minutos (aceptado, como en F10).
- Desactivar una categoría oculta sus productos sin tocarlos; reactivarla los republica.
- Un favorito de un producto oculto se muestra como `REMOVED` (ausente del mapa); si negocio quiere `INACTIVE`, el adaptador puede ampliarse sin cambiar contrato.
- F13/F12/F14/F15/F17 extienden este modelo sin migrar datos de F11; hasta F12/F13 el menú público mostrará modificadores y disponibilidad por sucursal simulados.
- Productos sin imágenes son válidos (la web muestra un placeholder).

## Alternativas descartadas

Precio `number` en JSON; borrado físico con reasignación; flag `visible` desnormalizado; bloqueo advisory global para slug/SKU; trigram/full-text; subida de imágenes en F11; `DELETE` de media por endpoint (reemplazo atómico en PATCH).

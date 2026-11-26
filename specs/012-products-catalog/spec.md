# F11 — Productos y fichas de catálogo

**Rama**: `feature/F11-products` (desde `develop` 113ffd7)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F10 (categorías), F00, F03 (RBAC/seguridad admin) · **Integración posterior**: F12 (modificadores), F13 (precio/disponibilidad por sucursal), F14 (imágenes), F15 (promociones), F17 (agregado de tienda), F06 (favoritos, cierre del puerto)
**Decisiones**: `docs/adr/0017-productos-catalogo.md`
**Estado global**: `IN_PROGRESS` (partida). Contrato `CONTRACT_DEFINED`; API/BD/web se implementan en la misma rama y se reportan por componente.

## Alcance

CRUD de productos (crear, listar, ver, editar, activar/desactivar) con SKU opcional, slug, nombre, descripción, categoría, precio base e imágenes referenciadas (URL
https); lectura pública paginada con búsqueda y filtro por categoría; ficha pública; adaptador real del puerto de catálogo de favoritos. Fuera: modificadores
(F12), precio y disponibilidad por sucursal (F13), subida de archivos (F14: F11 solo guarda y sirve URL https existentes; la web usa un placeholder), promociones
(F15), agregado de tienda (F17), textos por idioma. El borrado físico quedó fuera de F11 y se añadió después (ver «Borrado (ADR-0035)»).

## Borrado (ADR-0035)

Revierte parcialmente la decisión original de «sin borrado físico». `DELETE /v1/admin/products/{id}` (`deleteAdminProduct`): `catalog.update` global + `aal2`, 204 sin cuerpo, borrado físico,
sin `expectedVersion`. Solo si el producto no tiene pedidos (`order_items`, cualquier estado), promociones en cuyo alcance esté ni banners residuales (`banners.cta_product_id`). En uso => 409
`PRODUCT_IN_USE` con `usage {orders, promotions, banners}` (solo conteos); con pedidos la UI sugiere desactivar. Si procede, en una transacción bajo el bloqueo de fila del producto: se
borran sus `branch_products` (precio/disponibilidad por sucursal), el producto, y por cascada de BD sus `product_media`, vínculos de modificadores y favoritos; los grupos de modificadores no
se tocan; los assets de imagen sin otro uso se liberan best-effort. Las FK RESTRICT (23503) son la red de seguridad (409 recontando; 503 `PRODUCTS_BUSY` si no se puede). Audita `product.deleted`.
Desaparición del menú público: hasta ~6 min por la caché (D7); un carrito con el producto recotiza como línea `NOT_FOUND` (sin 500). La web además retira el botón «Sucursales» de la tarjeta
de producto. Estado: `CONTRACT_DEFINED` (API y web pendientes).

## Estados por componente

| Componente                                                                     | Estado             | Nota                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Contrato OpenAPI (6 operaciones) + tipos                                       | `CONTRACT_DEFINED` | `pnpm contracts:check` en rojo hasta implementar la API (patrón F08–F10)                                                 |
| Migración `0012_products` + Prisma (`products`, `product_media`, FK favoritos) | propuesta          | Sin aplicar a bases reales; requiere aprobación humana                                                                   |
| API `src/products/` (público + admin + `ProductsQueryService`)                 | pendiente          | `CONTRACT_DEFINED` → `API_IMPLEMENTED`                                                                                   |
| Adaptador real de `CatalogProductsPort` en favoritos                           | pendiente          | Sustituye `UnavailableCatalogAdapter` (D9)                                                                               |
| Web: menú, ficha, búsqueda y pantalla admin de productos                       | pendiente          | Mock hasta integrar; `http` solo tras la API. Modificadores y disponibilidad por sucursal siguen SIMULADOS hasta F12/F13 |
| Precio/disponibilidad por sucursal, modificadores, subida, promos, agregados   | pendiente          | F13 / F12 / F14 / F15 / F17                                                                                              |

## Hechos verificados del repo

- DBML (`docs/references/monsushi_dbdiagram.dbml:145-163`): `app.products (id, sku unique, category_id, slug unique, name, description, base_price numeric(12,2), active, created_at)`
  y `app.product_media (id, product_id, media_url, alt_text, sort_order)`; refs `products.category_id > categories.id`, `product_media.product_id > products.id [delete: cascade]`,
  `customer_favorites.product_id > products.id` (líneas 466-474). Se añade `updated_at`.
- `CatalogProductsPort` (`sushimon-api/src/favorites/catalog-products.port.ts`): `findPublicSummaries(ids)` → `Map<id, CatalogProductSummary{id,name,nameEn,imageUrl,categoryId,status}>`;
  un id ausente = no existe; falla ⇒ `CatalogUnavailableError`. Hoy enlazado a `UnavailableCatalogAdapter` en `favorites.module.ts`.
- `CategoriesQueryService` (F10) exporta `findVisibleTree`, `findVisibleBySlug` (con `ancestors`) y `getVisibleIds(rootId?)`.
- Permisos existentes (ADR-0010): `catalog.read`, `catalog.create`, `catalog.update`. No se crean permisos.
- Filtro de errores: `code` se propaga solo con `status < 500`; los 5xx con `code` van en lista blanca (`PRODUCTS_BUSY` se añade).

## Criterios de aceptación del backlog

| Criterio                 | Cómo se cumple                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Producto activo visible  | Visible = `active` Y categoría efectivamente visible (D3); lista y ficha públicas                                          |
| Filtros sin N+1          | Un SELECT paginado con join a categoría + un SELECT de media por IDs de la página; visibilidad por una lectura de F10 (D6) |
| Listados y fichas reales | `listStoreProducts`/`getStoreProduct`/`listAdminProducts`/`getAdminProduct`; la web pasa de mock a `http` para ellos       |
| Precios coherentes       | `numeric(12,2)` + `CHECK`; la API entrega `"85.00"` (cadena); nunca `number` (D2)                                          |
| Validación de campos     | DTO (400) + `CHECK` de BD; negocio 409/422 con `code` (D8)                                                                 |
| 401/403 administrativos  | JWT + personal activo + aal2 + permiso `catalog.*`; escrituras con alcance global (D7)                                     |
| No borrar con historial  | (ADR-0035) Borrado físico solo sin pedidos/promociones/banners; FK `RESTRICT` desde `order_items` protege el historial     |

## Decisiones (resumen; razones en ADR-0017)

- **D1 Modelo**: `app.products` = DBML + `updated_at`; `sku` opcional único (1–40, `[A-Z0-9._-]`, guardado en mayúsculas); `slug` único kebab ≤ 80; `name` 1–120 (NFC, recorte,
  colapso de espacios, sin control); `description` ≤ 2000 texto plano; `base_price numeric(12,2)` con `CHECK (base_price > 0 AND base_price <= 999999.99)`; `category_id` FK →
  `categories` `ON DELETE RESTRICT`; `active` default true. `app.product_media (id, product_id FK ON DELETE CASCADE, media_url https ≤ 2048, alt_text ≤ 200, sort_order >= 0)`,
  máx. 8 por producto. Sin DELETE en F11; desde ADR-0035 existe `deleteAdminProduct` (ver «Borrado (ADR-0035)»); desactivar sigue siendo la alternativa reversible.
- **D2 Precio**: cadena decimal con 2 decimales (`"85.00"`), tanto en entrada como en salida. La API parsea con aritmética decimal (no `Number`). Rango y forma inválidos ⇒ 400.
  Es el precio **base global**: sin precios por sucursal en F11.
- **D3 Visibilidad pública**: producto `active` Y categoría efectivamente visible (ella y sus ancestros activos, F10). Un producto en categoría oculta ⇒ 404 en ficha y ausente en lista.
  Administrar un producto con categoría inactiva se permite; solo se exige categoría **activa** al crear o al cambiar `categoryId`.
- **D4 Slug/SKU**: slug opcional al crear (se genera desde el nombre y se desambigua `-2`, `-3`…); explícito y existente ⇒ 409 `PRODUCT_SLUG_TAKEN`; editable (cambiarlo rompe URLs;
  sin historial de slugs). SKU duplicado ⇒ 409 `PRODUCT_SKU_TAKEN`. La unicidad la garantizan los índices únicos de BD: la API traduce `23505`/`P2002` según el **target**
  (`products_slug_key` / `products_sku_key`); target desconocido ⇒ 500 genérico. **Sin advisory lock** (a diferencia de F10: no hay invariante de estructura).
- **D5 Imágenes (`product_media`)**: lista ordenada por `sort_order`; en POST/PATCH el orden del arreglo define `sortOrder` (0..n-1). Solo URL `https` ≤ 2048 (no http/data/javascript/
  relativas), máx. 8, `altText` ≤ 200; incumplir ⇒ 422 `PRODUCT_MEDIA_INVALID`. PATCH con `media` **reemplaza** la lista (en la misma transacción); `[]` la vacía; omitir no la toca.
  F14 aportará la subida (R2) y reutilizará esta tabla; F11 no sube ni valida contenido remoto.
- **D6 Lecturas sin N+1**: público `GET /v1/store/products` (page/pageSize ≤ 100, default 20; `categorySlug` incluye descendientes visibles; `q` SOLO en nombre/descripción (el SKU NO es buscable públicamente; sí en la lista admin) con `ILIKE` y comodines
  `% _ \` escapados, ≤ 80; orden `name, id`) y `GET /v1/store/products/{slug}` (ficha con media y `categoryAncestors` visibles). Algoritmo: (1) una lectura de F10
  (`CategoriesQueryService`) para el conjunto de IDs visibles (o del subárbol); (2) un `SELECT` paginado con join a categoría + `count`; (3) un `SELECT` de media con `product_id IN (página)`.
  Slug de categoría inexistente/no visible ⇒ lista vacía 200. Caché pública `Cache-Control: public, max-age=60, stale-while-revalidate=300`, sin `ETag` (igual que F10; un producto
  desactivado puede seguir visible hasta ~6 min: aceptado). Campos públicos: `id, slug, name, description, basePrice, category{id,slug,name}, media[{url,altText}]`; **no** `sku`.
- **D7 Administración**: `@RequireStaff()` (aal2), `no-store`. `GET /v1/admin/products` (filtros `q`, `categoryId`, `active`; `sort` name|basePrice|createdAt, `order`; desempate `id`; default `name,id`; paginado),
  `POST` (201), `GET /{id}`, `PATCH /{id}` (parcial; campos desconocidos ⇒ 400; cuerpo vacío ⇒ 400; sin cambios ⇒ 200 sin escribir ni auditar). Lectura: `catalog.read` (cualquier alcance);
  POST `catalog.create`; PATCH `catalog.update`; escrituras exigen alcance GLOBAL (productos globales) ⇒ si no, 403. Elementos admin incluyen `publiclyVisible` y estado de la categoría.
- **D8 Errores con `code`**: ver tabla. `PRODUCTS_BUSY` (503) solo traduce `P2028`/timeout de la transacción de escritura (reemplazo de media + insert), reintentable, mensaje fijo.
- **D9 Puerto de favoritos (F06)**: `ProductsModule` exporta `ProductsQueryService` (`findVisibleSummariesByIds`, `findVisibleBySlug`, `getPublicList`). `FavoritesModule` importa `ProductsModule` y
  enlaza `{ provide: CATALOG_PRODUCTS_PORT, useClass: ProductsCatalogAdapter }` (adaptador en `src/favorites/`, delega en `ProductsQueryService`); se **retira** el `UnavailableCatalogAdapter`
  del módulo (sigue disponible solo como doble de prueba si se necesita). Dirección de dependencia `favorites → products` (sin ciclos; `ProductsModule` no importa favoritos). Mapeo: solo
  productos visibles (D3) con `status='ACTIVE'`, `imageUrl` = primera imagen o `null`, `nameEn=null`, `categoryId`; un producto no visible queda ausente del mapa. Un error de BD o timeout
  ⇒ `CatalogUnavailableError` (503 `CATALOG_UNAVAILABLE` en PUT; `UNAVAILABLE` en GET), sin romper favoritos. Una consulta por lote.
- **D10 FK de favoritos**: la migración `0012` añade `customer_favorites.product_id → products(id) ON DELETE CASCADE` `NOT VALID` y la valida solo si no hay huérfanos (nunca borra datos).
  Procedimiento si los hubiera: listar huérfanos (`LEFT JOIN products … WHERE p.id IS NULL`), decidir con negocio (borrarlos manualmente con aprobación) y luego `ALTER TABLE … VALIDATE CONSTRAINT`.
  En entornos reales no debería haberlos (PUT de favoritos validaba contra el catálogo y devolvía 503 hasta F11).
- **D11 Auditoría** (misma transacción, sin PII): `product.created`, `product.updated` (old/new solo de lo cambiado; media como conteo/ids), `product.activated`, `product.deactivated`. Sin cambios ⇒ no se audita.
- **D12 Contrato futuro (NO implementado)**: F13 añadirá `branchPrice` y `available` a la lectura por sucursal (`branch_products.price_override`/`available`); `basePrice` seguirá siendo el precio global.
  F12 añadirá modificadores a la ficha. F11 no reserva campos nulos para ellos.
- **D13 Módulos**: `src/products/` (`ProductsModule`, `PublicProductsController`, `AdminProductsController`, `AdminProductsService`, `ProductsQueryService`, repositorio, políticas de precio/media).
  `AppModule` solo lo compone. Web: `features/catalog` (menú, ficha, búsqueda) y `features/backoffice/products`.

## Modelo de datos (propuesta para `database-engineer`, migración `0012_products`)

```
app.products (id uuid pk default gen_random_uuid(), sku text null UNIQUE, category_id uuid not null REFERENCES app.categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  slug text not null UNIQUE, name text not null, description text null, base_price numeric(12,2) not null, active boolean not null default true,
  created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  CHECK slug kebab ≤ 80, CHECK char_length(name) BETWEEN 1 AND 120, CHECK description IS NULL OR char_length ≤ 2000,
  CHECK base_price > 0 AND base_price <= 999999.99, CHECK sku IS NULL OR sku ~ '^[A-Z0-9][A-Z0-9._-]*$' AND char_length ≤ 40)
INDEX products_category_idx (category_id, active, name, id)  -- listados y soporte del RESTRICT
app.product_media (id uuid pk, product_id uuid not null REFERENCES app.products(id) ON DELETE CASCADE, media_url text not null, alt_text text null, sort_order integer not null default 0,
  CHECK media_url ~ '^https://' AND char_length ≤ 2048, CHECK alt_text IS NULL OR char_length ≤ 200, CHECK sort_order >= 0,
  UNIQUE (product_id, sort_order) DEFERRABLE) + trigger de tope 8 por producto
ALTER TABLE app.customer_favorites ADD FOREIGN KEY (product_id) REFERENCES app.products(id) ON DELETE CASCADE NOT VALID; VALIDATE solo sin huérfanos
```

RLS: `ENABLE ROW LEVEL SECURITY` sin políticas + `REVOKE` como 0006/0007/0011. El DBML de `docs/references` no se edita. (La migración vive en `sushimon-api/prisma/migrations/0012_products/`; esta spec solo fija la intención.)

## Errores

| HTTP | `code`                     | Cuándo                                                                                                              |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación)               | Forma/UUID/slug inválidos, precio fuera de forma o rango, cuerpo vacío en PATCH, propiedades desconocidas, `q` > 80 |
| 401  | —                          | Sin JWT válido (rutas admin)                                                                                        |
| 403  | —                          | No es personal activo, falta permiso, no aal2, o alcance no global en escritura                                     |
| 404  | `PRODUCT_NOT_FOUND`        | Ficha pública inexistente/inactiva/categoría oculta; admin GET/PATCH inexistente                                    |
| 409  | `PRODUCT_SLUG_TAKEN`       | Slug ya usado (explícito o en carrera)                                                                              |
| 409  | `PRODUCT_SKU_TAKEN`        | SKU ya usado                                                                                                        |
| 422  | `PRODUCT_CATEGORY_INVALID` | Categoría inexistente o inactiva al crear/cambiar                                                                   |
| 422  | `PRODUCT_MEDIA_INVALID`    | URL no https, > 2048, `altText` > 200 o más de 8 imágenes                                                           |
| 503  | `PRODUCTS_BUSY`            | Timeout de la transacción de escritura; reintentable                                                                |

## Contrato (resumen)

`listStoreProducts` y `getStoreProduct` (públicos) · `listAdminProducts` · `createAdminProduct` · `getAdminProduct` · `updateAdminProduct`. Esquemas: `ProductPrice`, `PublicProduct`, `PublicProductDetail`,
`PublicProductPage`, `PublicProductCategoryRef`, `PublicProductMedia`, `AdminProduct`, `AdminProductPage`, `AdminProductCategory`, `AdminProductMedia`, `ProductMediaInput`, `CreateProductRequest`,
`UpdateProductRequest`; parámetros `ProductId`, `ProductSlug`; tag `products`. `contracts:check` exige que la API declare exactamente los códigos documentados por operación.

## Pruebas exigidas

Servicio: precio (formas válidas/rangos, sin `Number`), slug generado/desambiguado/409, SKU 409 por target, categoría inexistente/inactiva al crear y al mover (y permitido editar con categoría inactiva sin moverla),
media (http/data/javascript/relativa/>2048/>8 ⇒ 422; reemplazo `[]`; orden), PATCH vacío/desconocido 400, sin cambios no audita, visibilidad (inactivo, categoría inactiva, ancestro inactivo), `categorySlug` con descendientes,
`q` con `%`/`_` literal, paginación y orden estable con empates, sin N+1 (número de consultas acotado). Autorización: 401, 403 (no staff/sin aal2/sin permiso/alcance por sucursal en escrituras; lectura OK), público sin auth.
Auditoría: una fila por operación real. Favoritos: el adaptador real devuelve solo visibles y traduce fallos a `CatalogUnavailableError`; las pruebas existentes de F06 siguen verdes. Contrato: `contracts:check`.
Web: ficha y lista reales, placeholder sin imágenes, admin crea/edita/activa/reemplaza imágenes y mapea cada `code` (nunca por `message`). BD (base real, pendiente de aprobación): CHECK, FK RESTRICT y FK de favoritos.

## Tareas por dueño

1. `database-engineer`: migración `0012_products` + Prisma + RLS + FK de favoritos + procedimiento de huérfanos.
2. `api-engineer`: módulo `products`, controladores, servicios, `ProductsQueryService`, adaptador de favoritos, whitelist de `PRODUCTS_BUSY`, auditoría, pruebas; `contracts:check` verde.
3. `web-engineer`: menú/ficha/búsqueda reales con placeholder de imagen, pantalla admin, errores por `code`; mocks alineados al contrato; modificadores y disponibilidad por sucursal siguen mock.
4. `security-reviewer` / `qa-engineer`: URL de imágenes (esquema), alcance global, visibilidad pública, escape de comodines, matriz de pruebas.

## Preguntas abiertas y asunciones

- Resuelto (revisión de seguridad MEDIO-1): `sku` ya NO es buscable en la lista pública (evita enumerarlo por búsqueda); solo en la lista admin.
- Un favorito de producto no visible aparece como `REMOVED` (ausente del mapa) en lugar de `INACTIVE`; el puerto permitiría `INACTIVE`, pero se decidió devolver solo visibles.
- Un PATCH que desactiva la categoría (F10) no toca productos: quedan activos pero no visibles (`publiclyVisible=false`).
- Carrera: la categoría puede desactivarse entre la validación y el insert; el producto queda creado pero oculto (consistente con D3). La FK garantiza existencia.
- `PRODUCT_MEDIA_INVALID` cubre forma de URL y límites (422), por eso el esquema `ProductMediaInput.url` no declara `format`/`maxLength` (evita que el 400 de la validación de forma lo preceda).
- Sin tope global de productos; `pageSize` ≤ 100 acota las lecturas.

## Endurecimiento tras la revisión de seguridad/rendimiento

- **Host de imágenes (MEDIO-2)**: se rechazan SIEMPRE IP literales (v4/v6), `localhost`/`*.localhost` y hostnames sin punto (422 `PRODUCT_MEDIA_INVALID`). La variable opcional `PRODUCT_MEDIA_ALLOWED_HOSTS` (coma; `cdn.x.com` exacto, `.x.com` subdominios; vacía = cualquier host https público) restringe los hosts. Se guarda el `href` normalizado (≤ 2048). **Pendiente F14**: fijar el host de R2/CDN en esa variable. **Pendiente web**: restringir `img-src` por CSP al host del CDN (no se tocó la web).
- **Sin tope de longitud del arreglo `media` en el DTO**: cualquier tope en el DTO convertiría el 422 en 400 para listas grandes; el tamaño lo acota el límite de cuerpo de Express y la policy responde 422 para > 8.
- **Lecturas públicas**: `@Throttle` 60/min por IP; `page` ≤ 200 (antes 10 000).
- **Slug autogenerado**: si el INSERT choca por carrera (23505 slug), se reintenta UNA vez en una transacción nueva antes del 409; el slug explícito repetido es 409 directo.
- El adaptador de favoritos registra `warn` con nombre y código del error (sin mensaje, ids ni PII).

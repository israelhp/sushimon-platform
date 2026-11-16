# F14 — Imágenes y medios en Cloudflare R2

**Rama**: `feature/F14-cloudflare-r2-media` (desde `develop` 1562264)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F00 (fundamentos), F11 (productos y `product_media`), F03 (RBAC) · **Integración posterior**: F16 (banners), F17 (agregados de tienda)
**Decisiones**: `docs/adr/0020-medios-cloudflare-r2.md` · **Integración**: `docs/integrations/cloudflare-r2.md`
**Estado global**: `IN_PROGRESS`. Contrato `CONTRACT_DEFINED`; API/BD/web se implementan en la misma rama y se reportan por componente. **Integración real con R2: `BLOCKED_EXTERNAL`** hasta tener bucket, dominio, CORS y credenciales verificados.

## Alcance

Subir, confirmar, listar, reutilizar, ordenar y eliminar imágenes de producto almacenadas en Cloudflare R2 y publicarlas por URL HTTPS estable. La API autoriza y firma un PUT temporal; el navegador sube directo a R2; `complete` verifica y confirma. Biblioteca de medios (`media_assets`)
y vínculo con `product_media`. Fuera de alcance: banners y contenido editorial (F16), agregados de tienda/búsqueda (F17), procesamiento de imagen en servidor, variantes responsive, IA, medios privados (solo se documenta la separación), cron de limpieza, CSP completa (Etapa 3).

## Estados por componente

| Componente                                                                                       | Estado             | Nota                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (9 operaciones nuevas, `assetId` en `AdminProductMedia`, códigos) + tipos       | `CONTRACT_DEFINED` | `pnpm contracts:generate` ejecutado; `pnpm contracts:check` lista las 9 operaciones sin implementar (esperado hasta implementar la API)                          |
| Migración `0015_media_assets` + Prisma                                                           | propuesta          | Preparada por `database-engineer` en el árbol de trabajo; sin aplicar a bases reales; requiere aprobación humana                                                 |
| API `src/media/` (puerto, adaptadores, intents, complete, biblioteca, borrado, servicios)        | pendiente          | `CONTRACT_DEFINED` → `API_IMPLEMENTED`                                                                                                                           |
| API `src/products/` (adjuntar, editar alt, reordenar, desvincular, enlace automático en `PATCH`) | pendiente          | Reusa topes y códigos de F11                                                                                                                                     |
| Web: gestor de fotos en `ProductModal`, optimización cliente, render con fallback                | pendiente          | `MOCK_ONLY` (adaptador mock de `lib/data-access`) hasta integrar; el flujo de navegador contra R2 no se puede probar con el adaptador `mock` de la API           |
| Adaptador R2 real                                                                                | `BLOCKED_EXTERNAL` | Sin credenciales, bucket ni dominio verificados. El código se escribe contra el SDK; **no se afirma que funcione** hasta ejecutar la lista de `cloudflare-r2.md` |
| Adaptador `unavailable` / `mock`                                                                 | pendiente          | `unavailable` por defecto (503); `mock` solo desarrollo/pruebas                                                                                                  |
| Medios privados (segundo bucket)                                                                 | fuera de alcance   | Solo documentado                                                                                                                                                 |
| Job de purga de PENDING caducados y huérfanos                                                    | pendiente          | `MediaCleanupService.purgeExpired()` existe y es invocable; sin planificador                                                                                     |
| Variantes responsive del lado servidor                                                           | fuera de alcance   | Mejora futura                                                                                                                                                    |

## Hechos verificados del repo

- No existe integración previa con R2: solo hay referencias en `docs/BACKLOG.md`, `docs/adr/0017-productos-catalogo.md` y `specs/012-products-catalog/spec.md`; ningún código ni dependencia de AWS/S3 en `sushimon-api` ni `sushimon-web`.
- DBML (`docs/references/monsushi_dbdiagram.dbml:157-163`): `app.product_media (id, product_id, media_url, alt_text, sort_order)`, ref `product_id > products.id [delete: cascade]` (línea 467). No hay `media_assets`; la desviación se justifica en ADR-0020 (el DBML no se edita).
- F11: `normalizeMedia`, `MEDIA_MAX = 8`, `MEDIA_ALT_MAX = 200`, `MEDIA_URL_MAX = 2048`, `hostAllowed` (`sushimon-api/src/products/product-policy.ts:23-25,120-196`); `PRODUCT_MEDIA_INVALID` 422 y `PRODUCTS_BUSY` 503; `PATCH media` reemplaza la lista (ADR-0017 D5). El comentario de `PRODUCT_MEDIA_ALLOWED_HOSTS`
  (`sushimon-api/src/config/env.ts:118-122`) ya anticipa que F14 fija el host de R2/CDN. La migración 0012 ya limita a 8 por producto (trigger) y `UNIQUE (product_id, sort_order)` diferible.
- Migración 0015 (`sushimon-api/prisma/migrations/0015_media_assets/`): `media_assets` con `CHECK` de kind, `object_key`, MIME, tamaño `1..5242880`, checksum hex64, status; `UNIQUE (kind, checksum_sha256) WHERE status='READY'`; índice parcial de purga; `product_media.asset_id` FK `RESTRICT`. **No** hay restricción
  única `(product_id, asset_id)`: `MEDIA_ALREADY_ATTACHED` lo impone el servicio bajo el bloqueo del producto.
- Web: `ProductModal` hoy edita `media` como URL manuales reordenables (`sushimon-web/src/features/bo-catalog/components/ProductModal.tsx:52,334-400`); el componente de imagen de tienda ya hace fallback a ilustración (`features/catalog/components/product-art.tsx:23-45`) con `<img>` y `eslint-disable no-img-element`;
  `sushimon-web/next.config.ts` no define `images` y la CSP solo tiene `frame-ancestors` (no restringe `img-src`/`connect-src` hoy).
- Permisos existentes (ADR-0010): `catalog.read`, `catalog.update`. No se crean permisos nuevos.

## Criterios de aceptación del backlog

| Criterio                     | Cómo se cumple                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No se exponen claves R2      | Variables solo de servidor, sin `NEXT_PUBLIC_`; nunca en respuestas, logs ni auditoría; prueba de que ninguna respuesta ni el bundle web contiene `R2_SECRET_ACCESS_KEY`/`accessKey`; escaneo de secretos del repo |
| URL firmada corta            | TTL <= 300 s (configurable a la baja), solo en la respuesta del intent, `no-store`, nunca persistida ni registrada                                                                                                 |
| `media_url` HTTPS estable    | `publicUrl(object_key)` con `R2_PUBLIC_BASE_URL` https; clave inmutable; nunca URL firmada                                                                                                                         |
| Varias imágenes por producto | Hasta 8 (tope de F11), orden `sortOrder` 0..n-1, `PUT .../media/order`                                                                                                                                             |
| Borrado auditable            | `media.deleted`, `product.media_detached`; sin PII                                                                                                                                                                 |
| MIME falso, tamaño, firma    | MIME declarado en lista blanca; tamaño declarado y verificado con HeadObject; firma real por bytes iniciales; discrepancia => objeto borrado + 422                                                                 |
| Sin credenciales públicas    | Bucket público solo lectura por dominio; escritura solo con URL firmada; secretos en servidor                                                                                                                      |
| Next Image                   | `next/image` con `unoptimized` o `<img>` con `loading`, `decoding`, `width/height`, `sizes`; fallback; sin Image Resizing de Cloudflare ni optimizador de Vercel                                                   |

## Decisiones (resumen; razones en ADR-0020)

- **D1 Flujo**: `upload-intents` -> PUT directo a R2 -> `complete`. Bytes nunca por la API.
- **D2 Puerto y adaptadores**: `MediaStoragePort { presignPut, headObject, readRange, deleteObject }`; `R2MediaStorageAdapter` (SDK `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, única dependencia nueva, solo API), `UnavailableMediaStorageAdapter` (defecto, 503 `MEDIA_STORAGE_UNAVAILABLE`),
  `MockMediaStorageAdapter` (memoria; `MEDIA_STORAGE_ADAPTER=mock` y `NODE_ENV` development/test; con `production` la API no arranca; marca `storageMode=MOCK`; hosts `*.invalid`).
- **D3 Variables de entorno** (opcionales; todo-o-nada; sin `NEXT_PUBLIC_`):

  | Variable                   | Defecto | Notas                                                                                                                                                  |
  | -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `R2_ACCOUNT_ID`            | —       | Construye `https://<account>.r2.cloudflarestorage.com` si no hay `R2_ENDPOINT`                                                                         |
  | `R2_ENDPOINT`              | —       | Endpoint S3 https (alternativa a `R2_ACCOUNT_ID`; permite entornos de prueba)                                                                          |
  | `R2_BUCKET`                | —       | Bucket PÚBLICO de medios (nombre válido DNS, 3-63)                                                                                                     |
  | `R2_ACCESS_KEY_ID`         | —       | Token S3 con permisos mínimos sobre ese bucket                                                                                                         |
  | `R2_SECRET_ACCESS_KEY`     | —       | Secreto; mínimo 20 caracteres; nunca se registra                                                                                                       |
  | `R2_PUBLIC_BASE_URL`       | —       | https, sin barra final, sin query/hash; host del dominio personalizado/CDN. **No se inventa un dominio**                                               |
  | `R2_REGION`                | `auto`  | Región SigV4                                                                                                                                           |
  | `MEDIA_MAX_BYTES`          | 5242880 | 1..5242880 (tope duro por el `CHECK` de la migración)                                                                                                  |
  | `MEDIA_UPLOAD_TTL_SECONDS` | 300     | 30..300                                                                                                                                                |
  | `MEDIA_STORAGE_ADAPTER`    | auto    | Opcional `r2` \| `mock`. `r2` sin variables completas o `mock` en producción => no arranca. Sin ella: R2 completo => `r2`; ninguna R2 => `unavailable` |

  Reglas: (`R2_ACCOUNT_ID` o `R2_ENDPOINT`) + `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_PUBLIC_BASE_URL` forman un grupo: definir algunas pero no todas => error de arranque con el nombre de las que faltan (sin valores). `MEDIA_MAX_BYTES`/`MEDIA_UPLOAD_TTL_SECONDS`/`R2_REGION`
  tienen defecto y no activan el grupo. `MEDIA_STORAGE_ADAPTER=mock` junto con credenciales R2 reales => error (evita mezclar). `.env.example` y docs sin valores reales.

- **D4 Datos** (migración 0015; ver ADR-0020 d.4): `media_assets` + `product_media.asset_id`. La URL pública y las URLs firmadas no se guardan; `media_url` de `product_media` es la URL pública estable derivada al adjuntar. `original_name` no se guarda. Cambiar de dominio exige un `UPDATE` de datos (ver ADR).
- **D5 Clave y cabeceras**: `products/<yyyy>/<uuid>.<ext>` (`jpg`, `png`, `webp`, `avif`); PUT con `Content-Type`, `Cache-Control: public, max-age=31536000, immutable` y `x-amz-checksum-sha256` firmados. Nunca se sobrescribe un objeto confirmado. El servicio de clave valida contra el `CHECK` de la BD (minúsculas, sin `..` ni `//`, <= 200).
- **D6 Intent** (`POST /v1/admin/media/upload-intents`, `createAdminMediaUpload`): `{kind, mimeType, sizeBytes, checksumSha256}`. Orden de comprobaciones: forma (400) -> almacenamiento disponible (503) -> MIME (422 `MEDIA_TYPE_NOT_ALLOWED`) -> tamaño (422 `MEDIA_TOO_LARGE`) -> dedup (200 con `deduplicated=true`, asset existente, sin `uploadUrl`, `headers` ni
  `expiresAt`) -> tope de PENDING por empleado (422 `MEDIA_PENDING_LIMIT_REACHED`, 50) -> crea PENDING (`expires_at = now + TTL`) y firma (201). Antes de crear se purga de forma perezosa un lote (<= 100) de PENDING caducados. Respuesta: `{assetId, deduplicated, uploadUrl, headers, expiresAt, storageMode, asset}`.
- **D7 Complete** (`POST /v1/admin/media/complete`, `completeAdminMediaUpload`): `{assetId}`. 404 `MEDIA_NOT_FOUND`; ya READY => 200 idempotente (antes de comprobar caducidad y almacenamiento); PENDING y caducado => **410 `MEDIA_UPLOAD_EXPIRED`**; `HeadObject`: ausente => 422 `MEDIA_OBJECT_MISSING` (sigue PENDING); tamaño != declarado, tamaño > máximo,
  `Content-Type` != declarado o checksum != declarado, o firma real no corresponde al MIME => borra objeto y fila, audita `media.rejected` y 422 `MEDIA_CONTENT_MISMATCH`; correcto => READY con `confirmed_at`, `expires_at=NULL`, auditoría `media.confirmed`, 200 con `url`. `23505` del índice parcial de dedup => borra el objeto propio y la fila
  PENDING y responde 200 con el asset READY ganador. Sin almacenamiento => 503 (salvo READY idempotente).
- **D8 Biblioteca**: `GET /v1/admin/media` (`listAdminMedia`; `catalog.read`): filtros `kind`, `status`, `unreferenced`, `page` <= 200, `pageSize` <= 100; orden `createdAt desc, id`; `usageCount` por una consulta agregada (sin N+1); no toca R2. `GET /v1/admin/media/{id}` (`getAdminMedia`): asset + `usages`. 404 `MEDIA_NOT_FOUND`.
  Se omitió `q`: sin nombre original no hay texto útil que buscar.
- **D9 Borrado** (`DELETE /v1/admin/media/{id}`, `deleteAdminMedia`): 404, 409 `MEDIA_IN_USE` (comprobación + `DELETE` en una transacción; FK `RESTRICT` como respaldo ante carrera, `23503` => 409), luego borrado del objeto fuera de la transacción; fallo del objeto => fila ya eliminada, `warn` con la clave, 204. Repetir => 404 sin efectos. Si el adaptador
  es `unavailable` => 503 antes de tocar la fila (para no dejar huérfanos).
- **D10 Producto** (`src/products`; `catalog.update` GLOBAL; transacción bajo bloqueo de la fila del producto como el `PATCH` de F11):
  - `POST /v1/admin/products/{id}/media` (`attachAdminProductMedia`): `{assetId, altText?}`. Orden: producto (404 `PRODUCT_NOT_FOUND`) -> asset (404 `MEDIA_NOT_FOUND`) -> READY (422 `MEDIA_ASSET_NOT_READY`) -> no duplicado en el producto (409 `MEDIA_ALREADY_ATTACHED`) -> tope 8 (422 `PRODUCT_MEDIA_INVALID`, reutiliza F11) -> `altText` (422 `PRODUCT_MEDIA_INVALID`).
    Inserta con `sortOrder` = tamaño actual, `media_url = publicUrl(object_key)`, `asset_id`. 201. Audita `product.media_attached`.
  - `PATCH /v1/admin/products/{id}/media/{mediaId}` (`updateAdminProductMedia`): `{altText}`; 404 `PRODUCT_MEDIA_NOT_FOUND` si no pertenece al producto; sin cambio => 200 sin auditar.
  - `PUT /v1/admin/products/{id}/media/order` (`reorderAdminProductMedia`): `{orderedIds}` exactos (ids de `product_media`); 422 `MEDIA_REORDER_MISMATCH`; reasigna 0..n-1 (el `UNIQUE (product_id, sort_order)` es diferible: ver migración 0012); idempotente; audita `product.media_reordered` solo si cambia.
  - `DELETE /v1/admin/products/{id}/media/{mediaId}` (`detachAdminProductMedia`): desvincula, renumera, 204, NO borra el asset. Audita `product.media_detached`.
  - Rutas: `PUT .../media/order` es un literal; Nest debe declararla sin que `{mediaId}` la capture (solo `PATCH`/`DELETE` usan `{mediaId}`, no hay colisión de método).
- **D11 Compatibilidad con `PATCH media` de F11**: sigue reemplazando la lista. Una URL normalizada igual a `publicUrl(object_key)` de un asset READY se enlaza con `asset_id` (y conserva su `media_url`); una URL bajo `R2_PUBLIC_BASE_URL` sin asset READY => 422 `PRODUCT_MEDIA_INVALID` (path `media[i].url`); las URLs de otros hosts siguen como en F11 (`asset_id` NULL). `AdminProductMedia.assetId`
  es `null` para ellas. `PRODUCT_MEDIA_ALLOWED_HOSTS`: si no está vacía, el host de `R2_PUBLIC_BASE_URL` se añade a la lista efectiva; si está vacía no cambia (cualquier host https público). Recomendación operativa: definirla con el host del CDN para que el catálogo solo acepte R2.
- **D12 Servicios exportados**: `MediaUrlService.publicUrl(objectKey)` (concatena `R2_PUBLIC_BASE_URL` + `/` + clave; lanza si no hay base configurada; con `unavailable` devuelve error controlado) y `MediaCleanupService.purgeExpired(limit?)` (borra PENDING caducados: objeto con `deleteObject` (ausente = éxito) y fila; sin planificador). `MediaModule` exporta ambos;
  F16/F17 consumen `publicUrl` o el `media_url` persistido. **No** se implementan banners ni agregados.
- **D13 Auditoría** (misma transacción cuando hay BD, sin PII ni URLs firmadas ni claves): `media.upload_intent_created` (`assetId`, `mimeType`, `sizeBytes`), `media.confirmed` (`assetId`), `media.rejected` (`assetId`, `reason`), `media.deleted` (`assetId`), `product.media_attached|detached|reordered` (`productId`, `assetId`/conteo).
- **D14 Errores** y D15 **concurrencia**: ver tabla; las escrituras de producto usan el mismo mecanismo de bloqueo y `PRODUCTS_BUSY` que F11; las de `media_assets` usan transacciones cortas y `MEDIA_BUSY` por `P2028`/`55P03`/`40P01`/`40001`/timeout. Nunca se mantiene una transacción abierta durante una llamada a R2.
- **D16 Web**: `ProductModal` sustituye la edición manual de URL por un gestor: selección múltiple, vista previa local, optimización cliente (canvas -> WebP ~0.82, lado máx. 1600 px, rechazo si > 5 MiB tras optimizar, SHA-256 con Web Crypto), PUT con `fetch` a `uploadUrl` con los `headers` devueltos, `complete`, adjuntar, reordenar, alt, quitar, errores por `code`. Con
  `MEDIA_STORAGE_UNAVAILABLE` muestra «Almacenamiento de imágenes no disponible» y conserva la edición de textos. El adaptador `mock` de la web rotula la simulación. El navegador usa solo el `uploadUrl` recibido; no conoce claves ni el bucket. Tienda: `<img>`/`next/image unoptimized`, `loading="lazy"`, `decoding="async"`, `width/height`, `sizes`,
  `alt`, fallback a ilustración; la primera imagen visible (LCP) sin `lazy`. Sin `images.remotePatterns` mientras se use `unoptimized`. Cuando llegue la CSP completa (Etapa 3): `img-src` y `connect-src` deben incluir el host de R2 (PUT al endpoint S3) y el del CDN.
- **D17 Costos**: sin Image Resizing, sin optimizador de Vercel, sin procesamiento en servidor, cabeceras inmutables, imágenes ya optimizadas en el cliente, caché del CDN. Sin Redis, colas ni cron.

## Endurecimiento tras revisión (API)

Decisiones detalladas en ADR-0020 («Endurecimiento tras revisión…» y «Decisiones de confianza y alcance»). Resumen: el PUT firma `content-length`; purga solo de PENDING con `expires_at < now - 5 min` y rechazo que conserva la fila PENDING caducada (la purga borra de nuevo el objeto); `markReady` exige `expires_at > now` (410 si venció); límites por actor (intents 20/min, complete 60/min, delete 30/min; 429 `RATE_LIMITED`); `pg_advisory_xact_lock` por empleado antes de contar PENDING; purga de 20 con presupuesto de 3 s tras crear el intent; SDK de AWS cargado de forma perezosa. `If-None-Match` no se firma (no verificado en R2; mejora a probar). Cualquier empleado con `catalog.update` global puede completar/rechazar/borrar PENDING de otro (mismo nivel de confianza); la deduplicación solo se calcula tras `assertGlobal`; la coherencia `media_url`↔asset la garantiza el servicio (trigger opcional futuro); el dominio público debe servir `nosniff` y estar separado del de la app.

## Errores

| HTTP | `code`                         | Cuándo                                                                                                                                 |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación)                   | UUID inválido, `kind` fuera del enum, `sizeBytes` no entero o < 1, checksum fuera de forma, propiedades desconocidas, > 8 `orderedIds` |
| 401  | —                              | Sin JWT válido                                                                                                                         |
| 403  | —                              | No es personal activo, falta permiso/alcance global (escritura) o no es aal2                                                           |
| 404  | `MEDIA_NOT_FOUND`              | Asset inexistente                                                                                                                      |
| 404  | `PRODUCT_NOT_FOUND`            | Producto inexistente                                                                                                                   |
| 404  | `PRODUCT_MEDIA_NOT_FOUND`      | La fila `product_media` no existe o no es de ese producto                                                                              |
| 409  | `MEDIA_IN_USE`                 | Borrar un asset referenciado                                                                                                           |
| 409  | `MEDIA_ALREADY_ATTACHED`       | El asset ya está en ese producto                                                                                                       |
| 410  | `MEDIA_UPLOAD_EXPIRED`         | `complete` sobre un intent PENDING caducado                                                                                            |
| 422  | `MEDIA_TYPE_NOT_ALLOWED`       | MIME fuera de la lista blanca                                                                                                          |
| 422  | `MEDIA_TOO_LARGE`              | `sizeBytes` > `MEDIA_MAX_BYTES`                                                                                                        |
| 422  | `MEDIA_PENDING_LIMIT_REACHED`  | Más de 50 intents PENDING vigentes del empleado                                                                                        |
| 422  | `MEDIA_OBJECT_MISSING`         | `complete` sin objeto en R2                                                                                                            |
| 422  | `MEDIA_CONTENT_MISMATCH`       | Tamaño, tipo, checksum o firma real distintos de lo declarado (objeto y asset eliminados)                                              |
| 422  | `MEDIA_ASSET_NOT_READY`        | Adjuntar un asset PENDING                                                                                                              |
| 422  | `MEDIA_REORDER_MISMATCH`       | `orderedIds` no coincide exactamente con las imágenes del producto                                                                     |
| 422  | `PRODUCT_MEDIA_INVALID`        | (F11) más de 8 imágenes, `altText` > 200, URL de R2 sin asset READY en `PATCH media`                                                   |
| 503  | `MEDIA_STORAGE_UNAVAILABLE`    | R2 no configurado, adaptador `unavailable` o fallo/timeout del almacenamiento (mensaje fijo, sin detalles del proveedor)               |
| 503  | `MEDIA_BUSY` / `PRODUCTS_BUSY` | Timeout/bloqueo de la transacción; reintentable                                                                                        |

## Contrato (resumen)

Tag `media`. Operaciones (9): `createAdminMediaUpload` (POST `/v1/admin/media/upload-intents`, 200/201) · `completeAdminMediaUpload` (POST `/v1/admin/media/complete`) · `listAdminMedia` (GET `/v1/admin/media`) · `getAdminMedia` (GET `/v1/admin/media/{id}`) · `deleteAdminMedia` (DELETE) ·
`attachAdminProductMedia` (POST `/v1/admin/products/{id}/media`, 201) · `updateAdminProductMedia` (PATCH `.../media/{mediaId}`) · `reorderAdminProductMedia` (PUT `.../media/order`) · `detachAdminProductMedia` (DELETE `.../media/{mediaId}`).
Esquemas: `MediaKind`, `MediaStatus`, `MediaStorageMode`, `CreateMediaUploadIntentRequest`, `AdminMediaUploadIntent`, `AdminMediaAsset`, `AdminMediaAssetDetail`, `AdminMediaUsage`, `AdminMediaAssetPage`, `CompleteMediaUploadRequest`, `AttachProductMediaRequest`,
`UpdateProductMediaRequest`, `ReorderProductMediaRequest`, `AdminProductMediaList`; parámetros `MediaAssetId`, `ProductMediaId`; `AdminProductMedia.assetId` (nullable, aditivo); `ErrorResponse.code` ampliado. No hay cambios incompatibles: `PATCH /v1/admin/products/{id}` y las respuestas públicas no cambian de forma.
Nota para `api-engineer`: el contrato declara `200` y `201` en `createAdminMediaUpload` y los `503` por operación; `contracts:check` exige exactamente esos códigos.

## Pruebas exigidas

**API**: políticas puras (MIME, tamaño, clave `products/<yyyy>/<uuid>.<ext>` sin nombre del cliente, firmas mágicas JPEG/PNG/WebP/AVIF con falsos positivos como HTML renombrado `.png`, SVG, GIF, cuerpos truncados), checksum hex -> base64, TTL <= 300; intent (404/422/dedup/límite/purga perezosa, auditoría sin PII, `no-store`, la URL
firmada no aparece en logs ni en auditoría ni en BD); complete (ausente, caducado 410, tamaño/tipo/checksum/firma distintos => objeto y fila borrados y 422, idempotente, carrera de dedup `23505`); borrado (409 en uso, huérfano si falla R2 => 204 + `warn`, 503 sin tocar fila, repetición 404); producto (adjuntar READY/PENDING, duplicado, tope 8, orden exacto, reordenar idempotente,
desvincular renumera y no borra el asset, enlace automático por `PATCH media`, URL de R2 sin asset => 422, host permitido); adaptadores (`unavailable` => 503 sin romper el resto; `mock` no arranca en producción; validación todo-o-nada de variables, sin valores en el mensaje de error); autorización (401, 403 sin `catalog.update`/sin alcance global/sin aal2; lecturas con `catalog.read`);
IDOR no aplica (catálogo global). Prueba de que ninguna respuesta contiene `R2_SECRET_ACCESS_KEY`/`accessKey`. `contracts:check` verde. BD (base real, pendiente de aprobación): `migration-0015` ya cubre CHECK/UNIQUE/RESTRICT.
**Web**: optimización (WebP, 1600 px, > 5 MiB rechazado, SHA-256 correcto), flujo intent -> PUT -> complete con errores por `code`, `MEDIA_STORAGE_UNAVAILABLE`, reordenar/alt/quitar, `ProductModal` sin URL manual, render con fallback cuando falla la carga, atributos de `<img>` (`loading`, `decoding`, `width/height`, `alt`), ningún secreto en el bundle.
**Integración real con R2**: ninguna prueba se ejecuta sin credenciales; la lista de verificación de `docs/integrations/cloudflare-r2.md` es el criterio para pasar de `BLOCKED_EXTERNAL` a `SANDBOX_VERIFIED`.

## Tareas por dueño

1. `database-engineer`: migración 0015 y Prisma (preparadas); verificar contra una base de pruebas con aprobación.
2. `api-engineer`: `src/media/`, ampliaciones de `src/products/`, `config/env.ts` (todo-o-nada), `.env.example`, dependencia AWS SDK solo en la API, whitelist `MEDIA_BUSY`, `contracts:check` verde.
3. `web-engineer`: gestor de fotos, optimización, adaptadores mock/http, render con fallback; retirar el campo URL manual cuando se integre.
4. `security-reviewer`: secretos, URL firmada, firma real, SVG, SSRF (no hay descarga remota), enlace automático, CORS.
5. `qa-engineer`: matriz de pruebas y verificación con credenciales reales cuando existan.

## Preguntas abiertas y asunciones

- **Asunción**: dedup 200 vs creación 201 en el mismo endpoint (alternativa: siempre 201). Elegida la primera por claridad del cliente.
- **Asunción**: 410 para intent caducado (alternativa 422). Documentado en ADR-0020 d.7.
- **Asunción**: tope de 50 PENDING por empleado y lote de purga de 100; negocio puede ajustarlo.
- **Asunción**: no se guarda `original_name`; si negocio quiere mostrar el nombre en la biblioteca hay que añadir columna (migración nueva).
- **Asunción**: `PRODUCT_MEDIA_ALLOWED_HOSTS` vacía se mantiene permisiva; se recomienda definirla en producción. Alternativa (forzar solo R2 cuando está configurado) cambiaría el comportamiento de F11 y se descarta sin decisión de negocio.
- **Pendiente de proveedor (R2)**: verificar con credenciales reales (a) que el PUT presignado con `x-amz-checksum-sha256` y `Cache-Control` firmados es aceptado y la verificación del checksum se aplica; (b) que `Content-Length` no es firmable y por eso el tamaño se valida con `HeadObject`; (c) CORS del bucket para `PUT` desde el origen del backoffice; (d) dominio
  personalizado sirviendo el bucket con caché y las cabeceras inmutables; (e) `HeadObject`/GET con rango. Ver `docs/integrations/cloudflare-r2.md`.
- **Pendiente**: job periódico para `purgeExpired()` y conciliación de huérfanos; CSP completa (Etapa 3); medios privados (F-posterior); variantes responsive.
- **Pendiente web (coordinación)**: el adaptador `mock` de la API no permite subir bytes desde un navegador (hosts `*.invalid`); el flujo de navegador se simula en el adaptador mock de `lib/data-access` y se verifica de verdad solo contra R2 real.
- **Orden de despliegue**: aplicar la migración `0015_media_assets` ANTES de desplegar la API de F14 (sin ella `GET /v1/admin/media` y el adjuntar responden 500). Línea para el PR: «**Despliegue: aplicar la migración 0015_media_assets antes de desplegar la API.**» La API arranca sin variables R2 (modo `unavailable`).

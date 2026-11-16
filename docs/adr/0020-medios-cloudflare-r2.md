# ADR-0020 Medios en Cloudflare R2: subida directa con URL PUT firmada, puerto de almacenamiento y registro `media_assets`

**Estado**: **propuesta** (2026-11-16, F14). Se acepta al fusionar `specs/015-cloudflare-r2-media`. Integración real con R2: `BLOCKED_EXTERNAL` hasta contar con bucket, dominio y credenciales verificados.

**Contexto**: F11 (ADR-0017) guarda imágenes como URL `https` ya existentes en `app.product_media(media_url)` y dejó la subida a F14. El backoffice necesita subir fotos y la tienda mostrarlas por un dominio estable. No existe integración previa
con R2 (búsqueda en el repo: solo menciones en backlog/ADR-0017/spec 012). El DBML solo guarda `media_url`. F16 (banners) y F17 (agregados) consumirán la URL pública.

## Decisión

1. **Subida directa**: la API autoriza y firma un `PUT` S3 temporal (SigV4, <= `MEDIA_UPLOAD_TTL_SECONDS`, 300 s por defecto) contra el endpoint S3 de R2; el navegador sube los bytes a R2; `complete` confirma. Los bytes nunca pasan por NestJS ni por Vercel (sin límite de cuerpo
   serverless, sin coste de cómputo ni de ancho de banda en la API). Alternativa descartada: `multipart` a la API y reenvío a R2.
2. **Puerto `MediaStoragePort`** (`presignPut`, `headObject`, `readRange`, `deleteObject`) con tres adaptadores, patrón de ADR-0013/F09:
   - `R2MediaStorageAdapter` (real): SDK `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, **única dependencia nueva y solo en la API**. Alternativa descartada: firmar SigV4 a mano (código criptográfico propio, más riesgo y más mantenimiento que dos paquetes oficiales y mantenidos).
   - `UnavailableMediaStorageAdapter` (**defecto** cuando faltan variables R2): toda operación que necesita R2 responde 503 `MEDIA_STORAGE_UNAVAILABLE`; el resto de la API (lecturas de biblioteca, adjuntar, reordenar, desvincular) sigue funcionando.
   - `MockMediaStorageAdapter` (memoria): solo con `MEDIA_STORAGE_ADAPTER=mock` y `NODE_ENV` `development`/`test`; `mock` en producción impide arrancar. Marca `storageMode=MOCK`; usa hosts `*.invalid` (RFC 2606), jamás un dominio real. No sube bytes reales por HTTP: sirve a pruebas y desarrollo de contrato.
     Selección: `MEDIA_STORAGE_ADAPTER` opcional (`r2`|`mock`); sin él, R2 completo => `r2`, sin variables => `unavailable`.
3. **Variables de entorno** (todas opcionales, nunca `NEXT_PUBLIC_`, solo servidor; validación **todo-o-nada** con zod en `config/env.ts`): `R2_ACCOUNT_ID` o `R2_ENDPOINT`, `R2_BUCKET` (el público), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_PUBLIC_BASE_URL` (https, sin barra final, sin query ni hash; configurable, **no se inventa dominio**), `R2_REGION` (`auto`), `MEDIA_MAX_BYTES` (5 MiB por defecto, **tope duro 5 MiB** porque el `CHECK` de la migración 0015 lo exige), `MEDIA_UPLOAD_TTL_SECONDS` (300 por
   defecto, máx. 300). Definir solo algunas de las R2 impide arrancar. Los secretos no se registran ni se devuelven.
4. **Datos** (migración `0015_media_assets`, preparada por `database-engineer`): tabla `app.media_assets (id, kind='PRODUCT_IMAGE', object_key único, bucket, mime_type, size_bytes, checksum_sha256, status PENDING|READY, created_by_staff_id, created_at, confirmed_at, expires_at)` y columna
   nullable `product_media.asset_id` FK `ON DELETE RESTRICT`. **No se guarda la URL pública** (se deriva de `R2_PUBLIC_BASE_URL` + `object_key` con `MediaUrlService.publicUrl`) **ni URLs firmadas** (jamás se persisten). `product_media.media_url` sigue siendo la URL pública HTTPS estable
   que ven F11/F17. Un asset puede usarse en varios productos; `RESTRICT` impide borrarlo en uso. Dedup por SHA-256: `UNIQUE (kind, checksum_sha256) WHERE status='READY'`. El nombre original del archivo **no se guarda** (menos superficie de PII/XSS; el texto alternativo cubre la descripción).
5. **Clave de objeto inmutable** `products/<yyyy>/<uuid>.<ext>` con extensión derivada del MIME verificado, nunca del nombre del cliente. Reemplazar una imagen crea un objeto nuevo (versionado de caché natural); el PUT firma `Cache-Control: public, max-age=31536000, immutable`. Nunca se sobrescribe un objeto confirmado.
6. **Validación en capas**: (a) intent: MIME en lista blanca (`image/jpeg|png|webp|avif`; **SVG y GIF fuera**, SVG es vector de XSS), tamaño <= `MEDIA_MAX_BYTES`, SHA-256 hex; (b) el PUT firma `Content-Type` y `x-amz-checksum-sha256` (base64) para que R2 rechace bytes distintos de los declarados; (c) `complete`: `HeadObject` (existencia, tamaño, tipo,
   checksum) y lectura con rango de los primeros ~32 bytes para verificar la **firma real** (JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF....WEBP`; AVIF `ftyp` con marca `avif`/`avis`). Cualquier discrepancia borra objeto y asset y responde 422 `MEDIA_CONTENT_MISMATCH`. No hay procesamiento de imagen en servidor.
7. **Estados y códigos**: intent expirado => **410 `MEDIA_UPLOAD_EXPIRED`** (recurso existente pero ya inservible; distinto de un 422 de validación y de un 404); objeto ausente => 422 `MEDIA_OBJECT_MISSING` (el asset sigue PENDING, reintentable dentro de la vigencia); `complete` sobre READY => 200 idempotente;
   carrera de dos `complete` con el mismo checksum => el segundo borra su objeto y responde 200 con el asset ganador. Forma inválida = 400, regla de negocio = 422 (como F11–F13).
8. **Borrado**: `DELETE /v1/admin/media/{id}` => 409 `MEDIA_IN_USE` si algún `product_media` lo referencia; si no, **primero** se elimina la fila (transacción + auditoría) y **después** el objeto en R2. Si el borrado del objeto falla queda un objeto huérfano (se registra una advertencia con la clave), pero **nunca** una referencia a un objeto inexistente. Desvincular
   de un producto no borra el asset. Limpieza de PENDING caducados: perezosa al crear intents y `MediaCleanupService.purgeExpired()` exportado; **no hay cron en F14** (job pendiente, junto con la conciliación de huérfanos por listado del bucket).
9. **Compatibilidad F11**: el `PATCH media` de F11 sigue vigente y reemplaza la lista. Cada URL que sea exactamente `publicUrl(object_key)` de un asset READY se enlaza por `asset_id`. Una URL bajo `R2_PUBLIC_BASE_URL` que **no** corresponda a un asset READY se rechaza con 422 `PRODUCT_MEDIA_INVALID` (evita saltarse las validaciones de F14). El host de `R2_PUBLIC_BASE_URL`
   se añade a la lista efectiva de `PRODUCT_MEDIA_ALLOWED_HOSTS` cuando esta no está vacía (si está vacía, cualquier host https público sigue permitido; para forzar solo R2 se define la variable con el host del CDN).
10. **Costos y rendimiento**: la web **optimiza antes de subir** (canvas -> WebP calidad ~0.82, lado máximo 1600 px, rechazo si > 5 MiB tras optimizar, SHA-256 con Web Crypto). Sin Cloudflare Image Resizing ni `/cdn-cgi/image`; sin optimización de imágenes de Vercel (`next/image` con `unoptimized`, o `<img>` con `loading="lazy"`,
    `decoding="async"`, `width/height`, `sizes`); fallback a ilustración si no hay imagen o falla. Las respuestas de la API nunca cachean URLs firmadas (`no-store`). Variantes responsive del lado servidor: mejora futura, fuera de F14.
11. **Medios privados**: si algún día hay archivos no públicos (comprobantes, CV de `job_applications`), irán a un **segundo bucket sin URL pública ni dominio personalizado**, servidos solo con URL GET firmada de vida corta y autorización. **F14 no lo implementa**; `bucket` en `media_assets` y `kind` dejan el camino abierto, y ampliar `kind` exigirá migración.
12. **Autorización**: permisos existentes (`catalog.update` + alcance GLOBAL para escribir; `catalog.read` para leer), aal2, `Cache-Control: no-store`, 503 `MEDIA_BUSY`/`PRODUCTS_BUSY` por timeout, todos los 4xx con `code`. Auditoría sin PII: `media.upload_intent_created`, `media.confirmed`, `media.rejected`, `media.deleted`, `product.media_attached|detached|reordered`.
13. **Límite por empleado**: máx. 50 intents PENDING vigentes (422 `MEDIA_PENDING_LIMIT_REACHED`) para acotar el abuso del bucket por un empleado comprometido.
14. **Fronteras**: `src/media/` (`MediaModule` con `MediaStoragePort`, adaptadores, `MediaUrlService` exportado, `MediaCleanupService` exportado, controladores admin, servicio de assets). El adjuntar/reordenar/desvincular vive en `src/products/` (reusa el bloqueo y la política de F11) y consume `MediaModule` sin ciclos. F16 y F17 usan `MediaUrlService.publicUrl(objectKey)` o el `url` ya persistido en
    `product_media.media_url`; F14 no implementa banners ni agregados.

## Desviaciones de BD respecto al DBML (el DBML no se edita)

`docs/references/monsushi_dbdiagram.dbml` solo define `app.product_media (id, product_id, media_url, alt_text, sort_order)`. La migración `0015_media_assets` (pendiente de aplicar por una persona) se aparta así, de forma incremental y no destructiva:

- **`app.media_assets` es una tabla nueva** (no existe en el DBML): registro de objetos subidos (clave, bucket, MIME, tamaño, checksum, estado, caducidad).
- **`product_media.asset_id` es una columna nueva**, nullable, FK `ON DELETE RESTRICT`: un asset en uso no se puede borrar y las filas previas con URL externa siguen válidas. `media_url` sigue siendo `NOT NULL` y se deriva del asset al adjuntar.
- **`media_assets.created_by_staff_id` tiene FK a `staff_users` con `ON DELETE SET NULL`**: el asset sobrevive a la baja del empleado (no hay `RESTRICT` ni `CASCADE`).
- **UNIQUE PARCIAL** `(kind, checksum_sha256) WHERE status = 'READY'`: deduplica solo contenido confirmado; varios `PENDING` con el mismo checksum son válidos y el segundo en confirmarse recibe `23505`, que el servicio resuelve reutilizando el asset READY.
- **Sin restricción única `(product_id, asset_id)`**: `MEDIA_ALREADY_ATTACHED` la impone el servicio bajo el bloqueo de la fila del producto (`FOR NO KEY UPDATE`), igual que el tope de 8; un asset puede estar en varios productos.
- **`kind` ampliable solo por migración**: `CHECK (kind IN ('PRODUCT_IMAGE'))`; F16 (banners) deberá reemplazar `media_assets_kind_chk`.
- **Tope de 5 MiB también en un `CHECK`** (`size_bytes BETWEEN 1 AND 5242880`): `MEDIA_MAX_BYTES` solo puede bajar el tope; subirlo exige migración, no solo configuración.
- Índices: parcial `(status, expires_at) WHERE status = 'PENDING'` (purga), `(created_at DESC, id)` (listado) y `product_media(asset_id)` (FK `RESTRICT` y consulta de usos). RLS habilitada sin políticas y `REVOKE` a `anon`/`authenticated` (solo vía API).

## Notas de implementación de la API (F14)

Decisiones tomadas al implementar que la spec dejaba abiertas (sin cambiar el contrato):

- `complete` falla **cerrado** si `HeadObject` no devuelve el checksum SHA-256 (se trata como `MEDIA_CONTENT_MISMATCH`: objeto y fila borrados). Hay que verificar con R2 real que `HeadObject` con `ChecksumMode=ENABLED` lo informa; si no, se reevaluará (ver «A verificar»).
- `storageMode` de un asset en las lecturas (`GET /v1/admin/media[/{id}]`, intents, `complete`) es `MOCK` solo con el adaptador simulado; con el adaptador real **o sin almacenamiento** es `R2`. Sin base pública (`unavailable`) el `url` de un asset READY es `null` (el contrato lo documenta solo para PENDING): la biblioteca sigue legible sin inventar un dominio, y adjuntar un asset sin base pública responde 503 `MEDIA_STORAGE_UNAVAILABLE`.
- Editar el texto alternativo de una imagen audita `product.media_updated` (`productId`, `mediaId`, `changedFields: ['altText']`; nunca el texto). La spec solo nombraba `attached|detached|reordered`.
- Una URL bajo el **host** de `R2_PUBLIC_BASE_URL` que no sea exactamente `publicUrl(object_key)` de un asset READY (con query, otra ruta, PENDING, inexistente) se rechaza con 422 `PRODUCT_MEDIA_INVALID` también en `POST /v1/admin/products`, no solo en `PATCH`, para que no se pueda saltar la validación al crear.
- Los errores del proveedor se reducen a nombre, código y estado HTTP (`MediaStorageError`); jamás el mensaje del SDK (puede contener la URL firmada o credenciales). Se registran con esa etiqueta y la respuesta es 503 `MEDIA_STORAGE_UNAVAILABLE` con mensaje fijo. El cliente S3 no reintenta (`maxAttempts: 1`) y usa `requestChecksumCalculation/responseChecksumValidation = WHEN_REQUIRED` (a verificar con R2).
- El tope de 50 PENDING se comprueba dentro de la transacción del intent pero no serializa a intents concurrentes del mismo empleado: puede excederse por unos pocos en una carrera. Acotar el abuso, no un límite exacto.
- La URL firmada incluye `X-Amz-SignedHeaders=cache-control;content-type;host;x-amz-checksum-sha256` (comprobado con el SDK sin red); que R2 acepte esas cabeceras firmadas y aplique el checksum sigue sin verificar.

### Endurecimiento tras revisión de seguridad y rendimiento (API)

- **Tamaño firmado**: el PUT firma `content-length` (= `sizeBytes` declarado) además de `content-type`, `cache-control` y `x-amz-checksum-sha256`; el intent devuelve `Content-Length` en `headers`. **El navegador fija `Content-Length` por sí solo**: el cliente NO debe intentar enviarlo manualmente (con `fetch` o XHR es una cabecera prohibida y se ignora; basta enviar el cuerpo `Blob`/`File` exacto, y con XHR no llamar a `setRequestHeader('Content-Length', …)`). Los demás `headers` se envían tal cual. **A verificar con R2 real** que acepta `content-length` firmado y rechaza un cuerpo de otro tamaño; `complete` mantiene la comprobación de tamaño con `HeadObject` como defensa.
- **Purga y rechazo**: un PENDING solo se purga (objeto y fila) cuando `expires_at < now - 5 min` (margen = TTL máximo de 300 s): nunca se borra un objeto cuyo PUT firmado pueda seguir vigente. El rechazo (`MEDIA_CONTENT_MISMATCH`) borra el objeto de inmediato (contenido no válido no debe quedar público) pero **conserva la fila PENDING con `expires_at = now`** (ya no confirmable; un `complete` posterior responde 410), de modo que la purga vuelva a borrar el objeto si el PUT aún vigente lo recrea. Esto matiza el texto «objeto y asset eliminados» del contrato: el asset deja de ser utilizable al instante y su fila desaparece en la purga. `markReady` exige `expires_at > now` en el `WHERE`; si no actualiza porque venció (carrera con la purga) responde 410 `MEDIA_UPLOAD_EXPIRED`.
- **`If-None-Match` NO se firma**: no está verificado en R2; queda como mejora a probar en el sandbox (impediría sobrescribir un objeto ya subido con el mismo PUT firmado).
- **Límites por actor** (patrón de F02 `staff-mfa-reset`, `ActorThrottlerGuard` tras el JWT) más el límite global por IP de cada ruta: `upload-intents` 20/min por actor (60/min por IP), `complete` 60/min (120), `DELETE /media/{id}` 30/min (60). 429 `RATE_LIMITED`.
- **Tope de PENDING serializado**: el intent toma `pg_advisory_xact_lock(hashtext('media-intents:<staffId>'))` antes de contar e insertar (lock → count → insert en la misma transacción): el tope de 50 ya no se rebasa por concurrencia.
- **Purga en la petición**: lote de 20 (`PURGE_BATCH`) con presupuesto total de 3 s, ejecutada **después** de comprobar el tope y de crear el intent. El job completo (lotes grandes, huérfanos por listado del bucket) sigue pendiente.
- **SDK de AWS cargado de forma perezosa** (`await import`) solo con el modo `r2` (fábrica asíncrona del provider): `mock` y `unavailable` no lo cargan (hay prueba). `MediaStorageError` vive en un archivo sin SDK.

### Decisiones de confianza y alcance (revisión de seguridad)

- **Mismo nivel de confianza entre empleados**: cualquier empleado con `catalog.update` global puede completar, rechazar o borrar los PENDING de otro empleado. El catálogo es global y todos ellos pueden ya editar cualquier producto; el límite por empleado de 50 PENDING acota el abuso, no aísla a los empleados entre sí.
- **Lecturas con `catalog.read`** (biblioteca y detalle, cualquier alcance): coherente con F11 (`GET /v1/admin/products`).
- **Dedup solo tras `assertGlobal`**: la respuesta `deduplicated` (que revela que un contenido ya existe) solo se calcula después de comprobar el permiso y el alcance global; nunca antes del 403.
- **Coherencia `media_url` ↔ asset**: la garantiza el servicio (la URL se deriva siempre de la clave del asset al adjuntar y de la coincidencia exacta con `publicUrl` en `PATCH`/`POST` de producto). Un trigger de BD que impida un `media_url` distinto de `base || object_key` cuando hay `asset_id` queda como mejora futura opcional (cambiar el dominio exigiría desactivarlo durante el `UPDATE` de datos).
- **Dominio público de medios**: debe servirse con `X-Content-Type-Options: nosniff` y **separado** del origen de la aplicación/backoffice (otro host, no un subpath), para que un objeto con contenido activo que superase las validaciones no se ejecute en el origen de la app. Ver `docs/integrations/cloudflare-r2.md`.

## Consecuencias

- **Cambiar de dominio** (`R2_PUBLIC_BASE_URL`) deja `product_media.media_url` desactualizada: exige un `UPDATE` de datos (`media_url = nuevaBase || '/' || object_key` para filas con `asset_id`). Es el precio de guardar una URL estable en lugar de derivarla en cada lectura (F11/F17 leen `media_url` tal cual).
- Las URLs prefirmadas solo funcionan contra el endpoint S3 de la cuenta, no contra el dominio personalizado (según la documentación de Cloudflare; **a verificar**). El dominio personalizado solo sirve lecturas públicas.
- El tope de 5 MiB vive también en un `CHECK`: subirlo exige migración, no solo cambiar la variable.
- El PUT firmado sigue siendo válido hasta su expiración incluso después de `complete`; como el checksum SHA-256 está firmado, solo admitiría los mismos bytes. Si la verificación real mostrase que R2 no aplica el checksum firmado, `complete` es la defensa (HeadObject + firma) y se debe reevaluar (p. ej. `If-None-Match: *`).
- Posibles huérfanos en R2 (borrado de objeto fallido, intents caducados con bytes subidos): sin job periódico en F14. Se acepta con la advertencia en logs; el job queda pendiente.
- Dedup revela a un empleado autorizado que un contenido ya existe; es información interna, no pública.
- Sin cron, los PENDING caducados se acumulan hasta el siguiente intent (purga perezosa acotada a un lote).
- Mientras R2 esté `BLOCKED_EXTERNAL`, el gestor responde 503 en subida y la API conserva `PATCH media` con URLs externas.

## Alternativas descartadas

Subir bytes a través de NestJS; firmar SigV4 a mano; guardar URL firmada o URL pública derivada en la tabla; Cloudflare Image Resizing o `/cdn-cgi/image` (coste y dependencia); variantes en servidor (sharp, colas); aceptar SVG o GIF; confiar en el MIME o la extensión del cliente; una columna `original_name`; borrar el objeto antes que la fila;
cron o cola en F14; Redis; permiso nuevo `media.*`; bucket único para público y privado.

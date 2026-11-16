# Cloudflare R2 (medios)

**Estado**: `BLOCKED_EXTERNAL`. No hay bucket, dominio personalizado, token ni CORS configurados ni verificados; ninguna llamada real a R2 se ha ejecutado. Hasta completar la lista de verificación, el código de F14 contra R2 es **no probado** y el adaptador por defecto es `UnavailableMediaStorageAdapter`
(503 `MEDIA_STORAGE_UNAVAILABLE`). Decisiones: `docs/adr/0020-medios-cloudflare-r2.md`; spec: `specs/015-cloudflare-r2-media/spec.md`.

## Propósito y arquitectura

Almacenar imágenes de producto (y más adelante banners, F16) en un bucket público de R2 publicado por un dominio personalizado. La API autoriza y firma un PUT S3 temporal; el navegador sube directo a R2; la API confirma (`HeadObject` + lectura de los primeros bytes). Puerto `MediaStoragePort` con tres adaptadores:

| Adaptador                        | Cuándo                                                                                         | Estado                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `UnavailableMediaStorageAdapter` | Defecto: faltan variables R2                                                                   | Operaciones de subida/confirmación/borrado => 503          |
| `MockMediaStorageAdapter`        | `MEDIA_STORAGE_ADAPTER=mock` y `NODE_ENV` development/test; con `production` la API no arranca | `MOCK_READY`; `storageMode=MOCK`; nunca confirma nada real |
| `R2MediaStorageAdapter`          | Variables R2 completas                                                                         | `BLOCKED_EXTERNAL` hasta verificar con credenciales        |

## Configuración pendiente en Cloudflare (humana; no realizada)

Nada de esto se ha hecho. No se registran ni se piden credenciales en el repo. Los nombres entre `<...>` son marcadores; **no hay dominio decidido**.

1. **Bucket público** (nombre p. ej. `<bucket-medios>`, uno por entorno: desarrollo, preparación, producción). Un **segundo bucket privado** (sin dominio ni acceso público) queda reservado para medios privados; F14 no lo usa.
2. **Dominio personalizado / CDN público** conectado al bucket (`<cdn-host>` de una zona en la cuenta de Cloudflare). `R2_PUBLIC_BASE_URL=https://<cdn-host>` (sin barra final). No usar el subdominio de desarrollo `r2.dev` en producción (Cloudflare lo documenta como para desarrollo y con límites; **a confirmar** en su documentación vigente).
   Las URLs prefirmadas funcionan contra el endpoint S3 `https://<account-id>.r2.cloudflarestorage.com`, **no** contra el dominio personalizado (según la documentación de Cloudflare; **a verificar**).
3. **CORS del bucket** para el `PUT` directo desde el navegador. Orígenes: solo el/los orígenes exactos del backoffice (`https://<origen-backoffice>` y, en desarrollo, `http://localhost:3000`); métodos `PUT` (y `GET`/`HEAD` si la tienda leerá con CORS); cabeceras permitidas: `content-type`, `cache-control`, `x-amz-checksum-sha256`
   (y las `x-amz-*` que el SDK incluya al firmar; verificar en la prueba real); `ExposeHeaders`: `ETag`; `MaxAgeSeconds` moderado. Sin comodín `*` en orígenes de escritura. El formato exacto de la regla se toma del panel/documentación de Cloudflare al configurarlo.
4. **Token API S3 de permisos mínimos**: credenciales S3 (Access Key ID + Secret) de un token **limitado al bucket público**, con permiso de lectura y escritura de objetos (necesario para `PutObject`, `HeadObject`, `GetObject` con rango, `DeleteObject`), sin administración de buckets, sin acceso al bucket privado ni a otras cuentas/zonas. Un token por entorno; rotación documentada.
   Los valores van a `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` en el gestor de secretos del hosting de la API (ADR-0006), nunca al repo, a la web ni a `NEXT_PUBLIC_*`.
5. **Reglas de caché**: el PUT firma `Cache-Control: public, max-age=31536000, immutable` (la clave nunca se reutiliza). En Cloudflare: regla de caché para el hostname del CDN con «elegible para caché» y TTL de borde que respete las cabeceras de origen (o equivalente); sin transformación de imágenes (`/cdn-cgi/image` no se usa); sin «Always Online»/modificaciones
   de contenido. Verificar con `cf-cache-status: HIT` tras la segunda lectura.
6. **Notificaciones/ciclo de vida** (opcional, posterior): regla de ciclo de vida para abortar cargas multipart incompletas (F14 usa PUT simple; no aplica) y revisar objetos huérfanos con el job pendiente.

## Variables de entorno (solo servidor)

`R2_ACCOUNT_ID` o `R2_ENDPOINT` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_PUBLIC_BASE_URL` · `R2_REGION` (`auto`) · `MEDIA_MAX_BYTES` (5 MiB) · `MEDIA_UPLOAD_TTL_SECONDS` (300) · `MEDIA_STORAGE_ADAPTER` (`r2`|`mock`, opcional). Validación todo-o-nada (spec 015, D3).
Además, `PRODUCT_MEDIA_ALLOWED_HOSTS` debería contener el host de `R2_PUBLIC_BASE_URL` (la API lo añade a la lista efectiva si la lista no está vacía). Nada de esto lleva el prefijo `NEXT_PUBLIC_`.

## Dominio público de medios: aislamiento y cabeceras

- El dominio personalizado del bucket debe ser **otro host** que el de la tienda y el backoffice (p. ej. un subdominio dedicado a medios), nunca una ruta bajo el origen de la aplicación: así cualquier contenido que llegase al bucket no comparte origen (cookies, `localStorage`, CSP) con la app.
- Debe responder con **`X-Content-Type-Options: nosniff`** (regla de transformación de cabeceras de respuesta en Cloudflare o equivalente) y con el `Content-Type` real del objeto; sin `Content-Disposition` que lo convierta en documento. Verificarlo en la lista de abajo.
- La API ya limita los tipos a JPEG/PNG/WebP/AVIF y valida la firma real, pero `nosniff` y la separación de origen son la defensa en profundidad.
- `Content-Length` firmado: el intent devuelve `Content-Length` entre los `headers` solo como información; **el navegador lo fija solo** y el cliente no debe enviarlo manualmente (con XHR, no llamar a `setRequestHeader('Content-Length', …)`). A verificar con R2 real que lo acepta firmado.
- `If-None-Match: *` (no sobrescribir) **no se firma**: no está verificado en R2; mejora a probar en sandbox.

## Lo que NO se asume (a confirmar con la documentación oficial y pruebas)

Comportamiento exacto de R2 con presigned PUT y las cabeceras firmadas (`x-amz-checksum-sha256`, `Cache-Control`, `Content-Type`); si `Content-Length` puede firmarse (si no, el tamaño se valida solo con `HeadObject` tras la subida); soporte de `GET` con `Range` y de `HeadObject` con checksum; formato de errores; límites de tamaño por PUT;
precios y cuotas por operación (no se citan cifras); latencia desde el hosting de la API; política de reintentos del SDK. Cada punto se prueba con credenciales reales en un bucket de pruebas antes de considerarlo verificado.

## Lista de verificación con credenciales reales (pasar a `SANDBOX_VERIFIED`)

Ejecutar en un bucket de pruebas, con un token de pruebas, por una persona autorizada:

1. La API arranca con el grupo R2 completo y con `R2_*` parcial falla de forma clara sin imprimir valores; sin variables arranca en modo `unavailable` y `upload-intents` responde 503.
2. `upload-intents` devuelve `uploadUrl` con vigencia <= 300 s y `headers` firmados (incluido `content-length` = tamaño declarado: R2 debe rechazar un cuerpo de otro tamaño); la respuesta es `no-store`; la URL no aparece en logs ni en la tabla.
3. `PUT` desde el origen del backoffice con los `headers` exactos: preflight CORS correcto; sin los headers o con `Content-Type` distinto => R2 rechaza; con cuerpo distinto del checksum => R2 rechaza; tras la expiración => rechaza; desde un origen no autorizado => bloqueado por CORS.
4. `complete`: ok para JPEG/PNG/WebP/AVIF válidos; `MEDIA_OBJECT_MISSING` sin subir; `MEDIA_CONTENT_MISMATCH` con un HTML renombrado `.png` declarado como `image/png` (objeto y fila borrados); tamaño distinto; `MEDIA_UPLOAD_EXPIRED` tras la vigencia; repetir `complete` => 200.
5. `GET https://<cdn-host>/<object_key>` devuelve la imagen con `Content-Type` correcto, `X-Content-Type-Options: nosniff`, `Cache-Control` inmutable y `cf-cache-status: HIT` en la segunda lectura; el objeto NO es listable públicamente; un intento de `PUT`/`DELETE` anónimo al dominio público falla.
6. `DELETE /v1/admin/media/{id}`: 409 si está en uso; si no, el objeto desaparece del bucket y la URL pública responde 404 tras la caducidad de caché (o se purga).
7. Con el token de pruebas: no puede listar ni escribir en otro bucket ni administrar buckets.
8. Ningún secreto en bundle web (`pnpm check` secretos) ni en respuestas de la API.
9. Medición: tamaño medio subido (WebP, <= 1600 px) y tiempo de `complete`.

Si algún punto falla, F14 sigue `BLOCKED_EXTERNAL` y se registra la discrepancia en el ADR-0020 (no se ajusta la documentación para ocultarla).

## Seguridad

Secretos solo en el gestor de secretos del hosting; el navegador nunca recibe claves, solo una URL PUT de corta vida; la URL firmada no se persiste ni se registra; MIME en lista blanca (SVG/GIF excluidos); firma real por bytes iniciales; nombre del cliente ignorado; clave `products/<yyyy>/<uuid>.<ext>` generada por el servidor; CORS sin comodines de escritura;
token de mínimo privilegio; auditoría sin PII. La CSP completa (Etapa 3) deberá permitir `connect-src` al endpoint S3 e `img-src` al host del CDN.

## Errores y reintentos

Errores del proveedor se traducen a 503 `MEDIA_STORAGE_UNAVAILABLE` con mensaje fijo (sin detalle del proveedor ni de la URL). Sin reintentos automáticos de escritura en la API; el cliente reintenta `complete` (idempotente) o solicita otro intent. Clasificar errores reintentables vs. definitivos según la documentación de R2 al verificar.

## Pendiente

Credenciales y bucket por entorno · dominio/CDN y reglas de caché · CORS · job periódico `purgeExpired()` + conciliación de huérfanos · medios privados (segundo bucket + URL GET firmada) · variantes responsive del lado servidor · CSP completa.

# ADR-0014 Favoritos de clientes: tabla sin FK a productos, puerto de catálogo y contrato único de lectura

**Estado**: **propuesta** (2026-11-14, F06). Se acepta al fusionar `specs/009-customer-favorites`.

**Contexto**: el DBML define `app.customer_favorites (customer_id, product_id)` con FK a `customers` (cascada) y a `products`. En el repo no existen
`products`/`categories` (ni migraciones ni Prisma; F10/F11 no existen en ninguna rama), y la web guarda hoy los favoritos como `string[]` bajo una clave
TanStack no aislada por identidad, con mocks. El catálogo real llegará con F11. Hace falta una API de favoritos segura (propietario desde el JWT) sin
inventar un catálogo ni guardar ids no validados, y un contrato que sirva a la lista y a los corazones sin N peticiones.

## Decisión

1. **Tabla sin FK a `products`** (migración `0009_customer_favorites`): FK a `customers ON DELETE CASCADE`, PK `(customer_id, product_id)`, `created_at`
   (nuevo respecto al DBML) e índice `(customer_id, created_at DESC, product_id)`; RLS sin políticas + `REVOKE` como 0006/0007. La FK a productos la
   añade F11 (`NOT VALID` + `VALIDATE`, tras revisar huérfanos) con **`ON DELETE CASCADE`** (el DBML decía sin acción): los productos se dan de baja por
   `active` (los favoritos se conservan y se muestran como no disponibles), y un borrado físico no debe quedar bloqueado por una tabla de conveniencia.
   El DBML de `docs/references` no se edita.
2. **Puerto `CatalogProductsPort`** (consulta en lote por ids; resumen público mínimo; `CatalogUnavailableError`) con adaptador por defecto
   `UnavailableCatalogAdapter` hasta F11. **PUT** valida siempre contra el puerto: producto no publicado/inexistente ⇒ 404 `PRODUCT_NOT_FOUND`; catálogo
   no disponible ⇒ **503 `CATALOG_UNAVAILABLE`** y nunca se guarda un id sin validar (la tabla estará vacía en entornos reales hasta F11). **GET** degrada
   de forma honesta (`catalogStatus=UNAVAILABLE`, items `UNKNOWN` con `product=null`); **DELETE** no usa el catálogo. Un producto retirado o despublicado no
   se borra del favorito. Se evaluaron: aceptar cualquier UUID (almacena basura y ocupa el tope; rechazado) y simular un catálogo (inventa datos; rechazado).
3. **El 503 expone `code`** mediante una lista blanca acotada en el filtro central (`CATALOG_UNAVAILABLE`); el resto de 5xx sigue sin `code`.
4. **Contrato de lectura único**: `GET /v1/me/favorites` devuelve `items` (página) y `favoriteProductIds` completo (≤ 200) más `total` y `limit`;
   `pageSize=0` omite `items` y el catálogo. Sirve a la lista y al estado de todos los corazones sin endpoint por producto ni N peticiones. Sin precios ni
   copia de datos del catálogo en la relación; el precio y la disponibilidad por sucursal los resuelve el catálogo/F13.
5. **Idempotencia y concurrencia**: `PUT`/`DELETE` ⇒ 204 siempre (sin 409 por doble clic); inserción `ON CONFLICT DO NOTHING`. Tope **200** por cliente,
   **exacto** bajo concurrencia serializando las altas con `SELECT … FROM customers FOR NO KEY UPDATE` dentro de la transacción de inserción (no bloquea
   la FK de otros inserts); el catálogo se consulta antes, fuera de la transacción. Sin advisory locks ni triggers. Se descartó un `CHECK`/trigger de conteo (no
   es exacto sin bloqueo y complica la BD).
6. **Seguridad**: propietario siempre del JWT (sin `customerId` en ruta/cuerpo); solo cliente (sin `@RequireStaff` ni MFA; un empleado usa sus favoritos como
   cliente); perfil creado perezosamente con la regla de F04 (`IdentityService.ensureCustomer`); sin otro servicio de clientes. Respuestas
   `Cache-Control: private, no-store`; sin auditoría por clic; logs sin PII; throttle por ruta (120/60/60 por minuto por IP; por IP, no por usuario: limitación conocida).
7. **F17**: se exporta `CustomerFavoritesReader.getFavoriteProductIds(customerId)`; el contexto de F04 **no** cambia en F06 (`favoritesCount` y retirar
   `favorites` de `pendingSections` lo hace F17).
8. **Web**: una única fuente remota con claves `['customer', scope, 'favorites', …]` aisladas por identidad (limpieza al cerrar sesión/cambiar cuenta),
   mutación optimista con `cancelQueries`, rollback por producto y sin doble envío; visitante: el corazón abre el login (no crea nada, sin favoritos locales
   de invitado); Mis favoritos une los ids de la API con el `Product` del catálogo existente (sin duplicarlo ni copiar precios). Sin carrito hasta F18.

## Consecuencias

- Migración `0009` incremental y no destructiva (1 tabla). Hasta F11 el flujo real no existe: la API es `API_IMPLEMENTED` con catálogo `BLOCKED` por F11 (dependencia interna) y la web
  es `MOCK_ONLY`; ningún documento puede declarar el flujo de extremo a extremo.
- F11 debe implementar el puerto (lote, sin precios), añadir la FK y el índice de producto, y retirar `UnavailableCatalogAdapter` del módulo.
- Se cambia el filtro central de errores (lista blanca de un código 5xx) y la copia web `fav.guestNote`.
- La web retira `queryKeys.account.favorites` y el contrato `string[]` de favoritos; los contadores usan `total`.
- Pendientes: límite por cliente en el throttler, favoritos de invitado (no se hacen), intención pendiente tras el login, `favoritesCount` en F17.
- Sin dependencias nuevas: ni Redis, ni colas, ni caché compartida, ni librerías.

/* AUTO-GENERADO desde openapi/openapi.yaml. No editar: ejecutar `pnpm contracts:generate`. */
export interface paths {
    "/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness probe (interno, protegido con x-health-token)
         * @description Verifica la conexión a PostgreSQL y que exista el esquema `app`.
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contexto de identidad y autorización del token actual
         * @description AUTENTICACIÓN ≠ AUTORIZACIÓN. Verifica el JWT de Supabase Auth (firma, emisor, audiencia,
         *     expiración y sujeto) y devuelve lo que el SERVIDOR sabe de esa identidad: si es personal activo y si
         *     su sesión ya cumple MFA (`aal2`, leído del JWT verificado). Funciona con sesión `aal1` (es el punto
         *     de entrada para configurar/verificar el segundo factor) pero NO devuelve roles, permisos ni
         *     sucursales hasta `aal2` (`access = GRANTED`). La web lo usa solo para mostrar/ocultar UI; cada
         *     endpoint vuelve a autorizar. En el primer acceso de un empleado preregistrado (`staff_users` sin
         *     `auth_user_id`) vincula la identidad por correo verificado con Google.
         */
        get: operations["getAuthContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/me/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contexto administrativo del empleado (requiere aal2)
         * @description Primer endpoint del backoffice. Exige, en este orden: JWT válido → personal activo con asignación
         *     → sesión `aal2` (segundo factor TOTP verificado por Supabase Auth). Devuelve perfil básico, roles,
         *     sucursales y permisos efectivos calculados en el servidor. Convención: TODA ruta administrativa
         *     futura usa `@RequireStaff(...)` y hereda el mismo requisito `aal2`.
         */
        get: operations["getAdminContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Perfil del cliente autenticado
         * @description Devuelve el perfil de cliente (`app.customers`) del `auth.users.id` del token. Si todavía no existe
         *     lo crea de forma idempotente a partir de las claims (el mismo UUID puede ser también empleado).
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Actualiza nombre y teléfono del perfil del cliente autenticado
         * @description Actualización parcial: los campos omitidos no cambian. El cliente se identifica solo por el JWT; no
         *     existe forma de elegir otra identidad. El correo, la identidad, los roles y los permisos NO se pueden
         *     modificar aquí (400 por campo no permitido).
         */
        patch: operations["updateMe"];
        trace?: never;
    };
    "/v1/me/storefront": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contexto agregado de Mi cuenta (una sola solicitud)
         * @description Devuelve la identidad (Supabase Auth), el perfil comercial y las secciones de Mi cuenta que aún
         *     no tienen contrato (`pendingSections`). Nunca representa como `0` datos de F05, F06 o F23 que
         *     todavía no existen. Crea el perfil de forma idempotente si todavía no existe.
         */
        get: operations["getCustomerStorefront"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Historial de pedidos del cliente autenticado (paginado por cursor, ligero)
         * @description F23 (spec 024, ADR-0029). SOLO los pedidos del cliente del JWT: el propietario sale del `sub` del token (join `orders.customer_id` -> `customers.auth_user_id`);
         *     no existe `customerId` en la ruta, la consulta ni el cuerpo. Los pedidos de INVITADO (`customer_id` NULL) NUNCA aparecen aquí (no hay vinculación
         *     automática por correo o teléfono, P59/P77): un invitado consulta cada pedido por separado con `X-Order-Token` (`getOrder`, `getOrderTracking`, `getOrderReceipt`).
         *     Un usuario sin fila de cliente recibe `items: []` (la lectura no crea el perfil). Un JWT inválido => 401.
         *     LISTADO ligero: SIN líneas, modificadores, promociones, dirección ni historial (el detalle es `getOrder`, que se reutiliza; no existe `/v1/me/orders/{id}`).
         *     `itemCount` = unidades (suma de cantidades) agregadas en SQL. Se incluyen TODOS los estados, también `rejected` y `cancelled` (P76); el motivo interno
         *     de rechazo/cancelación NUNCA se expone (P64). Filtros EN SQL: `status` (lista separada por comas del catálogo), `branchId`, `from`/`to` (instantes de `placedAt`;
         *     sin ellos se pagina todo el historial; con ambos el rango máximo es 366 días, si no 400). Orden FIJO `placedAt` descendente, `id` descendente; paginación por
         *     CURSOR opaco (`nextCursor`; `null` = última página); un cursor alterado => 400 `ORDER_CURSOR_INVALID` (el alcance se aplica SIEMPRE en la consulta, así que
         *     manipularlo no revela nada). Sin conteo total. `Cache-Control: private, no-store`, `Vary: Authorization`, sin `ETag`.
         */
        get: operations["listMyOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Favoritos del cliente autenticado (lista paginada + ids completos para los corazones)
         * @description F06. El propietario sale SIEMPRE del JWT (no existe `customerId` en la ruta, la consulta ni el cuerpo). Solo requiere
         *     sesión de cliente: ni rol de personal ni MFA (un empleado usa SUS favoritos como cliente). Sin fila de cliente, la lista
         *     es vacía y NO se crea el perfil (solo `addMyFavorite` lo crea, idempotente).
         *
         *     Una sola respuesta sirve a la lista y al estado `isFavorite` de todas las tarjetas: `favoriteProductIds` trae TODOS los
         *     ids del cliente (acotado por `limit`, 200), más recientes primero, y `items` la página pedida. Con `pageSize=0` no se
         *     devuelven `items` ni se consulta el catálogo (uso de los corazones: respuesta barata). No hay endpoint por producto.
         *
         *     `items[].product` es un resumen público mínimo (id, nombre, imagen, categoría) que entrega el catálogo; NUNCA precios ni
         *     disponibilidad por sucursal (los resuelve el catálogo/F13 del lado del cliente). Un producto retirado, despublicado o
         *     desconocido NO se borra del favorito: se devuelve con `status` y `product = null` (sin datos internos).
         *
         *     Degradación honesta: mientras el catálogo real no exista (F11) o falle/expire la consulta, responde 200 con
         *     `catalogStatus = UNAVAILABLE` y cada item con `status = UNKNOWN` y `product = null`; `productId`, `addedAt`,
         *     `favoriteProductIds` y `total` siguen siendo reales (vienen de la base de datos). Nunca se inventan datos de producto.
         *
         *     Orden: `addedAt` descendente, desempate por `productId` ascendente. Respuesta `Cache-Control: private, no-store`
         *     (datos personales: jamás en CDN ni caché compartida).
         */
        get: operations["listMyFavorites"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/favorites/{productId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Marca un producto como favorito (idempotente)
         * @description F06. Sin cuerpo; el propietario sale del JWT. Idempotente: marcar dos veces (o dos clics/solicitudes simultáneas) es
         *     éxito igual, sin 409; `addedAt` no cambia si ya era favorito. Éxito = `204` siempre (creado o ya existente).
         *     El producto se valida contra el catálogo ANTES de guardar: un id no validado nunca se persiste. Producto inexistente,
         *     despublicado o retirado => `404 PRODUCT_NOT_FOUND` (no se distingue). Catálogo no disponible (hoy y hasta F11, o
         *     fallo/timeout) => `503 CATALOG_UNAVAILABLE`, sin escribir. Tope de favoritos por cliente (`limit` = 200): al
         *     alcanzarlo, un producto NUEVO => `422 FAVORITES_LIMIT_REACHED` (ya favorito => 204). El tope es exacto bajo
         *     concurrencia (se serializa por cliente; si el candado o el tiempo se agotan => `503 FAVORITES_BUSY`, reintentable). Crea el
         *     perfil de cliente si no existe (idempotente). Sin auditoría por clic. `Cache-Control: private, no-store`.
         */
        put: operations["addMyFavorite"];
        post?: never;
        /**
         * Quita un producto de los favoritos (idempotente)
         * @description F06. Sin cuerpo; el propietario sale del JWT, así que solo se puede borrar un favorito propio. Idempotente: si el
         *     producto no era favorito (o ya no existe en el catálogo) también es éxito `204`. No consulta el catálogo: funciona
         *     aunque no esté disponible. No crea el perfil de cliente (sin fila => 204). Sin auditoría por clic. `Cache-Control: private, no-store`.
         */
        delete: operations["removeMyFavorite"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/addresses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lista las direcciones del cliente autenticado
         * @description Solo las direcciones del cliente del JWT. Orden estable: predeterminada primero, luego por fecha de
         *     creación ascendente. Sin direcciones devuelve `items: []` (nunca una dirección de ejemplo).
         */
        get: operations["listMyAddresses"];
        put?: never;
        /**
         * Crea una dirección del cliente autenticado
         * @description Valida el municipio contra el catálogo de F09 y normaliza los textos. Límite: 10 direcciones por
         *     cliente (409 `ADDRESS_LIMIT_REACHED`). Duplicado = misma línea normalizada, municipio y zona (409
         *     `ADDRESS_DUPLICATE`); la referencia no interviene. Guardar una dirección NO valida cobertura ni tarifa.
         *
         *     Zona (ADR-0014): en la ciudad de Guatemala (municipio «Guatemala» del departamento «Guatemala», comparados por nombre
         *     sin tildes ni mayúsculas) la zona es OBLIGATORIA con formato «Zona N», N entero de 1 a 25; se normaliza (`zona 10`,
         *     ` Zona  10 ` -> `Zona 10`) y es la misma etiqueta que usa la cobertura (F09 `zoneLabel`). Faltante o vacía => 400
         *     `ZONE_REQUIRED`; fuera de formato o de rango => 400 `ZONE_INVALID` (ambos con `violations[0].path = zone`). En los
         *     demás municipios la zona es opcional y de texto libre (máx. 60).
         */
        post: operations["createMyAddress"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/addresses/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /**
         * Detalle de una dirección del cliente autenticado
         * @description Solo si la dirección pertenece al cliente del JWT. Ajena o inexistente = 404 (sin enumeración).
         */
        get: operations["getMyAddress"];
        put?: never;
        post?: never;
        /**
         * Elimina una dirección del cliente autenticado
         * @description Borrado físico de la dirección guardada. Si era la predeterminada, la reasigna de forma determinista
         *     (la más antigua restante, por `createdAt` e `id`); si no quedan, no hay predeterminada. Los pedidos
         *     confirmados conservan su snapshot (F20).
         */
        delete: operations["deleteMyAddress"];
        options?: never;
        head?: never;
        /**
         * Edita una dirección del cliente autenticado
         * @description Actualización parcial con las mismas reglas de creación (duplicado excluyendo esta dirección).
         *     No cambia el propietario ni la predeterminada. No modifica pedidos históricos (F20 guarda su snapshot).
         *     La regla de zona (`ZONE_REQUIRED`/`ZONE_INVALID`) se evalúa sobre el resultado fusionado: una dirección antigua de la
         *     ciudad de Guatemala sin zona (guardada antes de la regla; no se migra) debe incluir `zone` al editarse.
         */
        patch: operations["updateMyAddress"];
        trace?: never;
    };
    "/v1/me/addresses/{id}/default": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Marca una dirección como predeterminada
         * @description Operación explícita y transaccional: quita la predeterminada anterior y marca esta. Idempotente. Un
         *     índice único parcial en PostgreSQL impide dos predeterminadas aunque haya solicitudes concurrentes.
         */
        patch: operations["setDefaultMyAddress"];
        trace?: never;
    };
    "/v1/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sucursales activas (público)
         * @description F07. Solo sucursales con `active = true` y solo campos públicos, ordenadas por nombre y código.
         *     Sin autenticación. `active` es el estado ADMINISTRATIVO: NO implica que la sucursal esté abierta ahora
         *     ni que acepte pedidos (horarios y cierres: F08; pausa operativa: ver specs/005-branches-management).
         *     Lista vacía = ninguna sucursal activa. Caché compartida corta (`Cache-Control: public`).
         */
        get: operations["listPublicBranches"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/branches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle público de una sucursal activa
         * @description Sin autenticación. 404 si no existe o está inactiva (no se distingue; no revela sucursales internas).
         */
        get: operations["getPublicBranch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sucursales del backoffice (activas e inactivas, paginado)
         * @description F07/F03. Exige JWT → personal activo con `branches.read` → `aal2`. Solo devuelve las sucursales dentro
         *     del alcance del empleado (todas, o las de sus asignaciones). Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminBranches"];
        put?: never;
        /**
         * Crea una sucursal
         * @description F07/F03. Alta global: solo personal con `branches.create` con alcance global (`grants['branches.create'].allBranches`).
         *     El `code` se normaliza (minúsculas) y es inmutable después. Se audita en `app.audit_events`.
         *     No hay tope de sucursales en la API (el "5" del prototipo es una decisión comercial pendiente).
         */
        post: operations["createAdminBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle administrativo de una sucursal
         * @description Exige `branches.read`. 404 si no existe o está fuera del alcance del empleado (no se distingue). Respuesta con `Cache-Control: no-store`.
         */
        get: operations["getAdminBranch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Actualiza datos básicos de una sucursal
         * @description Exige `branches.update` en esa sucursal (404 fuera de alcance). Campos permitidos: nombre, teléfono, dirección y coordenadas. `code`, `active` y `createdAt` NO se aceptan
         *     (400): el estado se cambia con `PATCH .../status`. Los campos omitidos no se tocan; `phone`, `latitude` y
         *     `longitude` aceptan `null` para borrarlos. Latitud y longitud van juntas (ambas o ninguna). Un PATCH sin
         *     cambios reales no escribe ni audita.
         */
        patch: operations["updateAdminBranch"];
        trace?: never;
    };
    "/v1/admin/branches/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva una sucursal (estado administrativo)
         * @description Exige `branches.update` en esa sucursal. Cambia `active`. Desactivar exige `reason`. Idempotente: si ya tiene ese estado devuelve la sucursal sin
         *     escribir ni auditar. NO cancela ni reasigna pedidos en curso, ni borra empleados, productos o repartidores
         *     (política de pedidos en curso: pendiente con F20/F22).
         */
        patch: operations["updateAdminBranchStatus"];
        trace?: never;
    };
    "/v1/admin/staff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Empleados del backoffice (paginado)
         * @description F03. Exige `staff.read`. Solo lista empleados con al menos una asignación dentro del alcance de `staff.read` del
         *     solicitante (global = todos). `manageable` indica si el solicitante puede modificarlos (todas sus asignaciones dentro
         *     del alcance y rol otorgable). `branchId` filtra por asignación a esa sucursal exacta (las asignaciones globales no
         *     coinciden; usa `roleId` del rol admin). Respuesta `Cache-Control: no-store`. Nunca expone `authUserId`.
         */
        get: operations["listAdminStaff"];
        put?: never;
        /**
         * Preautoriza a un empleado (sin crear cuenta de Auth)
         * @description F03. Exige `staff.create` y `staff.assign_roles` en el alcance de CADA asignación solicitada. Crea una fila
         *     `staff_users` con `auth_user_id` NULL (`identityStatus = PENDING_LINK`) y sus asignaciones; la identidad se vincula
         *     sola en su primer inicio de sesión con Google (ADR-0009). No crea usuarios en Supabase Auth, no envía correos y
         *     `authUserId` no se acepta en la entrada. Correo normalizado a minúsculas. Regla del subconjunto: solo se otorgan roles
         *     cuyos permisos posee el solicitante en el alcance destino; `branchId` null (global) solo con rol `admin` y solo si el
         *     solicitante tiene alcance global. Se audita `staff.created` en la misma transacción.
         */
        post: operations["createAdminStaff"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/staff/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de un empleado
         * @description F03. Exige `staff.read`. 404 si no existe o no tiene ninguna asignación dentro del alcance del solicitante (no se
         *     distingue). Expone `identityStatus` y `linkedAt`, nunca `authUserId`. Respuesta `Cache-Control: no-store`.
         */
        get: operations["getAdminStaff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita nombre o correo de un empleado
         * @description F03. Exige `staff.update` y que el empleado sea gestionable por el solicitante. Nadie puede modificar su propia cuenta
         *     salvo `fullName`. El correo solo se puede cambiar mientras `identityStatus = PENDING_LINK`; en una identidad
         *     vinculada responde 409 (procedimiento de cambio de correo: pendiente). Auditoría `staff.updated` solo con diff real.
         */
        patch: operations["updateAdminStaff"];
        trace?: never;
    };
    "/v1/admin/staff/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva a un empleado
         * @description F03. Exige `staff.disable` (activar y desactivar) y que el empleado sea gestionable. Desactivar exige `reason`; un
         *     empleado no puede cambiar su propio estado. Corta el acceso en la siguiente solicitud (la API revalida en cada petición).
         *     No puede dejar al sistema sin al menos un administrador global activo y vinculado (409; bloqueo transaccional).
         *     Idempotente: sin cambio no escribe ni audita. Auditoría `staff.deactivated` / `staff.activated`.
         */
        patch: operations["updateAdminStaffStatus"];
        trace?: never;
    };
    "/v1/admin/staff/{id}/mfa-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reinicia el MFA TOTP de un empleado (recuperación por otro administrador)
         * @description F02 (recuperación de MFA). Elimina TODOS los factores MFA del empleado en Supabase Auth (Admin API, solo servidor
         *     con `SUPABASE_SERVICE_ROLE_KEY`) para que en su próximo inicio de sesión el flujo F02 existente le exija enrolar
         *     de nuevo (`MFA_REQUIRED` -> `/backoffice/mfa/setup`). No devuelve cuerpo ni datos del proveedor.
         *
         *     Autorización (permiso reutilizado: `staff.update`; sin permiso ni migración nuevos): JWT + personal activo + `aal2` +
         *     `staff.update` + **alcance GLOBAL** (solo el administrador global; un permiso en una sola sucursal NO basta -> 403).
         *     Nadie reinicia su propio MFA (403; el único administrador que pierde su factor usa el procedimiento manual del
         *     panel de Supabase, `docs/security/mfa.md`). El objetivo debe existir y estar visible en el alcance del actor
         *     (si no, 404 `STAFF_NOT_FOUND` sin distinguir). Debe estar vinculado (`linked`); si no, 409 `STAFF_NOT_LINKED`.
         *     Las denegaciones por regla (no global, a uno mismo) responden 403 genérico y se auditan como `staff.denied_escalation`.
         *
         *     Idempotente: sin factores devuelve 204 igualmente. Un empleado INACTIVO también es un objetivo válido (sirve para el
         *     procedimiento de robo de dispositivo: desactivar, reiniciar, reactivar). Throttle propio: 5 solicitudes por minuto por
         *     ACTOR autenticado y 20 por minuto por IP (429 `RATE_LIMITED`). Antes de llamar al proveedor se reevalúa al actor y se
         *     audita la intención `staff.mfa_reset_requested`. Se eliminan como máximo 20 factores por solicitud (si hay más: 502).
         *     El proveedor tiene un plazo total de 15 s (si se agota: 502). Auditoría `staff.mfa_reset` (actor, objetivo y
         *     `factorsRemoved`; SIN PII ni secretos) y, si el proveedor falla, `staff.mfa_reset_failed` (solo `factorsRemoved` parcial y
         *     una categoría fija de error). Respuesta `no-store`.
         *
         *     Sin `SUPABASE_SERVICE_ROLE_KEY` configurada: 503 `MFA_RESET_UNAVAILABLE`. Fallo del proveedor: 502 `MFA_RESET_FAILED`
         *     (mensaje fijo; nunca se filtra el detalle del proveedor). Ambos `code` son públicos en 5xx. Reintentar es seguro.
         *     Un token `aal2` ya emitido al empleado puede seguir vigente hasta su `exp` (ver `docs/security/mfa.md`).
         */
        post: operations["resetAdminStaffMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/staff/{id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reemplaza TODAS las asignaciones de un empleado
         * @description F03. Exige `staff.assign_roles`. Reemplazo transaccional completo (al menos 1, sin duplicados). Cada asignación
         *     añadida O retirada debe ser otorgable por el solicitante (regla del subconjunto en su alcance: posee todos los permisos
         *     del rol en esa sucursal); `branchId` null solo con rol `admin` (y `admin` solo global); la sucursal debe existir y estar
         *     activa. Nadie modifica sus propias asignaciones. No puede dejar al sistema sin administrador global activo y vinculado
         *     (409). Idempotente: sin cambio no escribe ni audita. Auditoría `staff.assignments_changed` (diff).
         */
        put: operations["replaceAdminStaffAssignments"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Roles y sus permisos
         * @description F03. Exige `roles.read`. Catálogo acotado (sin paginación: pocos roles; los roles personalizados están pendientes).
         *     Incluye `isSystem` (no editable) y cuántos empleados activos lo tienen asignado.
         */
        get: operations["listAdminRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de un rol
         * @description F03. Exige `roles.read`.
         */
        get: operations["getAdminRole"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/roles/{id}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reemplaza los permisos de un rol
         * @description F03. Exige `roles.manage`. Reemplazo completo. Los roles `isSystem` (hoy `admin`) NO se editan (409). Regla del
         *     subconjunto: cada permiso AÑADIDO debe poseerlo el solicitante con alcance global (el rol aplica a todas las
         *     sucursales donde se asigne). Idempotente. Auditoría `role.permissions_changed` con permisos añadidos/retirados y
         *     empleados afectados, en la misma transacción. Las nuevas decisiones rigen en la siguiente solicitud (sin caché).
         */
        put: operations["replaceAdminRolePermissions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Catálogo de permisos agrupado por módulo
         * @description F03. Exige `roles.read`. Catálogo fijo sembrado por migración (los permisos no se crean por API).
         */
        get: operations["listAdminPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/branches/{id}/hours": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Horario semanal público y próximos cierres de una sucursal activa
         * @description F08. Sin autenticación. Horario semanal en HORA LOCAL del restaurante (`timezone`, `America/Guatemala`), `weekday`
         *     ISO 1=lunes … 7=domingo, intervalos semiabiertos `[opensAt, closesAt)`. Siempre 7 días, ordenados por `weekday`, con
         *     sus intervalos ordenados; `intervals: []` = sin atención ese día. `upcomingClosures` (máx. 10, próximos 30 días) NO
         *     incluye el motivo. Una sucursal sin ningún intervalo responde 200 con los 7 días vacíos (la disponibilidad dirá
         *     `SCHEDULE_NOT_CONFIGURED`). 404 si no existe o está inactiva (no se distingue). Es informativo: el checkout NUNCA
         *     se apoya en esta respuesta cacheada.
         */
        get: operations["getBranchHours"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/branches/{id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Disponibilidad operativa actual de una sucursal activa
         * @description F08. Sin autenticación. Evalúa SIEMPRE con el reloj del servidor (no acepta fecha). Orden de evaluación:
         *     horario sin configurar → cierre excepcional → fuera de horario → abierta. `isAcceptingOrders` equivale a
         *     `isOpenNow` mientras no exista política de último pedido ni pausa operativa (pendiente de negocio). Informativo y
         *     de caché muy corta: la validación DEFINITIVA al crear un pedido ocurre en el servidor (F20) contra la base de datos y
         *     puede rechazar aunque esta respuesta dijera `OPEN`. 404 si no existe o está inactiva. Caché compartida dinámica: `max-age = s-maxage =
         *     min(10, segundos enteros hasta nextTransitionAt)`; si faltan menos de 1 s, `no-store` (ninguna respuesta cacheada cruza una
         *     transición). Toda respuesta de error lleva `Cache-Control: no-store`.
         */
        get: operations["getBranchAvailability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}/hours": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Horario semanal de una sucursal (backoffice)
         * @description F08. Exige `branches.read` en esa sucursal (404 si no existe o fuera de alcance; una sucursal inactiva SÍ se
         *     puede consultar). Devuelve `version` (SHA-256 hex del horario canónico) que el PUT debe reenviar como
         *     `expectedVersion`. Respuesta `Cache-Control: no-store`.
         */
        get: operations["getAdminBranchHours"];
        /**
         * Reemplaza el horario semanal completo (7 días)
         * @description F08. Exige `branches.manage_hours` en esa sucursal (404 fuera de alcance). Reemplaza los 7 días en una transacción
         *     con bloqueo de la sucursal. Concurrencia optimista: `expectedVersion` debe coincidir con la versión vigente, si no
         *     409 `HOURS_VERSION_CONFLICT` sin guardar. Si el horario resultante es idéntico al vigente responde 200 sin
         *     escribir ni auditar (idempotente). Errores: 400 forma inválida (HH:mm, weekday, número de días, más de 6
         *     intervalos por día, `expectedVersion` malformada); 422 `SCHEDULE_INVALID` con `violations` por día/intervalo
         *     (`INTERVAL_OVERLAP`, `INTERVAL_RANGE_INVALID`; un turno que cruza medianoche debe dividirse en dos días). Respuesta `Cache-Control: no-store`.
         */
        put: operations["replaceAdminBranchHours"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}/closures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Cierres extraordinarios de una sucursal (paginado)
         * @description F08. Exige `branches.read` en esa sucursal (404 fuera de alcance). `status`: `current` (default) = en curso +
         *     futuros; `active`; `upcoming`; `past` (terminados); `all`. `from`/`to` filtran los cierres que se solapan con
         *     `[from, to)`. Orden: `startsAt` ascendente (`past` y `all`: descendente), desempate por `id`. Incluye el motivo.
         *     Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminBranchClosures"];
        put?: never;
        /**
         * Crea un cierre extraordinario
         * @description F08. Exige `branches.manage_hours` (404 fuera de alcance). Intervalo `[startsAt, endsAt)`. Reglas: `endsAt >
         *     startsAt`; duración máx. 366 días; `startsAt` entre «ahora − 1 hora» y 2 años a futuro (retroactividad máx. 1 h: `STARTS_TOO_EARLY`); `endsAt` > ahora; máx. 100 cierres vigentes o futuros por sucursal (`CLOSURE_LIMIT_REACHED`, 422); `reason` opcional
         *     (trim, máx. 200, nunca público). 400 forma/formato (incluye instantes sin zona); 422 `CLOSURE_RANGE_INVALID`;
         *     409 `CLOSURE_OVERLAP` si se solapa con otro cierre de la sucursal (contiguos permitidos). Auditoría
         *     `branch_closure.created`.
         */
        post: operations["createAdminBranchClosure"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}/closures/{closureId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Cancela (elimina) un cierre futuro
         * @description F08. Exige `branches.manage_hours`. Solo cierres FUTUROS (`startsAt > ahora`); borrado físico, el historial queda en
         *     `audit_events` (`branch_closure.cancelled`). Un cierre en curso o terminado responde 409 `CLOSURE_NOT_DELETABLE`
         *     (para uno en curso, usar PATCH con `endsAt` <= ahora). No idempotente: un cierre ya eliminado responde 404.
         */
        delete: operations["deleteAdminBranchClosure"];
        options?: never;
        head?: never;
        /**
         * Edita, acorta o termina un cierre
         * @description F08. Exige `branches.manage_hours`. 404 si la sucursal está fuera de alcance o el cierre no pertenece a ella.
         *     Según el estado del cierre (calculado con el reloj del servidor): FUTURO (`startsAt > ahora`): se puede cambiar
         *     `startsAt` (no anterior a «ahora − 1 hora», `STARTS_TOO_EARLY`), `endsAt` y `reason`. EN CURSO (`startsAt <= ahora < endsAt`): solo `reason` y `endsAt`, y `endsAt` solo
         *     puede ACORTAR (`startsAt < endsAt_nuevo <= endsAt_actual`). Para TERMINAR un cierre en curso se envía
         *     `endsAt` con cualquier instante `<= ahora` (p. ej. la hora actual del cliente): el servidor lo fija a «ahora» y el
         *     cierre pasa a `past`. TERMINADO (`endsAt <= ahora`): inmutable (409 `CLOSURE_NOT_EDITABLE`). Cambiar `startsAt` o
         *     alargar `endsAt` en un cierre en curso => 409 `CLOSURE_NOT_EDITABLE`. `reason: null` borra el motivo. Sin cambios
         *     reales => 200 sin escribir ni auditar. 409 `CLOSURE_OVERLAP` si el nuevo rango choca con otro cierre. Auditoría
         *     `branch_closure.updated`.
         */
        patch: operations["updateAdminBranchClosure"];
        trace?: never;
    };
    "/v1/locations/departments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Departamentos de Guatemala (catálogo público)
         * @description F09. Sin autenticación. Los 22 departamentos, ordenados alfabéticamente en español (comparación sin distinguir
         *     acentos ni mayúsculas; desempate por `id`). Solo `id` y `name`. Catálogo de solo lectura (cambia por migración):
         *     caché pública larga. Los `id` son específicos de cada entorno: los clientes NO deben codificarlos.
         */
        get: operations["listLocationDepartments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations/municipalities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Municipios de un departamento (catálogo público)
         * @description F09. Sin autenticación. `departmentId` es obligatorio (no hay listado global). Orden alfabético en español (sin
         *     distinguir acentos; desempate por `id`). Un departamento existente sin municipios cargados devuelve 200 con
         *     `items: []` (la carga de municipios fuera del departamento de Guatemala está PENDIENTE de fuente oficial, ver
         *     specs/008-delivery-zones-coverage D9). `departmentId` con formato inválido o ausente => 400; UUID válido que no existe
         *     => 404 `DEPARTMENT_NOT_FOUND`. Caché pública larga solo en 2xx; los errores llevan `no-store`.
         */
        get: operations["listLocationMunicipalities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/delivery-zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Zonas de entrega propias (backoffice, paginado)
         * @description F09. Exige JWT -> personal activo con `branches.read` -> `aal2`. Solo devuelve zonas de sucursales dentro del
         *     alcance de `branches.read`. `branchId` fuera de alcance o inexistente => 404 (no se distingue). Incluye zonas
         *     inactivas salvo que se filtre `active`. Orden por defecto: departamento, municipio, zona general (sin etiqueta)
         *     primero y luego etiqueta; desempate por `id`. `q` busca por etiqueta (contiene; sin distinguir mayúsculas ni
         *     acentos). Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminDeliveryZones"];
        put?: never;
        /**
         * Crea una zona de entrega propia
         * @description F09. Exige `branches.manage_delivery_zones` en `branchId` (inexistente o fuera de alcance => 404; una sucursal
         *     inactiva SÍ admite zonas). `zoneLabel` se normaliza (NFC, recorte, colapso de espacios); `null` o en blanco = cobertura
         *     GENERAL del municipio. Unicidad lógica `(branchId, municipalityId, clave normalizada de zoneLabel)` incluyendo
         *     zonas inactivas: duplicado => 409 `DELIVERY_ZONE_DUPLICATE` (también ante creaciones concurrentes) con
         *     `violations[0].path = deliveryZones/<id existente>`. `baseFee` es un string decimal GTQ con 0 a 2 decimales
         *     (`"15"` o `"15.00"`; un número JSON => 400) y se devuelve siempre con 2 decimales. Municipio inexistente => 422
         *     `MUNICIPALITY_NOT_FOUND`. Se audita en la misma transacción (`delivery_zone.created`). Respuesta `no-store`.
         */
        post: operations["createAdminDeliveryZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/delivery-zones/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de una zona de entrega propia
         * @description F09. Exige `branches.read` en la sucursal de la zona. 404 si no existe o está fuera de alcance (no se distingue).
         *     Una zona inactiva SÍ se puede consultar. Respuesta `no-store`.
         */
        get: operations["getAdminDeliveryZone"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita etiqueta y/o tarifa de una zona
         * @description F09. Exige `branches.manage_delivery_zones` en la sucursal de la zona (404 fuera de alcance). Solo `zoneLabel`
         *     (`null` = pasa a cobertura general del municipio) y `baseFee`; sucursal, municipio y `active` NO se aceptan (400;
         *     el estado se cambia con `PATCH .../status`). Concurrencia optimista: `expectedVersion` debe coincidir con `version`
         *     vigente, si no 409 `DELIVERY_ZONE_VERSION_CONFLICT` sin guardar. Si ningún valor cambia responde 200 sin escribir,
         *     sin subir `version` y sin auditar. Cambiar la etiqueta a una ya existente => 409 `DELIVERY_ZONE_DUPLICATE`. Se audita
         *     `delivery_zone.updated` (old/new solo de los campos cambiados). Respuesta `no-store`.
         */
        patch: operations["updateAdminDeliveryZone"];
        trace?: never;
    };
    "/v1/admin/delivery-zones/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva una zona (no hay borrado físico)
         * @description F09. Exige `branches.manage_delivery_zones` en la sucursal de la zona (404 fuera de alcance). Establece `active`
         *     con valor explícito (idempotente: si ya tiene ese valor responde 200 sin escribir ni auditar; no usa
         *     `expectedVersion`, el último valor gana). Un cambio real sube `version` y audita `delivery_zone.status_changed`.
         *     Desactivar NO borra la zona ni afecta pedidos ya creados; solo deja de contar para nuevas comprobaciones. `reason`
         *     opcional (máx. 200; sin PII). Respuesta `no-store`.
         */
        patch: operations["updateAdminDeliveryZoneStatus"];
        trace?: never;
    };
    "/v1/admin/branches/{id}/delivery-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Configuración logística de una sucursal
         * @description F09. Exige `branches.read` en esa sucursal (404 si no existe o fuera de alcance; una inactiva SÍ se consulta). Si la
         *     sucursal aún no tiene fila, devuelve los valores por defecto (`ownDeliveryZonesEnabled=false`,
         *     `pedidosyaEnabled=true`) con `isDefault=true` y `updatedAt=null`. `pedidosyaIntegrationStatus` refleja el
         *     adaptador activo en el servidor (`BLOCKED_EXTERNAL` mientras no exista integración verificable): NO es un
         *     indicador de conexión. Respuesta `no-store`.
         */
        get: operations["getAdminBranchDeliverySettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Actualiza los indicadores logísticos de una sucursal
         * @description F09. Exige `branches.manage_delivery_zones` en esa sucursal (404 fuera de alcance). Campos omitidos no se tocan;
         *     valores explícitos (idempotente, el último gana; sin `expectedVersion`). Crea la fila si no existía (upsert).
         *     `pedidosyaEnabled` es un indicador ADMINISTRATIVO: no activa operaciones reales ni equivale a integración
         *     operativa. Desactivar zonas propias NO borra zonas, motoristas, entregas en curso ni pedidos; solo impide nuevas
         *     elegibilidades. Un PATCH sin cambios reales no escribe ni audita. Se audita `branch_delivery_settings.updated`
         *     (old/new solo de los flags cambiados). Respuesta `no-store`.
         */
        patch: operations["updateAdminBranchDeliverySettings"];
        trace?: never;
    };
    "/v1/delivery-coverage/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Comprueba cobertura de entrega a domicilio por proveedor (público, informativo)
         * @description F09. Sin autenticación. NO crea pedidos, NO solicita motorista ni cotiza, y NO recibe costos del cliente (cuerpo
         *     con propiedades desconocidas => 400). La tarifa de `OWN.baseFee` es la del servidor; el pedido (F19/F20)
         *     la recalcula. Se evalúa cada proveedor por separado; NO existe un booleano `covered`.
         *     `providers.PEDIDOSYA.coverageStatus = UNKNOWN` mientras no haya integración verificable (`integrationStatus =
         *     BLOCKED_EXTERNAL`): NO equivale a UNAVAILABLE ni a AVAILABLE. Si `integrationStatus = MOCK` la respuesta es
         *     una simulación (`eligibility.simulated = true`) y jamás autoriza operaciones reales; el mock no puede activarse
         *     en producción. Un proveedor deshabilitado se indica con `enabled=false` (su `coverageStatus` no es significativo).
         *     Timeout o error del proveedor => `UNKNOWN` con `reason`, nunca UNAVAILABLE ni 5xx. NO considera horarios ni cierres
         *     (F08 se combina en checkout). La recogida en sucursal no depende de cobertura. Prioridad de zona propia: zona
         *     específica > cobertura general del municipio > sin cobertura. `branchId` inexistente o inactiva => 422
         *     `BRANCH_NOT_AVAILABLE` (no se distingue); `municipalityId` inexistente => 422 `MUNICIPALITY_NOT_FOUND`.
         *     Respuesta `Cache-Control: no-store`.
         */
        post: operations["checkDeliveryCoverage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/checkout/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cotiza un carrito para el checkout (autoridad de precios; sin crear pedido)
         * @description F19 (spec 020, ADR-0025). Calcula EN EL SERVIDOR líneas, extras, descuentos, tarifa de entrega y total de un carrito.
         *     NO crea pedidos, pagos ni entregas, NO reserva inventario y NO asigna repartidor (F20/F24/F25/F28/F29). Es un POST
         *     sin efectos (equivale a un cálculo): responde 200, no lleva `Idempotency-Key` y no se audita.
         *     **Acceso**: invitado o autenticado (`security` opcional). Sin `Authorization` se cotiza como invitado; un token
         *     presente pero inválido => 401 (no se degrada a invitado). `fulfillment.customerAddressId` EXIGE sesión de cliente y
         *     que la dirección sea suya: sin sesión => 401; ajena, inexistente o sin perfil de cliente => 404 idéntico (anti-IDOR).
         *     **Entrada sin importes**: `cart` es `CartQuoteInput` (ids y cantidades); `clientView` solo contiene lo que el
         *     cliente VIO y es una PISTA no autoritativa (produce avisos `PRICE_CHANGED`/`TOTAL_CHANGED`, jamás cambia un cálculo).
         *     Cualquier otra propiedad (precio, tarifa, descuento, total) => 400.
         *     **Dinero**: cadenas decimales de 2 posiciones en GTQ; aritmética en centavos enteros (`PromotionEvaluator` de F15,
         *     medio hacia arriba en porcentajes). `subtotal = Σ (precio unitario de sucursal + extras) × cantidad` de las líneas
         *     compradas; `total = subtotal − discountTotal + deliveryFee`. Las promociones descuentan solo el producto, nunca los
         *     extras (F15 D15.6); una promoción por línea (la de mayor ahorro), jamás se apilan.
         *     **`total` es `null`** si no es verificable: alguna línea no comprable, entrega a domicilio sin tarifa verificable
         *     o dirección incompleta. `canProceed` es `true` solo si `blockers` está vacío. `notices` no bloquean.
         *     **Entrega**: el cliente elige modalidad (`PICKUP`|`DELIVERY`), no proveedor. Cada proveedor se evalúa por separado
         *     (`delivery.options`). PEDIDOSYA es `UNKNOWN` mientras la integración esté `BLOCKED_EXTERNAL` y NUNCA es seleccionable
         *     en esta versión (tarifa al cliente sin política aprobada, P40); un mock aparece con `simulated=true` y tampoco
         *     habilita nada. OWN solo si la sucursal tiene `ownDeliveryZonesEnabled` y hay zona; su tarifa es la del servidor.
         *     Nunca se expone el costo del proveedor. Si el cliente indica `deliveryProvider` y no es seleccionable NO se cambia
         *     de proveedor en silencio (blocker `DELIVERY_PROVIDER_NOT_SELECTABLE`). La cotización usa SIEMPRE la sucursal del
         *     carrito (no la reasigna por cobertura). Pedidos programados: fuera de alcance (solo «ahora»).
         *     **Vigencia**: `quote.expiresAt` (10 min) y `quote.token` firmado (HMAC con secreto de servidor; `null` si el
         *     servidor no tiene secreto: F20 debe rechazar cotizaciones sin firma). El token NO reserva nada: F20 revalida todo y
         *     responde conflicto si el resultado difiere. Cupón: ante cualquier cosa distinta de `APPLIED` el cliente solo ve
         *     `NOT_APPLIED` (sin motivo; no se puede enumerar códigos) y la ruta tiene un límite de tasa específico.
         *     Respuesta `Cache-Control: private, no-store`.
         */
        post: operations["quoteCheckout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Crea un pedido (invitado o autenticado) con recotización del servidor e idempotencia
         * @description F20 (spec 021, ADR-0026). Crea UN pedido en estado `pending` con snapshots inmutables (productos, extras, descuentos,
         *     promociones, dirección). NO cobra ni registra efectivo recibido (eso es `registerAdminOrderCashPayment`, F24), NO solicita reparto ni envía notificaciones (F28/F29/F31). SÍ crea, en la MISMA transacción,
         *     el pago `CASH` en `PENDING` por el total del pedido (+ evento `created`); un reintento idempotente NO lo duplica. Solo se admite efectivo (`paymentMethodPreference` ausente o `cash`).
         *     `pending` = «recibido, a la espera de que el restaurante lo procese»; NO significa pagado ni aceptado.
         *     **Acceso**: invitado o autenticado (`security` opcional; token presente e inválido => 401, nunca se degrada a invitado).
         *     `customer_id` sale SIEMPRE de la sesión, jamás del cuerpo. `fulfillment.customerAddressId` exige sesión y propiedad
         *     (404 idéntico si es ajena o inexistente).
         *     **Sin importes en la entrada**: precios, tarifa, descuento, total, estado de pago y cobertura los decide el servidor
         *     (`additionalProperties:false`; cualquier campo de importe => 400). `quoteToken` es el `quote.token` de
         *     `POST /v1/checkout/quote` (F19); el cuerpo `cart`/`fulfillment`/`couponCode` es el MISMO que se cotizó.
         *     **Revalidación** (siempre, antes de la transacción): el servidor verifica firma, vigencia y sujeto del token, RECOTIZA con
         *     el mismo cotizador de F19 y compara huella de la entrada, proveedor, subtotal, descuento, tarifa, total y líneas.
         *     Cualquier diferencia => 409 `QUOTE_CHANGED` con la cotización nueva; nunca se crea un pedido con otro importe sin que el
         *     cliente lo acepte (nueva petición con el token nuevo y una `Idempotency-Key` nueva). Token vencido => 409 `QUOTE_EXPIRED`;
         *     token ausente de entorno o inválido (firma, sujeto distinto, entrada distinta) => 422 `QUOTE_INVALID`; `canProceed=false`
         *     => 422 `CHECKOUT_BLOCKED` con `blockers`. PedidosYa NUNCA se puede crear (422 `DELIVERY_PROVIDER_NOT_SELECTABLE`, F29);
         *     PICKUP y OWN elegible sí. Sin `CHECKOUT_QUOTE_SECRET` en el servidor => 503 `ORDERS_UNAVAILABLE` (fail-closed).
         *     **Idempotencia** (obligatoria): `Idempotency-Key` identifica UN intento lógico (UUID v4 o ≥ 22 caracteres base64url del
         *     cliente). Misma clave + mismo cuerpo canónico (sin `quoteToken`) => se devuelve EL MISMO pedido (200 + `Idempotent-Replayed:
         *     true`) sin recotizar ni validar vigencia del token; misma clave + cuerpo distinto => 409 `IDEMPOTENCY_KEY_REUSED`; solicitud
         *     concurrente con la misma clave => espera y devuelve el mismo pedido (o 409 `IDEMPOTENCY_IN_PROGRESS` con `Retry-After`).
         *     La clave se guarda con el pedido en la MISMA transacción, por actor (cliente o invitado), 24 h. Un 201 solo existe si el
         *     pedido está persistido.
         *     **Invitado**: la respuesta incluye `access.guestToken` (opaco, ≥ 256 bits, SOLO su hash se guarda) para consultar el
         *     pedido con `X-Order-Token`. Se muestra al crear; en una repetición idempotente de invitado se EMITE OTRO ADICIONAL y el anterior
         *     NO se revoca (el cliente pudo no haber recibido el primero); solo se mantienen los 5 tokens más recientes por pedido. Cliente autenticado: `guestToken = null`.
         *     **Anti-abuso**: límite de tasa por IP y por actor y tope de pedidos `pending` por cliente autenticado (429).
         *     Respuesta `Cache-Control: private, no-store`. Los datos de contacto no se registran en logs.
         */
        post: operations["createOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Consulta un pedido propio (sesión del cliente dueño o token de invitado)
         * @description F20 (spec 021, ADR-0026): detalle del pedido para la confirmación «pedido recibido». El seguimiento (estado, fases y
         *     línea de tiempo, apto para polling) es `GET /v1/orders/{id}/tracking` (`getOrderTracking`, F21): este detalle se
         *     consulta una vez y NO se usa para sondear. El acceso del personal es F22 (`/v1/admin/orders`).
         *     **Autorización** (solo servidor): (a) JWT del cliente dueño del pedido, o (b) cabecera `X-Order-Token` con el token
         *     de invitado emitido al crear (se compara su sha256; vigente y no revocado). El token NO va en la URL ni en query
         *     (evita fugas por logs de acceso y `Referer`). Cualquier otro caso (pedido inexistente, ajeno, token ausente, inválido,
         *     vencido o revocado) responde el MISMO 404 sin `code`. El `id` es el UUID del pedido, no el número visible.
         *     Minimización de PII: teléfono enmascarado, sin correo ni coordenadas. `Cache-Control: private, no-store`.
         *     `POST /v1/orders/lookup` (número + teléfono) NO existe (diferido, P62; spec 022).
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/tracking": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Seguimiento ligero de un pedido propio (estado actual, fases públicas y línea de tiempo real)
         * @description F21 (spec 022, ADR-0027). Respuesta pequeña pensada para POLLING moderado: SIN líneas, importes, contacto ni dirección
         *     (eso lo entrega `getOrder` una sola vez). Solo CONSULTA y PRESENTA lo que ya está registrado: no cambia estados (F22), no
         *     consulta a ningún proveedor externo y no inventa datos (sin GPS, ETA, repartidor ni tracking de PedidosYa, `BLOCKED_EXTERNAL`).
         *     **Pago (F24)**: añade `payment{method: CASH, status: PENDING|PAID, paidAt}` (no son importes: el monto sigue en `getOrder`/recibo). El pago NO entra en `steps` ni `events` (el timeline es solo operativo).
         *     **Autorización**: IDÉNTICA a `getOrder` (JWT del cliente dueño o cabecera `X-Order-Token`; el token NUNCA va en la URL).
         *     Pedido inexistente, ajeno, token ausente/inválido/vencido/revocado o pedido de invitado consultado con JWT => el MISMO 404
         *     que `getOrder`. `Cache-Control: private, no-store`, `Vary: Authorization, X-Order-Token`, sin `ETag` (no hay `304`).
         *     **Contenido**: `status` es el estado real del pedido (`orders.status`); `publicStatus` es su fase pública normalizada;
         *     `steps` es el recorrido ESPERADO por modalidad con la hora real en que se alcanzó cada fase (`reachedAt: null` = aún no
         *     ocurrida, nunca una hora estimada); `events` es `order_status_history` tal cual está registrado (orden `changed_at, id`,
         *     máx. 50), sin `changed_by` ni `reason`. Un `rejected`/`cancelled` corta el recorrido (sin fases futuras). `delivery` solo
         *     existe en pedidos DELIVERY y hoy solo trae el proveedor (`status` siempre `null` hasta F28/F29).
         *     `pollAfterSeconds` es una SUGERENCIA del servidor para el siguiente refresco (`null` en estado terminal: no volver a
         *     consultar); el cliente la acota a su propio rango y respeta `Retry-After` en 429/503.
         */
        get: operations["getOrderTracking"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/receipt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Recibo NO FISCAL de un pedido propio (datos para la vista imprimible)
         * @description F23 (spec 024, ADR-0029). Entrega los DATOS del recibo, construidos SOLO desde los snapshots del pedido (líneas, extras, promociones, dirección, importes);
         *     nunca recalcula desde el catálogo ni guarda un documento (no existe tabla de recibos). La vista imprimible (HTML + CSS `@media print`) es de la web; la API no
         *     genera PDF. NO es una factura ni un documento tributario: `fiscalStatus` es siempre `NOT_FISCAL` (sin FEL, SAT ni NIT; P78).
         *     **Autorización**: IDÉNTICA a `getOrder` (JWT del cliente dueño o cabecera `X-Order-Token`; el token NUNCA va en la URL). Inexistente, ajeno, token ausente/inválido/vencido/
         *     revocado o pedido de invitado consultado con JWT => el MISMO 404. Disponible en TODOS los estados (también `rejected` y `cancelled`, P76): el recibo lleva el estado y NO afirma pago.
         *     **Pago real (F24, spec 025)**: `payment{method: CASH, status: PENDING|PAID, paidAt, amountPaid, tendered, change}` sale de `payments`. `PENDING` = «Pago en efectivo pendiente»; `PAID` = pagado en efectivo con fecha, importe aplicado, efectivo entregado y cambio. Sin identidad del empleado, historial ni auditoría; un `rejected`/`cancelled` con cobro sigue mostrando `PAID` (la devolución es de F26). Sin transferencia, tarjeta ni comprobantes.
         *     **Qué NO contiene**: id de pedido o de líneas, ids de cliente/sucursal, tokens, correo, teléfono completo (solo enmascarado), coordenadas, motivo de rechazo/cancelación,
         *     historial, actor ni notas administrativas. Las fechas son instantes UTC; `timeZone` indica la zona de presentación (`America/Guatemala`). `Cache-Control: private, no-store`,
         *     `Vary: Authorization, X-Order-Token`, sin `ETag`.
         */
        get: operations["getOrderReceipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/reorder-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Vista previa de «Volver a pedir» contra el catálogo vigente (no crea nada)
         * @description F23 (spec 024, ADR-0029). Valida las líneas de un pedido anterior contra el catálogo, los extras y los precios VIGENTES de la sucursal elegida y devuelve, por línea,
         *     un diagnóstico y una línea candidata en la forma del contrato de carrito de F18/F19 (`CartQuoteLineInput`). Es una operación de SOLO LECTURA aunque use POST (lleva
         *     cuerpo): NO crea pedidos, NO escribe en la BD, NO guarda borradores, NO exige `Idempotency-Key`, NO copia precios, promociones, cupón, tarifa de entrega, modalidad,
         *     dirección ni método de pago del pedido original, y NO es una cotización: la cotización definitiva sigue siendo `POST /v1/checkout/quote` (F19) y el pedido `POST /v1/orders` (F20).
         *     Los precios devueltos (`current`, `display`, `estimatedSubtotal`) son los efectivos de la sucursal ahora, solo para mostrar; el cliente NO los reenvía como verdad.
         *     **Autorización**: IDÉNTICA a `getOrder` (JWT del cliente dueño o `X-Order-Token` de invitado). El invitado puede usarlo porque la respuesta no expone más del pedido que ya puede
         *     ver (líneas y extras) ni nada del catálogo que no sea público. Inexistente, ajeno o token inválido => el MISMO 404 sin `code`.
         *     **Sucursal**: `branchId` opcional; por defecto la del pedido original (`branch.sameBranch`). Una sucursal inexistente => 404 `BRANCH_NOT_FOUND`; inactiva o cerrada NO es un error: se informa
         *     en `branch` y (inactiva) todas las líneas salen `UNAVAILABLE` con `BRANCH_UNAVAILABLE`.
         *     **Algoritmo agrupado** (sin una petición por producto): lectura del pedido en UNA sentencia; disponibilidad de la sucursal, estado y precio de TODOS los productos, ofertas de modificadores de
         *     TODOS los productos y datos de presentación en lotes. Las opciones se resuelven por `modifierId` (el snapshot no guarda el grupo). Una opción retirada o inactiva se OMITE y se informa; si el producto
         *     exige selección nueva o cambió una regla de grupo la línea queda `NEEDS_CONFIGURATION` y NUNCA se sustituye automáticamente: el cliente la configura de nuevo.
         *     `Cache-Control: private, no-store`, `Vary: Authorization, X-Order-Token`.
         */
        post: operations["previewOrderReorder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/store/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Árbol público de categorías visibles
         * @description F10. Sin autenticación. Devuelve el árbol anidado (máx. 3 niveles) SOLO con categorías visibles: una categoría
         *     aparece únicamente si ella y TODOS sus ancestros están activos (desactivar un padre oculta su subárbol). Respuesta
         *     ligera: sin `sortOrder`, `active` ni marcas de tiempo. Orden estable por hermanos: `sortOrder`, `name`, `id`.
         *     Lista vacía = ninguna categoría visible. No incluye productos (F11). Caché compartida corta con revalidación
         *     (`Cache-Control: public`); no se emite `ETag`.
         */
        get: operations["listStoreCategories"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pedidos del backoffice (paginado por cursor, ligero)
         * @description F22 (spec 023, ADR-0028). Exige `orders.read` y `aal2`. LISTADO ligero (sin líneas, modificadores, promociones, dirección ni historial: eso es `getAdminOrder`). Alcance por sucursal EN SQL
         *     (`branch_id = ANY(sucursales con orders.read)`; con alcance global, todas): nunca se filtra en la web. `branchId` fuera de alcance o inexistente => 404 `BRANCH_NOT_FOUND`.
         *     Filtros: `status` (lista separada por comas), `fulfillmentType`, `q` (2..40: número `1042`/`MON-001042` => igualdad por número; otro texto => nombre del cliente, contiene, sin distinguir
         *     mayúsculas; NO busca por teléfono ni correo: P70), `from`/`to` (instantes de `placedAt`; por defecto `from = ahora − 7 días`; rango máximo 92 días, si no 400). Orden FIJO `placedAt` descendente, `id`
         *     descendente; paginación por CURSOR opaco (`nextCursor`; `null` = última página); un cursor alterado o de otra consulta => 400 `ORDER_CURSOR_INVALID` (el alcance se aplica SIEMPRE en la consulta, así
         *     que manipularlo no revela nada). Sin conteo total (el tablero trae los conteos). Una consulta para la página con el conteo de unidades agregado (sin N+1). `no-store`.
         */
        get: operations["listAdminOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/board": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Tablero de pedidos agregado por estado (conteos y primeras N por columna)
         * @description F22 (spec 023, ADR-0028). Exige `orders.read` y `aal2`. Vista OPERATIVA pensada para polling: una columna por estado del catálogo con el CONTEO real y las primeras `limit` tarjetas (más
         *     antiguas primero en las columnas activas, para atender primero lo que espera más; las terminales, las más recientes). Columnas ACTIVAS (`pending`, `accepted`, `preparing`, `ready`,
         *     `on_the_way`): TODOS los pedidos activos sin importar su antigüedad (un pedido viejo sin atender debe verse). Columnas TERMINALES (`delivered`, `picked_up`, `rejected`, `cancelled`): solo las
         *     últimas `terminalWindowHours` (24 h) por `placedAt`, con tope fijo de 10 tarjetas cada una. `hasMore=true` si hay más que las mostradas (se ven en el listado). Alcance por sucursal en SQL
         *     como `listAdminOrders`. `summary.pending` y `summary.oldestPendingAt` alimentan el aviso de pedidos nuevos (la web compara contra el sondeo anterior). `pollAfterSeconds` es la sugerencia del
         *     servidor (constante; la web la acota a 10..60 s, pausa con la pestaña oculta y respeta `Retry-After`). Presupuesto: ≤ 4 sentencias SQL por consulta (conteos, tarjetas por `LATERAL` sobre
         *     `orders_branch_status_placed_idx`, unidades por lote, sucursales). `no-store`.
         */
        get: operations["getAdminOrderBoard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle completo de un pedido para el personal (líneas, dirección, totales e historial)
         * @description F22 (spec 023, ADR-0028). Exige `orders.read` y `aal2`. Snapshots inmutables de F20 (líneas con modificadores, promociones, dirección, totales) + `contact` (nombre y TELÉFONO completos: el
         *     personal los necesita para atender; el correo NO se expone, P70) + `payment` (`AdminOrderPaymentSummary`: efectivo `PENDING|PAID`, deuda, `possibleRefundReview` y si ESTE personal puede registrar el cobro; el detalle completo con la recepción es `getAdminOrderPayment`; NO se inventan
         *     estados de pago) + `history` (hasta 50 eventos MÁS RECIENTES en orden cronológico `changed_at, id`, con el nombre mínimo de quien actuó; `historyTruncated`) + `availableActions` (lo que ESTE
         *     personal puede hacer AHORA, calculado en el servidor con la matriz de transiciones, la modalidad y sus permisos por sucursal; la web no duplica la regla). Pedido inexistente o de una sucursal
         *     fuera del alcance de `orders.read` => el MISMO 404 `ORDER_NOT_FOUND` (anti-IDOR). El historial va dentro del detalle (no hay `/history` aparte: una sola ida y vuelta al abrir la ficha).
         *     ≤ 7 sentencias SQL. `no-store`.
         */
        get: operations["getAdminOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Acepta un pedido (`pending` → `accepted`)
         * @description F22 (spec 023, ADR-0028). Exige `orders.accept` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Desde `pending`. Cualquier modalidad.
         */
        post: operations["acceptAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rechaza un pedido nuevo (`pending` → `rejected`, motivo obligatorio)
         * @description F22 (spec 023, ADR-0028). Exige `orders.reject` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Desde `pending`. `reason` obligatorio (3..280 caracteres recortados; falta => 400 `ORDER_REASON_REQUIRED`); es texto INTERNO: nunca se muestra al cliente (P64).
         */
        post: operations["rejectAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/start-preparing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Inicia la preparación (`accepted` → `preparing`)
         * @description F22 (spec 023, ADR-0028). Exige `orders.prepare` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Desde `accepted`. Cualquier modalidad.
         */
        post: operations["startPreparingAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/mark-ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Marca el pedido como listo (`preparing` → `ready`)
         * @description F22 (spec 023, ADR-0028). Exige `orders.prepare` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Desde `preparing`. En DELIVERY el pedido queda `ready` esperando el despacho (F28/F29): esta operación NO despacha ni asigna repartidor ni solicita a ningún proveedor.
         */
        post: operations["markReadyAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Completa la entrega en sucursal de un pedido PICKUP (`ready` → `picked_up`)
         * @description F22 (spec 023, ADR-0028). Exige `orders.complete` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Solo PICKUP desde `ready`. En DELIVERY => 422 (`delivered` lo produce F28 con la entrega propia; con PedidosYa no hay acción: `BLOCKED_EXTERNAL`). No registra cobros (F24).
         */
        post: operations["completeAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancela un pedido (`pending|accepted|preparing|ready` → `cancelled`, motivo obligatorio)
         * @description F22 (spec 023, ADR-0028). Exige `orders.cancel` y `aal2`; además el permiso debe cubrir la sucursal DEL PEDIDO (alcance por sucursal: sin él => 403 `ORDER_ACTION_FORBIDDEN`) y el personal debe poder
         *     VER el pedido (`orders.read` en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND` que un pedido inexistente). Cuerpo con `expectedStatus` OBLIGATORIO: el estado que la persona vio en pantalla. La
         *     actualización es COMPARE-AND-SET (`UPDATE … WHERE id AND status = expectedStatus`) en una sola transacción con la fila de `order_status_history` (`old_status`, `new_status`, `changed_by`, `reason`)
         *     y el evento de `audit_events`; los estados solo avanzan (no hay ciclos), así que `status` actúa como versión sin ABA. Estado actual ≠ `expectedStatus` => 409 `ORDER_STATE_CONFLICT` con `current`
         *     (sin escribir nada). REPETICIÓN IDEMPOTENTE: si el estado actual YA es el destino y el último evento del historial es exactamente `expectedStatus` → destino, responde 200 con `transition.replayed=true`
         *     SIN duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica). Transición no permitida (terminal, modalidad, salto de estados, estado de origen imposible) => 422
         *     `ORDER_TRANSITION_INVALID`. La respuesta trae `pendingActions` INFORMATIVAS (revisiones que quedan para otra feature; nunca se ejecutan aquí). `no-store`.
         *     Desde `pending`, `accepted`, `preparing` o `ready`; NUNCA desde `on_the_way` ni desde un estado terminal (422). `reason` obligatorio (3..280; falta => 400 `ORDER_REASON_REQUIRED`), interno. NO reembolsa ni cancela entregas: informa `pendingActions` (`payment_review`, `delivery_cancellation`).
         */
        post: operations["cancelAdminOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/payment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pago en efectivo de un pedido (deuda, estado y recepción) para el personal
         * @description F24 (spec 025, ADR-0030). Exige `payments.read` y `aal2`, con alcance por sucursal DEL PEDIDO. Devuelve el pedido (`displayNumber`, estado), el total debido (`amountDue`, GTQ), el método `CASH`, el estado (`PENDING|PAID`),
         *     lo pendiente, el contexto de cobro derivado (`BRANCH` | `OWN_DELIVERY` | `null` para PedidosYa), si ESTE personal puede registrar el cobro (`registration`) y, con `PAID`, la recepción
         *     (empleado, fecha del servidor, efectivo entregado y cambio). `possibleRefundReview` = `PAID` + pedido `rejected`/`cancelled` (aviso derivado; no hay reembolsos en F24). Pedido inexistente o de una sucursal
         *     fuera del alcance de `payments.read` => el MISMO 404 `ORDER_NOT_FOUND` (anti-IDOR). ≤ 2 sentencias SQL. `Cache-Control: private, no-store`.
         */
        get: operations["getAdminOrderPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/payment/cash": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Registra la recepción del efectivo de un pedido (`PENDING` → `PAID`)
         * @description F24 (spec 025, ADR-0030). Exige `payments.confirm` y `aal2`; el permiso debe cubrir la sucursal DEL PEDIDO (si no => 403 `PAYMENT_ACTION_FORBIDDEN`) y el personal debe poder VER el pedido (`orders.read`
         *     en esa sucursal; si no => el mismo 404 `ORDER_NOT_FOUND`). Sirve igual para PICKUP (mostrador) y DELIVERY `OWN` (quien tenga `payments.confirm`); el contexto lo DERIVA el servidor del pedido. NO cambia el estado del pedido y
         *     ningún cambio de estado marca `PAID`. El actor sale del JWT, la sucursal es la del pedido, la fecha es el reloj del servidor y la moneda es GTQ.
         *     **Cambio**: `change = tendered − total`, calculado SOLO en el servidor; el ingreso aplicado es el total del pedido (`amountApplied`), nunca `tendered`; el total del pedido no cambia.
         *     **Reglas**: pedido `rejected`/`cancelled` => 409 `ORDER_NOT_PAYABLE` (no se cobra); ya `PAID` => 409 `PAYMENT_ALREADY_REGISTERED` (con el pago actual) SALVO repetición con la MISMA clave y el MISMO cuerpo canónico => 200 con
         *     `Idempotent-Replayed: true`; misma clave con otro cuerpo => 409 `IDEMPOTENCY_KEY_REUSED`. PedidosYa, total 0 o pedido histórico sin pago `CASH` => 422 `PAYMENT_NOT_COLLECTABLE`. `tendered` insuficiente => 422 `CASH_AMOUNT_INSUFFICIENT`;
         *     sobre el tope => 422 `CASH_TENDERED_TOO_LARGE`.
         *     **Atomicidad**: `UPDATE payments SET status='paid' … WHERE order_id AND status='pending'` + evento `payment_events` + auditoría `payment.cash_received` en UNA transacción corta; el índice único por pedido y el UPDATE condicional
         *     impiden el doble cobro por doble clic o concurrencia. **Idempotencia** persistente en BD: solo se guarda el hash (sha256) de la clave y del cuerpo canónico, con alcance por pedido; sobrevive a una respuesta perdida.
         *     La web declara éxito SOLO tras esta respuesta persistida. ≤ 6 sentencias SQL. `Cache-Control: private, no-store`.
         */
        post: operations["registerAdminOrderCashPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/payment/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Historial solo-añadir del pago de un pedido (eventos autorizados)
         * @description F24 (spec 025, ADR-0030). Exige `payments.read` y `aal2`, con alcance por sucursal DEL PEDIDO. Eventos de `payment_events` en orden cronológico (`at, id`): `CREATED` (con el pedido) y `CASH_RECEIVED` (con el nombre mínimo del
         *     empleado, el efectivo entregado y el cambio). Sin paginación (a lo sumo unos pocos eventos). Sin identificadores de empleado ni claves de idempotencia. Pedido inexistente o fuera del alcance => el MISMO 404
         *     `ORDER_NOT_FOUND`. ≤ 2 sentencias SQL. `Cache-Control: private, no-store`.
         */
        get: operations["listAdminOrderPaymentHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/riders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Motoristas propios (backoffice, paginado)
         * @description F27 (spec 028, ADR-0031). Exige JWT -> personal activo con `riders.read` -> `aal2`. Solo devuelve motoristas de sucursales dentro del alcance de `riders.read` (SQL con el alcance). Incluye inactivos salvo
         *     filtro `active`. Paginación por `page`/`pageSize` con `total` (patrón F03/F09). El listado NO carga entregas: `busy` se obtiene del puerto `RiderActiveDeliveriesPort` (con el adaptador por defecto,
         *     `busyKnown=false` y `busy=false`, hasta F28). El teléfono se entrega ENMASCARADO (`phoneMasked`); el teléfono completo y la placa solo en el detalle. Nunca documentos, fotos ni ubicación. ≤ 3 sentencias SQL.
         *     `Cache-Control: private, no-store`.
         */
        get: operations["listAdminRiders"];
        put?: never;
        /**
         * Da de alta a un motorista propio
         * @description F27. Exige `riders.create` con alcance sobre `branchId` (si no, 403 `RIDER_ACTION_FORBIDDEN`, también si la sucursal no existe para un empleado con alcance acotado) y `aal2`. Crea la fila ACTIVA y `UNAVAILABLE`
         *     (no es asignable hasta que alguien la marque disponible, P92). Teléfono `^\+502[0-9]{8}$` ÚNICO en toda la plataforma (una persona = un registro; un traslado es un cambio de sucursal, no otra alta): si existe,
         *     409 `RIDER_PHONE_TAKEN` (también si el registro está inactivo o en otra sucursal; no se revela quién). Sin `Idempotency-Key`: la unicidad del teléfono ya hace seguro el reintento (P102). Sucursal inexistente o
         *     inactiva => 422 `BRANCH_NOT_AVAILABLE`. No crea cuentas de Google/Auth ni vincula `staff_users`. Audita `rider.created` (sin PII) en la misma transacción. ≤ 3 sentencias SQL.
         */
        post: operations["createAdminRider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/riders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de un motorista
         * @description F27. Exige `riders.read` y `aal2`. Inexistente o de una sucursal fuera del alcance => el MISMO 404 `RIDER_NOT_FOUND` (anti-IDOR). Devuelve teléfono completo y placa (PII: solo a quien tiene `riders.read`; nunca en
         *     logs; la lectura no se audita, P98). Incluye `version` (concurrencia optimista) y el estado derivado. No incluye historial de entregas (F28). ≤ 2 sentencias SQL. `Cache-Control: private, no-store`.
         */
        get: operations["getAdminRider"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita datos de un motorista o lo traslada de sucursal
         * @description F27. Exige `riders.update` en la sucursal ACTUAL y, si cambia `branchId`, también en la DESTINO (ambas dentro del alcance; si no, 403 `RIDER_ACTION_FORBIDDEN`) y `aal2`. `expectedVersion` es OBLIGATORIO y debe
         *     coincidir con `version`; si no, 409 `RIDER_VERSION_CONFLICT` sin guardar (`current` = versión vigente). Parcial: los campos omitidos no se tocan; `vehicleType`/`licensePlate` aceptan `null` para borrarlos. NO acepta `active`
         *     ni `availability` (rutas dedicadas). Cambiar `branchId` MUEVE el mismo registro (id, teléfono y vínculos históricos intactos; nunca se duplica) y lo deja `UNAVAILABLE` hasta que alguien lo marque disponible en la
         *     nueva sucursal; con entrega activa (F28) responde 409 `RIDER_HAS_ACTIVE_DELIVERY` (bloqueo de fila; sin reasignación masiva). Sucursal destino inexistente/inactiva => 422 `BRANCH_NOT_AVAILABLE`. Sin cambios
         *     reales => 200 sin escribir ni auditar. Audita `rider.updated` (solo nombres de campo) y/o `rider.branch_changed` (sucursal anterior y nueva). ≤ 5 sentencias SQL.
         */
        patch: operations["updateAdminRider"];
        trace?: never;
    };
    "/v1/admin/riders/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva a un motorista (no hay borrado físico)
         * @description F27. Exige `riders.update` en su sucursal y `aal2`. Establece `active` con valor explícito: idempotente (si ya tiene ese valor => 200 sin escribir ni auditar; sin `expectedVersion`, el último gana). Desactivar
         *     fuerza `availability = UNAVAILABLE` en la misma sentencia (un inactivo nunca es asignable) y, con entrega activa (F28), responde 409 `RIDER_HAS_ACTIVE_DELIVERY` sin cambiar nada. Reactivar NO lo marca
         *     disponible. Desactivar conserva el teléfono (para reactivar en vez de duplicar) y el historial. `reason` opcional (máx. 200; se valida pero no se guarda: la auditoría solo registra `hasReason`/`reasonLength`). Un cambio real sube `version` y audita `rider.activated`/`rider.deactivated`.
         *     ≤ 4 sentencias SQL.
         */
        patch: operations["updateAdminRiderStatus"];
        trace?: never;
    };
    "/v1/admin/riders/{id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Marca a un motorista disponible o no disponible (disponibilidad manual)
         * @description F27. Exige `riders.update` en su sucursal y `aal2`. Establece la disponibilidad MANUAL persistida (`AVAILABLE|UNAVAILABLE`); `BUSY` NO se puede enviar (es derivado de una entrega activa real de F28 y nunca se
         *     guarda). Idempotente (valor explícito, el último gana, sin `expectedVersion`; sin cambio => 200 sin escribir ni auditar). `AVAILABLE` exige motorista activo (409 `RIDER_INACTIVE`). `UNAVAILABLE` con entrega activa
         *     (F28) => 409 `RIDER_HAS_ACTIVE_DELIVERY`. NO reserva ni asigna nada. Un cambio real sube `version` y audita `rider.availability_changed`. ≤ 4 sentencias SQL.
         */
        patch: operations["updateAdminRiderAvailability"];
        trace?: never;
    };
    "/v1/admin/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Categorías del backoffice (lista plana, activas e inactivas)
         * @description F10. Exige JWT -> personal activo con `catalog.read` (cualquier alcance: las categorías son globales) -> `aal2`.
         *     Lista PLANA, sin paginar, con TODAS las categorías que cumplan los filtros, tope documentado de 500 (`total`
         *     refleja las devueltas; se garantiza que el catálogo de categorías no excede ese tope: crear la 501 => 422
         *     `CATEGORY_LIMIT_REACHED`). Cada elemento trae `effectivelyVisible` (activa y con todos los ancestros activos) y
         *     `depth` (raíz = 1) para que la UI pinte el árbol. Orden: profundidad-primero por `sortOrder`, `name`, `id` entre
         *     hermanos (el orden en que se pintaría el árbol). Los filtros se aplican sobre esa lista sin reordenarla. Respuesta
         *     `Cache-Control: no-store`.
         */
        get: operations["listAdminCategories"];
        put?: never;
        /**
         * Crea una categoría
         * @description F10. Exige `catalog.create` con alcance GLOBAL (todas las sucursales; una asignación solo de sucursal => 403) y
         *     `aal2`. `name` se normaliza (NFC, recorte, colapso de espacios; 1-80). `slug` opcional: si falta se genera desde
         *     el nombre (minúsculas, sin acentos, kebab) y se desambigua con sufijo numérico; si se envía y ya existe => 409
         *     `CATEGORY_SLUG_TAKEN` (también ante creaciones concurrentes). `parentId` null o ausente = raíz; un padre
         *     inexistente o inactivo => 422 `CATEGORY_PARENT_INVALID`; superar 3 niveles => 422 `CATEGORY_DEPTH_EXCEEDED`.
         *     La nueva categoría se coloca al final de sus hermanos (`sortOrder` = máximo + 1). Se audita en la misma
         *     transacción (`category.created`). Respuesta `no-store`.
         */
        post: operations["createAdminCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/categories/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordena los hijos de un padre (o las raíces)
         * @description F10. Exige `catalog.update` con alcance GLOBAL y `aal2`. `orderedIds` debe contener EXACTAMENTE todos los hermanos
         *     actuales de `parentId` (`null` = raíces; incluye inactivos), sin duplicados ni ajenos; si no => 422
         *     `CATEGORY_REORDER_MISMATCH` sin escribir. `parentId` inexistente => 404. Asigna `sortOrder` 0..n-1 en una
         *     transacción bajo bloqueo (el resultado concurrente es uno de los órdenes enviados, nunca mezclado). Idempotente:
         *     repetir el mismo orden responde 200 sin escribir ni auditar. Un cambio real audita `category.reordered`.
         *     Responde 200 con la lista de hermanos ya ordenada. Respuesta `no-store`.
         */
        put: operations["reorderAdminCategories"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita una categoría (incluye mover y activar/desactivar)
         * @description F10. Exige `catalog.update` con alcance GLOBAL y `aal2`. Acepta `name`, `slug`, `description` (`null` la borra),
         *     `parentId` (`null` = pasa a raíz) y `active`; al menos un campo (si no, 400); cualquier otro => 400. No existe
         *     borrado físico: se desactiva con `active=false`. Desactivar un padre NO modifica a sus hijos (quedan con
         *     `active=true` pero `effectivelyVisible=false`). Mover: destino inexistente o inactivo => 422
         *     `CATEGORY_PARENT_INVALID`; destino ella misma o un descendiente => 422 `CATEGORY_CYCLE`; si el subárbol resultante
         *     pasa de 3 niveles => 422 `CATEGORY_DEPTH_EXCEEDED`. Al cambiar de padre pasa al final de sus nuevos hermanos.
         *     Slug ya usado => 409 `CATEGORY_SLUG_TAKEN`. Si ningún valor cambia responde 200 sin escribir ni auditar. Se audita
         *     `category.updated` (old/new solo de lo cambiado) y, si cambia `active`, `category.activated` o `category.deactivated`.
         *     Respuesta `no-store`.
         */
        patch: operations["updateAdminCategory"];
        trace?: never;
    };
    "/v1/store/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Productos públicos visibles (paginado, con búsqueda y filtro por categoría)
         * @description F11. Sin autenticación. Un producto es visible solo si está activo Y su categoría es efectivamente visible (F10: ella y
         *     todos sus ancestros activos). `categorySlug` filtra por esa categoría y todas sus descendientes visibles; un slug
         *     inexistente o no visible => lista vacía (200). `q` busca (contiene, sin distinguir mayúsculas ni acentos) SOLO en nombre
         *     y descripción (el SKU no es buscable públicamente); los comodines `%`, `_` y `\` se tratan como texto literal; máx. 80 caracteres. Orden estable `name`, `id`.
         *     Cada elemento trae precio base (`basePrice`, cadena decimal) y las imágenes referenciadas; NO trae SKU ni datos
         *     administrativos. El precio por sucursal y la disponibilidad (F13), los modificadores (F12) y las promociones (F15) NO forman
         *     parte de este contrato todavía. Caché compartida corta (`Cache-Control: public`); sin `ETag`. Límite de tasa propio (60/min por IP). `page` <= 200.
         */
        get: operations["listStoreProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/store/products/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ficha pública de un producto visible (con oferta de sucursal opcional)
         * @description F11 + F12, ampliada en F17 de forma ADITIVA. Sin autenticación. Devuelve la ficha con imágenes ordenadas (F14), la cadena de ancestros visibles de su categoría (raíz -> padre) para el
         *     breadcrumb y los grupos de modificadores ofrecibles (F12). 404 `PRODUCT_NOT_FOUND` si el slug no existe, el producto está inactivo o su categoría no es visible (no se distingue el motivo). Sin SKU.
         *
         *     `branchId` (OPCIONAL, nuevo en F17; inexistente o inactiva => 404 `BRANCH_NOT_FOUND`): añade `offer` (precio EFECTIVO y disponibilidad de ESA sucursal, F13) y `promotions` (las promociones
         *     públicas indicativas vigentes que aplican al producto, F15; nunca cupones ni códigos; máx. 3, la de mayor ahorro primero) más `generatedAt` y `nextChangeAt`. SIN `branchId` esos cuatro campos
         *     se omiten y la respuesta es la de F11/F12. La ficha NO calcula totales, no aplica descuentos ni valida la selección de extras (F19) y no es el carrito (F18): los precios son INFORMATIVOS
         *     y el servidor recalcula al cotizar. Nunca incluye favoritos ni datos del cliente (los pide la web aparte con `listMyFavorites`).
         *
         *     Caché: SIN `branchId` se conserva `public, max-age=60, stale-while-revalidate=300` (sin `ETag`); CON `branchId` rige la política acotada de `getStoreBootstrap` (`public, max-age=min(N,5),
         *     s-maxage=N`, `N` en 1..15, `no-store` si `nextChangeAt` ya pasó), sin `stale-while-revalidate` ni `ETag`. Los errores llevan `no-store`.
         */
        get: operations["getStoreProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Productos del backoffice (paginado, activos e inactivos)
         * @description F11. Exige JWT -> personal activo con `catalog.read` (cualquier alcance: los productos son globales) -> `aal2`. Filtros:
         *     `q` (nombre, slug, descripción o SKU; contiene, sin distinguir mayúsculas ni acentos; comodines literales; máx. 80),
         *     `categoryId` (solo esa categoría exacta, sin descendientes) y `active`. Orden por defecto `name`, `id`; `sort`/`order`
         *     cambian el campo principal y `id` desempata siempre. Cada elemento trae `publiclyVisible` (activo y categoría visible) y la
         *     categoría con su estado, aunque esté inactiva. Una consulta para la página + una para sus imágenes (sin N+1). Respuesta
         *     `Cache-Control: no-store`.
         */
        get: operations["listAdminProducts"];
        put?: never;
        /**
         * Crea un producto
         * @description F11. Exige `catalog.create` con alcance GLOBAL (una asignación solo de sucursal => 403) y `aal2`. `name` se normaliza (NFC,
         *     recorte, colapso de espacios; 1-120); `description` es texto plano (<= 2000). `basePrice` es una cadena decimal positiva
         *     (`"85.00"`; hasta 6 enteros y 2 decimales; > 0 y <= 999999.99); fuera de forma/rango => 400. `slug` opcional: si falta se
         *     genera desde el nombre y se desambigua con sufijo numérico; si se envía y existe => 409 `PRODUCT_SLUG_TAKEN`. `sku` opcional
         *     y único (se normaliza a mayúsculas, 1-40, `A-Z0-9._-`); repetido => 409 `PRODUCT_SKU_TAKEN`. `categoryId` debe existir y
         *     estar ACTIVA (no se exige visibilidad efectiva) => si no, 422 `PRODUCT_CATEGORY_INVALID`. `media` opcional (máx. 8; el orden del
         *     arreglo define `sortOrder`): URL `https` <= 2048 caracteres; si no => 422 `PRODUCT_MEDIA_INVALID`. Las URL deben existir ya
         *     (la subida de archivos es F14). La unicidad se garantiza con los índices únicos (409 también ante concurrencia). Se audita
         *     `product.created` en la misma transacción. Respuesta `no-store`.
         */
        post: operations["createAdminProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle administrativo de un producto
         * @description F11. Exige `catalog.read` (cualquier alcance) y `aal2`. Incluye inactivos y productos con categoría inactiva. Respuesta
         *     `Cache-Control: no-store`.
         */
        get: operations["getAdminProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita un producto (incluye activar/desactivar y reemplazar imágenes)
         * @description F11. Exige `catalog.update` con alcance GLOBAL y `aal2`. Parcial: acepta `name`, `slug`, `sku` (`null` lo borra),
         *     `description` (`null` la borra), `basePrice`, `categoryId`, `active` y `media`; al menos un campo (si no, 400); cualquier otro
         *     => 400. Si se envía `media` REEMPLAZA la lista completa (`[]` la vacía; orden del arreglo = `sortOrder`); si se omite no
         *     se toca. No existe borrado físico: se desactiva con `active=false` (el histórico de pedidos conserva snapshots). Cambiar
         *     `categoryId` exige categoría existente y ACTIVA => 422 `PRODUCT_CATEGORY_INVALID`; editar un producto que ya está en una
         *     categoría inactiva SIN cambiar `categoryId` se permite. Slug/SKU repetidos => 409; imágenes inválidas => 422
         *     `PRODUCT_MEDIA_INVALID`. Si ningún valor cambia responde 200 sin escribir ni auditar. Se audita `product.updated`
         *     (old/new solo de lo cambiado) y, si cambia `active`, `product.activated` o `product.deactivated`. Respuesta `no-store`.
         */
        patch: operations["updateAdminProduct"];
        trace?: never;
    };
    "/v1/admin/modifier-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Grupos de modificadores (paginado, activos e inactivos)
         * @description F12. Exige JWT -> personal activo con `catalog.read` (cualquier alcance: el catálogo es global) -> `aal2`. Filtros: `q` (nombre del grupo;
         *     contiene, sin distinguir mayúsculas ni acentos; `%`, `_` y `\` literales; máx. 80) y `active` (sin valor = todos). Orden fijo `name`, `id`. Paginado
         *     (`pageSize` <= 100, por defecto 20): el editor de productos pide `active=true&pageSize=100`. Cada elemento es un RESUMEN (sin opciones) con
         *     `optionCount`, `activeOptionCount` y `productCount` calculados en una sola consulta agregada (sin N+1); el detalle con opciones es
         *     `getAdminModifierGroup`. `required` es derivado (`minSelect >= 1`), no se almacena. Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminModifierGroups"];
        put?: never;
        /**
         * Crea un grupo de modificadores (opcionalmente con sus opciones)
         * @description F12. Exige `catalog.create` con alcance GLOBAL y `aal2`. `name` se normaliza (NFC, recorte, colapso de espacios; 1-80) y es único sin distinguir
         *     mayúsculas => 409 `MODIFIER_GROUP_NAME_TAKEN`. `minSelect` (por defecto 0) y `maxSelect` (por defecto 1) deben ser enteros con
         *     0 <= minSelect <= maxSelect, 1 <= maxSelect <= 20; el DTO solo valida el TIPO entero (400) y el rango/relación responde 422
         *     `MODIFIER_LIMITS_INVALID`. `options` opcional (máx. 30; más => 422 `MODIFIER_LIMIT_REACHED`; el orden del arreglo define `sortOrder`; nombres
         *     únicos dentro del grupo => 409 `MODIFIER_NAME_TAKEN`): permite crear un grupo obligatorio ya con opciones. Si el grupo se crea
         *     activo (por defecto) y `minSelect` > nº de opciones activas => 422 `MODIFIER_LIMITS_INVALID` (inalcanzable); un grupo inactivo no tiene esa restricción. Se audita
         *     `modifier_group.created` (y `modifier.created` por cada opción) en la misma transacción. Respuesta `no-store`.
         */
        post: operations["createAdminModifierGroup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/modifier-groups/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de un grupo con todas sus opciones
         * @description F12. Exige `catalog.read` y `aal2`. Incluye opciones activas e inactivas ordenadas por `sortOrder`, `optionCount`, `activeOptionCount` y
         *     `productCount`. Respuesta `Cache-Control: no-store`.
         */
        get: operations["getAdminModifierGroup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita un grupo (nombre, límites, activar/desactivar)
         * @description F12. Exige `catalog.update` con alcance GLOBAL y `aal2`. Parcial: `name`, `minSelect`, `maxSelect`, `active`; al menos un campo (si no, 400);
         *     cualquier otro => 400. Bajo bloqueo de la fila del grupo (`FOR NO KEY UPDATE`). Invariante: un grupo ACTIVO debe tener al menos `minSelect` opciones activas.
         *     Se valida con los valores resultantes: `minSelect > maxSelect`, `maxSelect` fuera de 1-20, `minSelect` < 0 o un grupo activo con `minSelect` mayor que sus
         *     opciones activas (incluida la REACTIVACIÓN) => 422 `MODIFIER_LIMITS_INVALID`. Nombre repetido => 409 `MODIFIER_GROUP_NAME_TAKEN`. Desactivar un
         *     grupo es siempre posible y lo oculta de la tienda; no se borra ni se desasocia de los productos. Sin borrado físico (los pedidos de F20 guardan snapshots).
         *     Si ningún valor cambia => 200 sin escribir ni auditar. Se audita `modifier_group.updated` (old/new solo de lo cambiado) y `modifier_group.activated|deactivated`. Respuesta `no-store`.
         */
        patch: operations["updateAdminModifierGroup"];
        trace?: never;
    };
    "/v1/admin/modifier-groups/{id}/modifiers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Crea una opción en un grupo
         * @description F12. Exige `catalog.create` con alcance GLOBAL y `aal2`. Bajo bloqueo de la fila del grupo. `name` normalizado (1-80), único dentro del grupo sin
         *     distinguir mayúsculas => 409 `MODIFIER_NAME_TAKEN`. `extraPrice` cadena decimal `"0.00"`-`"9999.99"` (0.00 permitido; nunca `number`); fuera de
         *     forma/rango => 400. Máx. 30 opciones por grupo (activas e inactivas) => 422 `MODIFIER_LIMIT_REACHED`. `active` por defecto `true`. Se agrega al final (`sortOrder` = max + 1).
         *     Cada opción se elige 0 o 1 vez (sin cantidad por opción). Se audita `modifier.created`. Respuesta `no-store`.
         */
        post: operations["createAdminModifier"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/modifier-groups/{id}/modifiers/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordena las opciones de un grupo
         * @description F12. Exige `catalog.update` con alcance GLOBAL y `aal2`. `orderedIds` debe contener EXACTAMENTE todas las opciones del grupo (activas e inactivas), sin
         *     duplicados ni ajenas; si no => 422 `MODIFIER_REORDER_MISMATCH` sin escribir. Asigna `sortOrder` 0..n-1 bajo bloqueo de la fila del grupo. Idempotente: repetir el
         *     mismo orden responde 200 sin escribir ni auditar; un cambio real audita `modifier.reordered`. Responde 200 con la lista ya ordenada. Respuesta `no-store`.
         */
        put: operations["reorderAdminModifiers"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/modifiers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita una opción (nombre, precio extra, activar/desactivar)
         * @description F12. Exige `catalog.update` con alcance GLOBAL y `aal2`. Parcial: `name`, `extraPrice`, `active`; al menos un campo (si no, 400); cualquier otro => 400.
         *     Bajo bloqueo de la fila de su grupo. Nombre repetido en el grupo => 409 `MODIFIER_NAME_TAKEN`. Desactivar una opción que dejaría un grupo ACTIVO con menos
         *     opciones activas que `minSelect` => 422 `MODIFIER_GROUP_UNSATISFIABLE` (el administrador baja `minSelect` o desactiva el grupo primero). Sin borrado físico: los pedidos
         *     de F20 conservan snapshot de nombre y precio. Cambiar `extraPrice` NO afecta pedidos ya creados. Sin cambios => 200 sin escribir ni auditar. Se audita `modifier.updated` y
         *     `modifier.activated|deactivated`. Respuesta `no-store`.
         */
        patch: operations["updateAdminModifier"];
        trace?: never;
    };
    "/v1/admin/products/{id}/modifiers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Grupos de modificadores asociados a un producto (con opciones)
         * @description F12. Exige `catalog.read` y `aal2`. Devuelve, en el orden de asociación, los grupos del producto (activos e inactivos) con todas sus opciones
         *     (activas e inactivas), para el editor. Es la vista ADMINISTRATIVA: no representa lo que ve el público (ver `getStoreProduct`). Dos consultas como máximo
         *     (sin N+1). 404 `PRODUCT_NOT_FOUND` si el producto no existe (un producto inactivo SÍ se consulta). Respuesta `no-store`.
         */
        get: operations["getAdminProductModifiers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/modifier-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reemplaza la lista de grupos asociados a un producto
         * @description F12. Exige `catalog.update` con alcance GLOBAL y `aal2`. `groupIds` es la lista COMPLETA y ORDENADA de grupos del producto (`[]` los quita todos); el orden
         *     define `sortOrder`. Sin duplicados y como máximo 10 (11-50 => 422 `MODIFIER_LIMIT_REACHED`; más de 50 elementos => 400). Bajo bloqueo de la fila del producto
         *     (`FOR NO KEY UPDATE`), en una transacción: se insertan los grupos nuevos, se actualiza el orden y se ELIMINAN las asociaciones que ya no figuran (única operación de
         *     borrado de F12: solo la fila de asociación, nunca grupos ni opciones). Cada grupo NUEVO debe existir y estar ACTIVO; un duplicado, uno inexistente o uno
         *     inactivo recién añadido => 422 `MODIFIER_GROUP_INVALID` (un grupo ya asociado que luego se desactivó puede permanecer en la lista). Un producto cuyo
         *     grupo no se ofrece (inactivo o sin opciones suficientes) sigue visible en la tienda sin ese grupo. Si la lista y el orden no cambian => 200 sin escribir ni
         *     auditar; un cambio real audita `product.modifier_groups_replaced` (ids antes/después). Responde 200 con el resultado (misma forma que `getAdminProductModifiers`).
         *     Respuesta `no-store`.
         */
        put: operations["replaceAdminProductModifierGroups"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/store/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Agregado de arranque del Inicio por sucursal e idioma (público, acotado)
         * @description F17. Sin autenticación. UNA solicitud para pintar el Inicio, en lugar de varias: contexto público de la sucursal, categorías principales, productos destacados,
         *     promociones vigentes, banners y el contador del menú. NO devuelve el catálogo (tope fijo de elementos por sección) ni datos privados del cliente (favoritos, direcciones,
         *     pedidos y sesión se piden aparte con rutas autenticadas `/v1/me/...`), ni consulta PedidosYa/Neonet. `branchId` es opcional: sin él `branch`, `availability` son `null`, `promotions`
         *     va vacío, los banners son solo los de «todas las sucursales» (como `listStoreBanners`) y los destacados llevan el precio base y `available=null`; con él (inexistente o inactiva =>
         *     404 `BRANCH_NOT_FOUND`) todo se calcula para esa sucursal. `locale` (`es` por defecto | `en`) solo afecta a los banners (respaldo POR CAMPO a `es`: `fallbackFields`); los nombres de
         *     categorías y productos no tienen traducción en v1.
         *
         *     Composición (sin duplicar reglas): `branch` = campos de `getPublicBranch`; `availability` = `getBranchAvailability` (F08); `categories` = raíces visibles de F10 (máx. 30,
         *     `hasChildren` para saber si hay subcategorías; el árbol completo sigue en `listStoreCategories`); `featured` = productos destacados VISIBLES (F11/F10) con la misma tarjeta que
         *     `getStoreBranchMenu` (máx. 8, orden estable: criterio P23); `promotions` = las promociones automáticas y los cupones VIGENTES AHORA de `listStorePromotions` (F15) en su forma pública
         *     (nunca `code`; un cupón sale con `requiresCode=true` y sin descuento), máx. 5, SIN `items`; `banners` = `listStoreBanners` (F16), máx. 10; `productCount` = productos visibles de
         *     la sucursal (disponibles o no) para el pie del Inicio. Las secciones no críticas (`availability`, `featured`, `promotions`, `banners`) son independientes: si una falla, la respuesta
         *     sigue siendo 200 con esa sección vacía/`null` y su nombre en `degraded`; categorías, sucursal y `productCount` son críticas (error => 404/5xx).
         *
         *     Caché compartida acotada por el próximo cambio: `nextChangeAt` = el MENOR no nulo de `promotions` (cambio de vigencia), `banners` (inicio/fin) y `availability.nextTransitionAt`
         *     (apertura/cierre), siempre con horizonte de 14 días; `null` si no hay. `Cache-Control: public, max-age=min(N,5), s-maxage=N` con `N = clamp(segundos enteros hasta nextChangeAt
         *     medidos con generatedAt, 1, 15)` (15 si `nextChangeAt` es `null`), `no-store` si `nextChangeAt` ya pasó; si `degraded` no está vacío, `public, max-age=0, s-maxage=3` (acotado para no anular la CDN ante una sección que falla de forma persistente); sin `stale-while-revalidate` ni `ETag`;
         *     `Vary: Accept-Encoding` (sucursal e idioma van en la URL, nunca en cabeceras ni cookies; la respuesta no depende de `Authorization`). Una edición del backoffice (producto, precio,
         *     disponibilidad, categoría, promoción, banner, horario) puede tardar hasta 15 s en verse en la caché compartida. Los errores llevan `no-store`. Límite de tasa propio (60/min por IP).
         */
        get: operations["getStoreBootstrap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/store/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Búsqueda pública de productos del menú (paginada y acotada)
         * @description F17. Sin autenticación. Busca `q` (obligatoria, 2 a 80 caracteres tras recortar; los caracteres de control, de formato (bidi, ancho cero, guion blando) y NUL se RECHAZAN con 400, no se ignoran; los comodines `%`, `_` y `\` se tratan como texto literal) en el NOMBRE y la
         *     DESCRIPCIÓN del producto y en el NOMBRE de su categoría, sin distinguir mayúsculas ni acentos (mismo plegado que `listStoreProducts`: `salmon` encuentra «Salmón»). El SKU y el slug NO son buscables
         *     públicamente. Solo productos VISIBLES (F11: activos y con categoría efectivamente visible de F10); un producto oculto o inactivo nunca aparece. Con `branchId` (inexistente o inactiva =>
         *     404 `BRANCH_NOT_FOUND`) el `price` es el EFECTIVO de la sucursal (F13), `available` es booleano y `promo` trae la promoción indicativa vigente (F15); sin él, `price` es el base y `available`
         *     es `null` (desconocido). `available=true` deja solo los disponibles en la sucursal (exige `branchId`; sin él => 400); sin valor se devuelven todos y los agotados salen con `available=false`
         *     (la web los muestra deshabilitados: P25). `categorySlug` restringe a una categoría visible y sus descendientes visibles (inexistente o no visible => lista vacía). Sin resultados es válido (200,
         *     `items=[]`, `total=0`). Orden ESTABLE y determinista: 1) nombre empieza por `q`, 2) nombre contiene `q`, 3) solo coincide en descripción o categoría; dentro de cada grupo `name`, `id`. Tope
         *     de páginas 20 y `pageSize` <= 50 (como máximo 1.000 resultados alcanzables). Tarjeta mínima: sin modificadores ni relaciones completas (eso es `getStoreProduct`). No hay `locale`: los nombres no tienen
         *     traducción en v1 (P26). Caché compartida acotada igual que `getStoreBootstrap` (`N` en 1..15; `nextChangeAt` solo por promociones vigentes de los resultados; `null` si no hay), `no-store` en errores;
         *     sin `ETag`/`stale-while-revalidate`. Límite de tasa propio y más bajo que el de lectura general: 30/min por IP en esta ruta.
         */
        get: operations["searchStoreProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/store/menu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Menú público por sucursal en tarjetas (precio efectivo, disponibilidad e info promocional), paginado
         * @description F13 (overlay) ampliado en F17 de forma ADITIVA. Sin autenticación. Devuelve las TARJETAS de los productos públicamente visibles (F11: activo Y categoría efectivamente visible de F10), en el
         *     orden del menú (categorías en el orden del árbol, luego `name`, `id`; `sort`/`order` lo cambian). Cada tarjeta conserva los 4 campos de F13 (`productId`, `slug`, `price`, `available`) y añade
         *     `name`, `summary` (descripción corta: texto plano <= 160 caracteres, recortado sin partir palabras), `image` (la imagen principal, F14, o `null`), `category` (referencia mínima) y `promo` (la
         *     promoción pública indicativa vigente de F15 con mayor ahorro, o `null`; nunca un cupón ni un código). SIN modificadores, sin galería, sin SKU, sin descripción completa ni relaciones: eso es
         *     `getStoreProduct`. `price` es el EFECTIVO de la sucursal (`price_override` o base) y NO expone el precio base ni si hay override (nunca el precio de otra sucursal). Sin stock numérico:
         *     `available=false` = «agotado/no disponible». Es INFORMATIVO: la validación DEFINITIVA al cotizar/crear el pedido (F19/F20) se hace en el servidor.
         *
         *     Cambios F17 respecto a F13 (todos aditivos o relajaciones; ver ADR-0023): (1) `branchId` pasa a OPCIONAL: sin él `price` es el base y `available` es `null`; con él inexistente o inactiva => 404
         *     `BRANCH_NOT_FOUND`; ya no hay 400 por falta de `branchId` (sí por forma inválida). (2) Paginación `page`/`pageSize` (<= 100, por defecto 100): antes devolvía TODO sin paginar; un catálogo visible
         *     de <= 100 productos se comporta igual que antes, y desde 101 el consumidor DEBE seguir `total` (la web lo hace). (3) Filtros `categorySlug` (con descendientes visibles; inexistente o no visible =>
         *     lista vacía) y `available`. (4) La respuesta añade `page`, `pageSize`, `total`, `generatedAt` y `nextChangeAt`. (5) La caché pasa de `public, max-age=15` a la política acotada de
         *     `getStoreBootstrap` (`max-age=min(N,5)`, `s-maxage=N`, `N` en 1..15; `nextChangeAt` solo por promociones vigentes de la página), sin `stale-while-revalidate` ni `ETag`; la edición del
         *     backoffice tarda <= 15 s en verse, igual que en F13. Los errores llevan `no-store`. Límite de tasa propio (60/min por IP).
         */
        get: operations["getStoreBranchMenu"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Matriz de precio y disponibilidad de los productos de una sucursal (backoffice)
         * @description F13. Exige `catalog.read` EN ESA SUCURSAL y `aal2`; sucursal inexistente o fuera del alcance del empleado => 404 `BRANCH_NOT_FOUND` (no se distingue). Una
         *     sucursal inactiva SÍ se puede consultar. Lista TODOS los productos del catálogo (activos e inactivos, categoría visible o no) con `basePrice`, `priceOverride`
         *     (`null` = sin override), `effectivePrice`, `available` y `offered` (`true` si el público lo ve en esa sucursal: producto visible Y `available`). Ausencia de fila
         *     en `branch_products` = disponible al precio base. Filtros: `q` (nombre, slug o SKU; contiene, sin distinguir mayúsculas ni acentos; comodines literales; máx. 80),
         *     `categoryId` (categoría exacta), `available`, `hasOverride`. Orden fijo `name`, `id`. Una consulta para la página (+ `count`), sin N+1. Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminBranchProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Matriz de precio y disponibilidad de un producto por sucursal (backoffice)
         * @description F13. Exige `catalog.read` y `aal2`. Devuelve una fila por cada sucursal (activa o inactiva) DENTRO DEL ALCANCE de `catalog.read` del empleado (`scopeFor`: global =
         *     todas; acotado = solo las suyas; nunca aparecen sucursales ajenas), ordenadas por `name`, `id`. Cada fila trae `priceOverride`, `effectivePrice`, `available` y
         *     `offered`. 404 `PRODUCT_NOT_FOUND` si el producto no existe (un producto inactivo SÍ se consulta). Una consulta para la sucursales + una para las filas de
         *     `branch_products` (sin N+1). Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminProductBranches"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/branches/{id}/products/{productId}/pricing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Fija o elimina el precio de sucursal (override) de un producto
         * @description F13. Exige `catalog.update` EN ESA SUCURSAL (`canAccess`) y `aal2`. Orden de comprobaciones: sucursal fuera de alcance o inexistente => 404 `BRANCH_NOT_FOUND`;
         *     luego producto inexistente => 404 `PRODUCT_NOT_FOUND` (un producto inactivo u oculto SÍ admite precio, para prepararlo). `priceOverride` es cadena decimal
         *     `^[0-9]{1,6}\.[0-9]{2}$` (nunca `number`; un número JSON, otra forma o más de 999999.99 => 400) o `null` para ELIMINAR el override. Una cadena bien formada pero <= 0
         *     (`"0.00"`) => 422 `BRANCH_PRICE_INVALID`. Un override igual al precio base es un override válido (congela el precio de la sucursal frente a cambios futuros del base).
         *     Semántica de fila: solo existe fila en `branch_products` si hay override o `available=false`; al borrar el override con `available=true` la fila se ELIMINA. Idempotente: si el estado
         *     resultante coincide con el vigente => 200 sin escribir ni auditar. Escritura atómica por upsert/delete de la fila (PK compuesta; sin lock global; el último en escribir gana, sin control optimista).
         *     Auditoría en la misma transacción: `branch_product.price_set` o `branch_product.price_cleared` (`branchId`, `productId`, precio anterior y nuevo), sin PII. Responde 200 con el estado
         *     resultante (si la fila se eliminó, `available=true`, `priceOverride=null`, `updatedAt=null`). Respuesta `no-store`.
         */
        put: operations["setAdminBranchProductPricing"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Marca un producto como disponible o agotado en una sucursal
         * @description F13. Exige `catalog.manage_availability` EN LA SUCURSAL del cuerpo (`canAccess`) y `aal2`. Sucursal inexistente o fuera de alcance => 404 `BRANCH_NOT_FOUND`; luego producto
         *     inexistente => 404 `PRODUCT_NOT_FOUND` (un producto inactivo u oculto SÍ admite el cambio). `available=false` crea o actualiza la fila (conserva el override);
         *     `available=true` sin override ELIMINA la fila (vuelve al valor por defecto). NO es stock: no hay cantidades. Idempotente: sin cambio => 200 sin escribir ni auditar. Auditoría
         *     `branch_product.availability_changed` (`branchId`, `productId`, valor anterior y nuevo) en la misma transacción, sin PII. Responde 200 con el estado resultante. El cambio es visible en
         *     el menú público en <= 15 s (caché de `getStoreBranchMenu`); la verificación definitiva en checkout es inmediata. Respuesta `no-store`.
         */
        patch: operations["setAdminProductAvailability"];
        trace?: never;
    };
    "/v1/admin/media/upload-intents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Autoriza una subida directa a R2 (URL PUT firmada de corta vida)
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Valida `kind` (`PRODUCT_IMAGE` o `BANNER_IMAGE`; la clave del objeto usa el prefijo del tipo y `BANNER_IMAGE` admite como máximo 1 MiB, si no => 422 `MEDIA_TOO_LARGE`; en v1 el permiso sigue siendo `catalog.update` global para ambos tipos, ver spec F16), `mimeType` (solo `image/jpeg`, `image/png`, `image/webp`, `image/avif`; otro => 422
         *     `MEDIA_TYPE_NOT_ALLOWED`; SVG y GIF se rechazan a propósito), `sizeBytes` (> 0 y <= `MEDIA_MAX_BYTES`, por defecto 5 MiB; si no => 422 `MEDIA_TOO_LARGE`) y `checksumSha256` (SHA-256 del archivo
         *     en hexadecimal minúsculas, 64 caracteres). Si ya existe un asset READY del mismo `kind` y checksum => 200 con `deduplicated=true`, ese asset y SIN `uploadUrl` (no hay nada que subir).
         *     Si no => 201: crea un asset `PENDING` con clave de objeto inmutable `products/<yyyy>/<uuid>.<ext>` (extensión derivada del MIME aceptado, nunca del nombre del cliente) y devuelve `uploadUrl`
         *     (PUT SigV4 contra el endpoint S3 de R2, vigencia <= `MEDIA_UPLOAD_TTL_SECONDS`, por defecto 300 s), los `headers` que el navegador DEBE enviar tal cual (`Content-Type`, `Cache-Control`
         *     `public, max-age=31536000, immutable`, `x-amz-checksum-sha256` en base64) y `expiresAt`. Los bytes viajan del navegador a R2: nunca por la API. La URL firmada solo existe en esta respuesta (no se
         *     persiste ni se registra) y la respuesta es `no-store`. Cada empleado puede tener como máximo 50 intents `PENDING` vigentes (si no => 422 `MEDIA_PENDING_LIMIT_REACHED`); al crear un intent se purgan de
         *     forma perezosa los `PENDING` caducados. Sin almacenamiento configurado => 503 `MEDIA_STORAGE_UNAVAILABLE` (el resto de la API sigue funcionando). `storageMode=MOCK` marca el adaptador en memoria
         *     (solo desarrollo/pruebas; nunca prueba nada real). Auditoría sin PII: `media.upload_intent_created` (`assetId`, `mimeType`, `sizeBytes`).
         */
        post: operations["createAdminMediaUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/media/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirma una subida: verifica el objeto en R2 y deja el asset READY
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Con el `assetId` de un intent: si ya es READY responde 200 sin tocar nada (idempotente). Si es PENDING y el intent expiró => 410
         *     `MEDIA_UPLOAD_EXPIRED` (hay que pedir otro intent). Si no, la API consulta R2 con `HeadObject` (existencia, tamaño, `Content-Type`, checksum SHA-256) y lee los primeros ~32 bytes (GET con rango)
         *     para comprobar la FIRMA REAL del archivo (JPEG, PNG, WebP o AVIF) frente al MIME declarado. Objeto ausente => 422 `MEDIA_OBJECT_MISSING` (el asset sigue PENDING y se puede reintentar dentro de la vigencia).
         *     Tamaño, tipo, checksum o firma que no coinciden => se BORRA el objeto y el asset y se responde 422 `MEDIA_CONTENT_MISMATCH` (hay que pedir otro intent). Si es correcto, el asset pasa a READY y la respuesta
         *     incluye su `url` pública HTTPS estable (`R2_PUBLIC_BASE_URL` + clave). Si otro asset READY con el mismo checksum ganó la carrera, el objeto propio se elimina y se responde 200 con ESE asset (el `id` puede
         *     diferir del enviado). Auditoría sin PII: `media.confirmed` o `media.rejected`. Respuesta `no-store`.
         */
        post: operations["completeAdminMediaUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Biblioteca de medios (paginada)
         * @description F14. Exige `catalog.read` (cualquier alcance: el catálogo es global) y `aal2`. Filtros `kind`, `status` y `unreferenced`; orden `createdAt` descendente y `id`. Cada elemento trae `usageCount`
         *     (cuántas filas de `product_media` MÁS banners lo referencian) y `url` (null mientras esté PENDING). Una consulta para la página + una para los conteos (sin N+1). No toca R2. Respuesta `no-store`.
         */
        get: operations["listAdminMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de un asset y dónde se usa
         * @description F14. Exige `catalog.read` y `aal2`. Devuelve el asset y la lista `usages` (producto y fila de `product_media`). 404 `MEDIA_NOT_FOUND` si no existe. No consulta R2. Respuesta `no-store`.
         */
        get: operations["getAdminMedia"];
        put?: never;
        post?: never;
        /**
         * Elimina un asset que ningún producto usa (y su objeto en R2)
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Si algún `product_media` lo referencia => 409 `MEDIA_IN_USE` (la FK `ON DELETE RESTRICT` es el respaldo ante carreras). Si no, elimina la
         *     fila en una transacción (con auditoría `media.deleted`, sin PII) y DESPUÉS borra el objeto en R2; si ese borrado falla la fila ya no existe (nunca queda una referencia colgante) y se registra una
         *     advertencia con la clave del objeto para su limpieza; el endpoint responde igualmente 204. Sin almacenamiento configurado => 503 `MEDIA_STORAGE_UNAVAILABLE` sin tocar la fila. Repetir la llamada tras el
         *     éxito responde 404 `MEDIA_NOT_FOUND` sin efectos. Respuesta `no-store`.
         */
        delete: operations["deleteAdminMedia"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Adjunta un asset READY a un producto
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Añade el asset al FINAL de la lista del producto (`sortOrder` = tamaño actual). Reglas: producto inexistente => 404 `PRODUCT_NOT_FOUND`; asset
         *     inexistente => 404 `MEDIA_NOT_FOUND`; asset PENDING => 422 `MEDIA_ASSET_NOT_READY`; ya adjunto al mismo producto => 409 `MEDIA_ALREADY_ATTACHED`; más de 8 imágenes => 422 `PRODUCT_MEDIA_INVALID` (mismo tope y
         *     código que F11). `altText` opcional (<= 200; si no => 422 `PRODUCT_MEDIA_INVALID`). `media_url` se deriva del asset (URL pública estable). Un mismo asset puede usarse en varios productos. Auditoría sin PII:
         *     `product.media_attached` (`productId`, `assetId`). Responde 201 con el elemento creado. `no-store`.
         */
        post: operations["attachAdminProductMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/media/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordena las imágenes de un producto
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. `orderedIds` (ids de `product_media`, no de assets) debe contener EXACTAMENTE todas las imágenes actuales del producto, sin duplicados ni ajenas; si no =>
         *     422 `MEDIA_REORDER_MISMATCH` sin escribir. Asigna `sortOrder` 0..n-1 en una transacción bajo bloqueo de la fila del producto. Idempotente: repetir el mismo orden responde 200 sin escribir ni auditar; un
         *     cambio real audita `product.media_reordered`. Producto inexistente => 404 `PRODUCT_NOT_FOUND`. Responde 200 con la lista ordenada. `no-store`.
         */
        put: operations["reorderAdminProductMedia"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/media/{mediaId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Desvincula una imagen del producto (no borra el asset)
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Elimina la fila de `product_media` y renumera `sortOrder` de las restantes (0..n-1) en la misma transacción. NO borra el asset ni el objeto
         *     en R2 (se gestionan en la biblioteca de medios). 404 `PRODUCT_NOT_FOUND` o `PRODUCT_MEDIA_NOT_FOUND`. Auditoría sin PII: `product.media_detached` (`productId`, `assetId`). Responde 204. `no-store`.
         */
        delete: operations["detachAdminProductMedia"];
        options?: never;
        head?: never;
        /**
         * Edita el texto alternativo de una imagen del producto
         * @description F14. Exige `catalog.update` con alcance GLOBAL y `aal2`. Solo `altText` (`null` o cadena vacía lo borra; <= 200 => si no 422 `PRODUCT_MEDIA_INVALID`). No cambia el orden ni el asset. 404 `PRODUCT_NOT_FOUND`
         *     o `PRODUCT_MEDIA_NOT_FOUND` (la imagen no pertenece a ese producto). Idempotente: sin cambio => 200 sin auditar. Responde 200 con el elemento. `no-store`.
         */
        patch: operations["updateAdminProductMedia"];
        trace?: never;
    };
    "/v1/store/promotions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Promociones y Happy Hour vigentes o próximas de una sucursal (público, solo informativo)
         * @description F15. Sin autenticación. `branchId` obligatorio (sucursal ACTIVA; inexistente o inactiva => 404 `BRANCH_NOT_FOUND`, sin distinguir). `state`: `live` (por defecto; vigente AHORA: `active`,
         *     `validFrom <= ahora < validUntil` y, si hay `schedule`, el instante local de `America/Guatemala` cae en algún tramo `[startsAt, endsAt)` de su día ISO) o `upcoming` (activa, NO vigente
         *     ahora y con un próximo inicio dentro de los próximos 14 días, sea por `validFrom` futuro o por el siguiente tramo semanal; las vigentes ahora se excluyen aunque tengan otro tramo futuro). Solo promociones que aplican a esa sucursal (las de «todas las sucursales» incluidas).
         *     El horario de apertura de la sucursal (F08) NO interviene: una promoción puede estar `live` con la sucursal cerrada; F19 valida ambos.
         *     Datos públicos únicamente: NUNCA se devuelve el código de un cupón; una promoción con código sale con `requiresCode=true` y SIN `kind`, `value`, `productIds` ni `items` (no se revela el
         *     descuento de un cupón por esta vía). `isHappyHour` = promoción automática con `schedule` no vacío (derivado; no hay columna). `items` (solo promociones automáticas con productos
         *     seleccionados, máx. 50): precio regular y precio promocional INDICATIVO calculados en el servidor con el mismo evaluador que usará F19 (cantidad 1, precio de la sucursal de F13,
         *     solo productos visibles y disponibles, esa promoción por sí sola, sin cupón ni otras promociones); NO es una cotización: el total definitivo lo fija F19/F20 en el servidor y puede diferir.
         *     `dineInOnly=true` significa «solo consumo en el local»: nunca aplica a pedidos de recojo o entrega. Máx. 100 promociones (primero `live`, luego por `validFrom`, `id`); `truncated`
         *     indica si se recortó. Caché compartida acotada por el próximo cambio de estado: `Cache-Control: public, max-age=min(N,5), s-maxage=N` con `N = clamp(segundos enteros hasta nextChangeAt, 1, 30)` (el navegador cachea como máximo 5 s; la caché compartida hasta N)
         *     (`no-store` si `nextChangeAt` ya pasó), sin `stale-while-revalidate` ni `ETag` (la respuesta no lleva cabecera `ETag`); una edición del backoffice puede tardar hasta 30 s en verse en público (F19 revalida al cotizar); `Vary` solo `Accept-Encoding` (la respuesta no depende de cookies ni de `Authorization`). Los errores llevan
         *     `no-store`. Límite de tasa propio (60/min por IP).
         */
        get: operations["listStorePromotions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/promotions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Promociones del backoffice (paginado, con filtros)
         * @description F15. Exige `promotions.read` y `aal2`. Alcance por sucursal: con alcance global ve todas; con alcance acotado solo las que aplican a alguna de sus sucursales (incluidas las de «todas las
         *     sucursales»), con `branchIds` recortado a su alcance y `editable=false` si no cubre todas las sucursales de la promoción. Filtros: `branchId` (promociones que aplican a esa sucursal;
         *     fuera de alcance o inexistente => 404 `BRANCH_NOT_FOUND`), `status` (`active` = `active=true`; `inactive`; `scheduled` = activa y aún no empieza; `running` = activa y dentro de
         *     `[startsAt, endsAt)` (sin mirar el horario semanal; ver `liveNow`); `expired` = activa y ya terminó; el ciclo de vida usa precedencia inactive > expired > scheduled > running), `kind`,
         *     `from`/`to` (instantes; promociones cuyo `[startsAt, endsAt)` se solapa con `[from, to)`), `q` (nombre o código; contiene, sin distinguir mayúsculas ni acentos; comodines literales; máx. 80).
         *     Orden por defecto `startsAt` descendente, `id`; `id` desempata siempre. Una consulta para la página + una para sus sucursales (sin N+1). Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminPromotions"];
        put?: never;
        /**
         * Crea una promoción o cupón
         * @description F15. Exige `promotions.create` y `aal2`. Alcance: `branchScope=ALL` exige alcance GLOBAL del permiso (si no, 403 `PROMOTION_SCOPE_FORBIDDEN`); `SELECTED` exige que TODAS las `branchIds`
         *     estén dentro del alcance (una sucursal inexistente o fuera de alcance => 404 `BRANCH_NOT_FOUND`, sin distinguir). `productScope` es explícito: `ALL` (todos los productos; `productIds`
         *     debe omitirse o venir vacío; si no, 400) o `SELECTED` (1..200 productos existentes; si no, 422 `PROMOTION_SCOPE_INVALID` con `violations` por `productIds[i]`). `code` (opcional; `null` u omitido
         *     = promoción AUTOMÁTICA; con valor = CUPÓN) se normaliza (recorta espacios y pasa a mayúsculas); único sin distinguir mayúsculas => 409 `PROMOTION_CODE_TAKEN`. `kind` `PERCENT`
         *     (`0 < value <= 100`) o `FIXED_AMOUNT` (monto en GTQ POR UNIDAD, `0 < value <= 999999.99`); otro `value` bien formado pero fuera de rango => 422 `PROMOTION_VALUE_INVALID`.
         *     `startsAt`/`endsAt` son instantes con zona; `endsAt > startsAt` (si no, 422 `PROMOTION_PERIOD_INVALID`). `schedule` (opcional; vacío u omitido = todos los días y todo el día dentro de la
         *     vigencia): tramos semanales `[startsAt, endsAt)` en hora local de `America/Guatemala`, `weekday` ISO 1..7, sin cruzar la medianoche (se parten en dos días; `endsAt` puede ser `24:00`),
         *     sin solaparse en el mismo día y <= 6 por día; más de 42 tramos en total => 400 (`maxItems`); reglas de negocio (`SLOT_ENDS_BEFORE_START`, `SLOT_OVERLAP`, `SLOT_LIMIT` por día) => 422 `PROMOTION_SCHEDULE_INVALID` con `violations`. `dineInOnly` por defecto `false`; `active` por defecto
         *     `true`. Nace con `version=1`. Se audita `promotion.created` en la misma transacción (sin PII). Respuesta `no-store`.
         */
        post: operations["createAdminPromotion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/promotions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle administrativo de una promoción
         * @description F15. Exige `promotions.read` y `aal2`. Inexistente o que no aplica a ninguna sucursal del alcance del actor => 404 `PROMOTION_NOT_FOUND` (no se distingue). Incluye el código del cupón
         *     (solo el personal con permiso lo ve), productos con nombre, tramos y `version`. Respuesta `Cache-Control: no-store`.
         */
        get: operations["getAdminPromotion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita una promoción (parcial, con concurrencia optimista)
         * @description F15. Exige `promotions.update` y `aal2`. `expectedVersion` es OBLIGATORIO y debe coincidir con `version`; si no, 409 `PROMOTION_VERSION_CONFLICT` sin guardar. Parcial: además de
         *     `expectedVersion` al menos un campo entre `name`, `description`, `code` (`null` la convierte en automática), `kind`, `value`, `startsAt`, `endsAt`, `dineInOnly`, `branchScope`/`branchIds`,
         *     `productScope`/`productIds`, `schedule` (reemplaza TODOS los tramos; `[]` = sin restricción semanal); `active` NO se acepta (usa `PATCH .../status`). Las reglas de `POST` se
         *     validan sobre el estado RESULTANTE (p. ej. cambiar `kind` a `PERCENT` revalida `value`). Alcance: el actor debe cubrir TODAS las sucursales de la promoción, tanto las actuales como las
         *     nuevas (`ALL` exige alcance global); una promoción que no toca su alcance => 404 `PROMOTION_NOT_FOUND`; que la toca pero no la cubre entera => 403 `PROMOTION_SCOPE_FORBIDDEN`. Si
         *     ningún valor cambia responde 200 sin escribir, sin subir `version` y sin auditar. Un cambio real sube `version` en 1 y audita `promotion.updated` (old/new solo de lo cambiado) en la misma
         *     transacción. Editar una promoción en curso rige de inmediato en el servidor (la caché pública puede tardar hasta 30 s). Respuesta `no-store`.
         */
        patch: operations["updateAdminPromotion"];
        trace?: never;
    };
    "/v1/admin/promotions/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva una promoción (no hay borrado físico)
         * @description F15. Exige `promotions.update` con las mismas reglas de alcance que `PATCH /v1/admin/promotions/{id}` (404 `PROMOTION_NOT_FOUND` si no la toca; 403 `PROMOTION_SCOPE_FORBIDDEN` si no la
         *     cubre entera). Establece `active` con valor explícito: idempotente (si ya tiene ese valor => 200 sin escribir ni auditar); no usa `expectedVersion` (el último valor gana). Un cambio real
         *     sube `version` y audita `promotion.status_changed` (`oldActive`/`newActive`, `reason` opcional <= 200 sin PII) en la misma transacción. Desactivar NO borra la promoción ni afecta a pedidos ya creados:
         *     solo deja de ofrecerse y de evaluarse. Reactivar una ya vencida es válido (sigue vencida). Respuesta `no-store`.
         */
        patch: operations["updateAdminPromotionStatus"];
        trace?: never;
    };
    "/v1/store/banners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Banners publicados del Inicio de la tienda (público, solo lectura)
         * @description F16. Sin autenticación. Devuelve SOLO los banners elegibles AHORA, ya ordenados (`sortOrder`, `createdAt`, `id`) y recortados a un máximo de 10, sin datos administrativos (sin `code`, versión, auditoría ni ids de
         *     promoción). `branchId` es opcional: sin él solo salen los banners de `branchScope=ALL`; con él, los `ALL` más los `SELECTED` que incluyen esa sucursal (inexistente o inactiva => 404 `BRANCH_NOT_FOUND`). `locale`
         *     (`es` por defecto | `en`) elige el idioma de los textos con respaldo POR CAMPO a `es` (`fallbackFields` lista los campos que vinieron en español para que la web marque `lang="es"`); una cadena vacía cuenta como ausente.
         *     Un banner es elegible si: `active`; `startsAt <= ahora < endsAt` (cada extremo puede faltar; instantes, `America/Guatemala` solo para mostrar); su imagen es un asset READY de tipo `BANNER_IMAGE` con URL pública
         *     disponible; tiene traducción válida (título e imagen alt en `es`); si apunta a producto o categoría, ese destino está activo; y, si está vinculado a una promoción de F15, la promoción está VIGENTE ahora (`active`,
         *     vigencia y horario semanal) y aplica a la sucursal consultada (si no, el banner se oculta; no hay error). Un banner vinculado a un cupón NO revela el código ni el descuento: la respuesta nunca incluye datos de la
         *     promoción. F16 no calcula precios ni descuentos. Una lista vacía es una respuesta válida (200). `nextChangeAt` = próximo instante (<= 14 días) en que puede cambiar el conjunto publicado por tiempo (inicio/fin de
         *     banner o cambio de vigencia de una promoción vinculada); `null` si no hay. Caché compartida acotada igual que `listStorePromotions`: `public, max-age=min(N,5), s-maxage=N` con `N = clamp(segundos enteros hasta
         *     nextChangeAt, 1, 30)`, `no-store` si ya pasó; sin `stale-while-revalidate` ni `ETag`; `Vary: Accept-Encoding` (el idioma va en la URL). Una edición del backoffice puede tardar hasta 30 s en verse. Imágenes: URL pública
         *     permanente (nunca firmada). Límite de tasa 60/min por IP.
         */
        get: operations["listStoreBanners"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/banners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Banners del backoffice (paginado, con filtros)
         * @description F16. Exige `banners.read` y `aal2`. Alcance por sucursal (patrón F15): con alcance global ve todos; con alcance acotado solo los que aplican a alguna de sus sucursales (incluidos los de «todas»), con `branches` recortado
         *     a su alcance y `editable=false` si no cubre todas las de cada banner. Filtros: `branchId` (banners que aplican a esa sucursal; fuera de alcance o inexistente => 404 `BRANCH_NOT_FOUND`), `lifecycle` (estado derivado:
         *     `INACTIVE` = `active=false`; `EXPIRED` = activo con `endsAt <= ahora` (para el tope de 100 y el reordenado «vencido» es `endsAt <= ahora` por fecha, independiente de `active`); `SCHEDULED` = activo con `startsAt > ahora`; `PUBLISHED` = activo y dentro de la vigencia; precedencia INACTIVE > EXPIRED > SCHEDULED > PUBLISHED),
         *     `q` (título en cualquier idioma o código; contiene, sin distinguir mayúsculas ni acentos; comodines literales; máx. 80). Orden por defecto `priority` (`sortOrder`, `createdAt`, `id`: es el orden de la tienda); `id` desempata
         *     siempre. Una consulta para la página + una para sus sucursales y traducciones (sin N+1). `visibleNow` y `hiddenReason` se calculan con el reloj del servidor. Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminBanners"];
        put?: never;
        /**
         * Crea un banner
         * @description F16. Exige `banners.create` y `aal2`. Alcance: `branchScope=ALL` exige alcance GLOBAL del permiso (si no, 403 `BANNER_SCOPE_FORBIDDEN`); `SELECTED` exige que TODAS las `branchIds` estén en el alcance (sucursal
         *     inexistente o fuera de alcance => 404 `BRANCH_NOT_FOUND`); `SELECTED` vacío o `ALL` con `branchIds` => 422 `BANNER_SCOPE_INVALID`. `code` (obligatorio, minúsculas `^[a-z0-9][a-z0-9-]{2,63}$`, se normaliza recortando y
         *     pasando a minúsculas; INMUTABLE después) único => 409 `BANNER_CODE_TAKEN`. `imageAssetId`: asset existente, `READY` y de tipo `BANNER_IMAGE`; si no => 422 `BANNER_IMAGE_INVALID` (violations `ASSET_UNKNOWN`,
         *     `ASSET_NOT_READY`, `ASSET_KIND_MISMATCH`). `translations.es` es obligatoria (`title` 1..80 y `imageAlt` 1..200 tras recortar; si no => 422 `BANNER_TRANSLATION_INVALID`); `translations.en` es opcional y, vacía, se
         *     ignora; un campo en blanco se guarda como ausente. `cta` (destino estructurado; sin rutas ni URL de texto libre): `NONE`, `MENU`, `PROMOTIONS`, `CATEGORY` (`categoryId` activo), `PRODUCT` (`productId` activo) o `PAGE`
         *     (`page` de la lista blanca); datos incoherentes con el tipo o destino inexistente/inactivo => 422 `BANNER_CTA_INVALID`. Los enlaces externos NO se permiten en v1. `startsAt`/`endsAt` son instantes con zona, ambos
         *     opcionales (sin `endsAt` = sin fin); `endsAt > startsAt` (si no, 422 `BANNER_PERIOD_INVALID`). `promotionId` (opcional): promoción existente cuyo alcance de sucursales cubre el del banner (si no, 422
         *     `BANNER_PROMOTION_INVALID`); el banner solo se publica mientras esa promoción esté vigente. `sortOrder` (opcional, 0..9999; por defecto = último + 1). `active` por defecto `true`. Más de 100 banners no vencidos => 422
         *     `BANNER_LIMIT_REACHED`. Nace con `version=1`. Audita `banner.created` en la misma transacción (sin PII). Respuesta `no-store`.
         */
        post: operations["createAdminBanner"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/banners/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordena los banners no vencidos (prioridad atómica)
         * @description F16. Exige `banners.update` con alcance GLOBAL (el orden es único para toda la cadena) y `aal2`; un alcance acotado => 403 `BANNER_SCOPE_FORBIDDEN`. `orderedIds` debe contener EXACTAMENTE los banners NO vencidos
         *     (activos o no, programados o publicados; los vencidos quedan fuera), sin duplicados ni ajenos; si no => 422 `BANNER_REORDER_MISMATCH` sin escribir (recarga la lista y reintenta). Asigna `sortOrder` 0..n-1 en una
         *     transacción bajo bloqueo (el resultado concurrente es uno de los órdenes enviados, nunca mezclado) y sube `version` solo de los banners cuyo `sortOrder` cambia. Idempotente: repetir el mismo orden responde 200 sin
         *     escribir ni auditar. Un cambio real audita `banner.reordered`. Respuesta `no-store`. Para mover UN banner basta `PATCH` de `sortOrder` (la prioridad no es única: el empate se resuelve por `createdAt` e `id`).
         */
        put: operations["reorderAdminBanners"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/banners/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle administrativo de un banner
         * @description F16. Exige `banners.read` y `aal2`. Inexistente o que no aplica a ninguna sucursal del alcance del actor => 404 `BANNER_NOT_FOUND` (no se distingue). Incluye ambas traducciones tal como se guardaron (sin respaldo) y
         *     el estado derivado. `Cache-Control: no-store`.
         */
        get: operations["getAdminBanner"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edita un banner (parcial, con concurrencia optimista)
         * @description F16. Exige `banners.update` y `aal2`. `expectedVersion` es OBLIGATORIO y debe coincidir con `version`; si no, 409 `BANNER_VERSION_CONFLICT` sin guardar. Parcial: los campos omitidos NO se tocan (no se reemplazan).
         *     Admite `imageAssetId`, `translations` (por idioma y por campo: omitir = sin cambio; `null` en un campo opcional lo borra; `translations.en: null` elimina la traducción al inglés; `es.title` y `es.imageAlt` no pueden
         *     quedar vacíos), `cta`, `startsAt`/`endsAt` (`null` = sin extremo), `branchScope`/`branchIds` (reemplaza TODAS las sucursales), `promotionId` (`null` lo desvincula) y `sortOrder`; `code` e `active` NO se aceptan
         *     (`active` usa `PATCH .../status`). Las reglas de `POST` se validan sobre el estado RESULTANTE. Alcance: el actor debe cubrir TODAS las sucursales del banner, las actuales y las nuevas (`ALL` exige alcance global);
         *     un banner que no toca su alcance => 404 `BANNER_NOT_FOUND`; que lo toca pero no lo cubre entero => 403 `BANNER_SCOPE_FORBIDDEN`. Reemplazar la imagen NO borra el asset anterior (queda en la biblioteca de medios de F14).
         *     Si ningún valor cambia responde 200 sin escribir, sin subir `version` y sin auditar. Un cambio real sube `version` en 1 y audita `banner.updated` (old/new solo de lo cambiado: ids de asset, CTA, fechas, ids de sucursal,
         *     prioridad y claves de texto cambiadas; sin PII) en la misma transacción. Respuesta `no-store`.
         */
        patch: operations["updateAdminBanner"];
        trace?: never;
    };
    "/v1/admin/banners/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Activa o desactiva un banner (idempotente, sin versión)
         * @description F16. Exige `banners.update` con las mismas reglas de alcance que `PATCH /v1/admin/banners/{id}` (404 `BANNER_NOT_FOUND` si no lo toca; 403 `BANNER_SCOPE_FORBIDDEN` si no lo cubre entero). Idempotente: sin
         *     `expectedVersion` (el último valor gana); si `active` ya tiene ese valor responde 200 sin escribir ni auditar. Un cambio real sube `version` en 1 y audita `banner.status_changed` (`oldActive`, `newActive`, `reason`).
         *     Desactivar NO borra el banner ni su imagen. Respuesta `no-store`.
         */
        patch: operations["updateAdminBannerStatus"];
        trace?: never;
    };
    "/v1/admin/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Entregas propias del backoffice (paginado por cursor, ligero)
         * @description F28 (spec 029, ADR-0032). Exige `deliveries.read` y `aal2`. LISTADO ligero (sin teléfono, dirección completa, notas ni historial: eso es `getAdminDelivery`). Alcance por sucursal EN SQL
         *     (`branch_id = ANY(sucursales con deliveries.read)`; alcance global = todas): nunca se filtra en la web. `branchId` fuera de alcance o inexistente => 404 `BRANCH_NOT_FOUND`.
         *     Filtros: `status` (lista separada por comas; por defecto los estados ABIERTOS `pending,assigned,picked_up,delivered`, sin ventana de fechas), `riderId`, `from`/`to` (instantes de `createdAt`; solo acotan los
         *     estados terminales `returned|cancelled`; por defecto `from = ahora − 7 días`; rango máximo 92 días, si no 400). `status=delivered` = «esperando retorno» (el motorista sigue ocupado). Orden FIJO `createdAt`
         *     descendente, `id` descendente; paginación por CURSOR opaco (`nextCursor`; `null` = última página); un cursor alterado => 400 `DELIVERY_CURSOR_INVALID` (el alcance se aplica SIEMPRE en la consulta). Sin conteo
         *     total. UNA sentencia SQL (JOIN `orders`, `branches`, `order_addresses` solo municipio y zona, `riders` solo nombre y vehículo). Sin PII del cliente. `Cache-Control: private, no-store`. Solo entregas propias
         *     (`OWN`); PedidosYa no tiene filas (F29, `BLOCKED_EXTERNAL`).
         */
        get: operations["listAdminDeliveries"];
        put?: never;
        /**
         * Crea (o reabre) la entrega propia de un pedido elegible
         * @description F28 (spec 029 §7). Exige `deliveries.assign` en la sucursal del pedido y `aal2`; el personal debe poder VER el pedido (`deliveries.read` en esa sucursal; si no => `ORDER_NOT_FOUND`, el mismo 404 que un pedido inexistente).
         *     Crea la entrega en `pending` (sin motorista) para un pedido DELIVERY con proveedor `OWN` en `accepted|preparing|ready`; si no => 422 `DELIVERY_ORDER_NOT_ELIGIBLE` (`violations[].code`: `ORDER_STATUS_NOT_DISPATCHABLE`,
         *     `ORDER_NOT_DELIVERY`, `ORDER_PROVIDER_NOT_OWN`, que incluye `PEDIDOSYA`: `BLOCKED_EXTERNAL`, F29). IDEMPOTENTE por pedido (`UNIQUE(order_id)`): si ya existe y está abierta => 200 con `transition.replayed=true` y la fila
         *     vigente SIN escribir; si existe `cancelled` => se REABRE a `pending` (201, evento `reopened`). 201 al crear o reabrir. No cambia el pedido. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["createAdminDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalle de una entrega propia (con historial)
         * @description F28. Exige `deliveries.read` y `aal2`. Inexistente o de una sucursal fuera del alcance => el MISMO 404 `DELIVERY_NOT_FOUND` (anti-IDOR). Incluye pedido, motorista (nombre, vehículo y teléfono ENMASCARADO; el teléfono
         *     completo es de `getAdminRider` con `riders.read`), tiempos, acciones disponibles para ESTE personal y el historial cronológico (≤ 50 eventos con `old_status`, `status`, evento, motorista, motivo interno y quién). El contacto y la
         *     dirección del cliente (`customer`, `address`) SOLO se devuelven si la entrega está ABIERTA y el personal tiene además `orders.read` en la sucursal (si no, `null` con `contactVisible=false`); las lecturas no se auditan.
         *     ≤ 2 sentencias SQL (fila con JOINs + historial). `Cache-Control: private, no-store`.
         */
        get: operations["getAdminDelivery"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/assign-own-rider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Asigna (o reasigna antes de la recogida) un motorista propio
         * @description F28 (spec 029 §8). Exige `deliveries.assign` Y `riders.assign` en la sucursal de la entrega, y `aal2`. Válido desde `pending` (asignar) o `assigned` (REASIGNAR antes de la recogida; el motorista anterior queda libre y el
         *     historial conserva ambos). Dentro de UNA transacción: `SELECT … FOR UPDATE` del motorista, luego de la entrega, `FOR SHARE` del pedido (orden de bloqueos motorista → entrega → pedido), `RiderEligibilityService.evaluate`
         *     (activo, misma sucursal que el PEDIDO, `AVAILABLE`, no ocupado, `ownDeliveryZonesEnabled`) y compare-and-set por `expectedVersion`. El pedido debe seguir en `accepted|preparing|ready`. Un motorista inexistente o
         *     que el personal no puede ver (`riders.read`) => 404 `RIDER_NOT_FOUND` (la sucursal del motorista nunca se devuelve); no elegible => 422 `RIDER_NOT_ELIGIBLE` (`violations[].code` ∈ `INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`,
         *     `BUSY`, `OWN_DELIVERY_DISABLED`). Doble asignación imposible: índice único parcial «una entrega activa por motorista» (la carrera pierde con 422 `RIDER_NOT_ELIGIBLE`/`BUSY`) y `UNIQUE(order_id)`. Repetir la MISMA asignación
         *     (mismo motorista, `version = expectedVersion + 1`, último evento `rider_assigned|rider_reassigned` a ese motorista) => 200 `replayed=true`. NO cambia el pedido. ≤ 9 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["assignOwnRiderToAdminDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/unassign-rider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Quita el motorista de una entrega asignada (vuelve a pendiente)
         * @description F28 (spec 029 §6). Exige `deliveries.assign` y `aal2`. Solo `assigned → pending` (antes de la recogida). Libera al motorista (sin él, la entrega deja de contar como ocupación) y conserva el historial (`rider_unassigned`, con el
         *     motorista liberado). `reason` opcional (3..280, interno: no pongas datos personales). NO cambia el pedido. ≤ 4 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["unassignRiderFromAdminDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/mark-picked-up": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirma la recogida: la entrega pasa a `picked_up` y el pedido `ready → on_the_way`
         * @description F28 (spec 029 §6). Exige `deliveries.update` y `aal2`. Solo `assigned → picked_up` con el pedido en `ready`. En la MISMA transacción: la entrega cambia por compare-and-set y el pedido cambia SOLO por
         *     `OrderTransitionsService.apply(tx, …, allowOwnDispatch: true)` (misma matriz, compare-and-set, historial y auditoría `order.dispatched` de F22; jamás SQL directo a `orders`). Pedido fuera de `ready` => 409
         *     `ORDER_STATE_CONFLICT` con `current`, sin escribir nada. El motorista sigue ocupado. ≤ 7 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["markAdminDeliveryPickedUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/mark-delivered": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirma la entrega al cliente: `picked_up → delivered` y el pedido `on_the_way → delivered`
         * @description F28 (spec 029 §6). Exige `deliveries.update` y `aal2`. Solo `picked_up → delivered` con el pedido en `on_the_way`. Misma transacción y mismo mecanismo que `mark-picked-up` (auditoría `order.delivered`). El
         *     motorista SIGUE OCUPADO hasta registrar `return-to-branch` (el retorno es un evento SEPARADO). No registra cobro de efectivo ni rendición de caja (F24 ya registra el cobro del personal; la rendición es otra feature).
         *     La entrega fallida/no entregada queda fuera de F28 (P107). ≤ 7 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["markAdminDeliveryDelivered"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/return-to-branch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Registra el retorno del motorista al restaurante (libera su ocupación)
         * @description F28 (spec 029 §6). Exige `deliveries.update` y `aal2`. Solo `delivered → returned` (terminal). El retorno es un evento SEPARADO de la entrega al cliente: libera al motorista (deja de estar ocupado y vuelve a ser
         *     asignable según su disponibilidad manual de F27). No toca el pedido (ya `delivered`). Si el retorno no se registró en su momento, se registra después con este mismo comando (liberación manual con permiso y rastro
         *     en el historial); no hay temporizadores automáticos. ≤ 4 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["returnAdminDeliveryToBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/deliveries/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancela una entrega aún no recogida (`pending|assigned → cancelled`, motivo obligatorio)
         * @description F28 (spec 029 §9). Exige `deliveries.update` y `aal2`. Solo `pending|assigned → cancelled` (nunca desde `picked_up`: el pedido ya está en manos del motorista). Libera al motorista y es terminal para la entrega
         *     (se puede REABRIR con `createAdminDelivery` mientras el pedido siga despachable). `reason` OBLIGATORIO (3..280; falta => 400 `DELIVERY_REASON_REQUIRED`), interno. Es el paso previo para cancelar un pedido con entrega
         *     abierta: `cancelAdminOrder` responde 409 `ORDER_HAS_ACTIVE_DELIVERY` mientras exista una entrega `pending|assigned|picked_up`. NO cambia el pedido. ≤ 4 sentencias SQL.
         *
         *     Comando de entrega propia (`OWN`). Autorización: JWT + aal2 + personal activo; alcance EN SQL con `deliveries.read` (404 uniforme) y luego el permiso del comando EN LA SUCURSAL DE LA ENTREGA (403 `DELIVERY_ACTION_FORBIDDEN`).
         *     Cuerpo con `expectedVersion` OBLIGATORIO (la `version` que la persona vio). Comparación y cambio en UNA transacción corta (`SELECT … FOR UPDATE` de la entrega, compare-and-set por versión, fila de `delivery_status_history` y auditoría `delivery.*`).
         *     REPETICIÓN IDEMPOTENTE: si la entrega YA está en el estado destino, `version = expectedVersion + 1` y el último evento del historial es exactamente este comando, responde 200 con `transition.replayed=true` SIN
         *     duplicar historial ni auditoría, sea quien sea el actor (`appliedByMe` lo indica); cualquier otra discrepancia => 409 `DELIVERY_STATE_CONFLICT` con `current`. Sin `Idempotency-Key`. `Cache-Control: private, no-store`.
         */
        post: operations["cancelAdminDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description Campos públicos de una sucursal activa (nada administrativo). */
        PublicBranch: {
            /** Format: uuid */
            id: string;
            /** @description Identificador de negocio estable (slug en minúsculas). */
            code: string;
            name: string;
            address: string;
            phone: string | null;
            latitude: number | null;
            longitude: number | null;
        };
        PublicBranchListResponse: {
            items: components["schemas"]["PublicBranch"][];
        };
        AdminBranch: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
            address: string;
            phone: string | null;
            latitude: number | null;
            longitude: number | null;
            /** @description Estado ADMINISTRATIVO. No es "abierta ahora" (F08) ni "acepta pedidos". */
            active: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        AdminBranchPage: {
            items: components["schemas"]["AdminBranch"][];
            page: number;
            pageSize: number;
            /** @description Total de sucursales que cumplen el filtro y el alcance. */
            total: number;
        };
        CreateBranchRequest: {
            /** @description Se recorta y pasa a minúsculas; luego debe cumplir ^[a-z0-9]+(-[a-z0-9]+)*$. */
            code: string;
            name: string;
            address: string;
            /** @description Opcional. Dígitos con +, espacios, guiones y paréntesis; 7 a 15 dígitos. */
            phone?: string | null;
            latitude?: number | null;
            longitude?: number | null;
            /**
             * @description Estado inicial (por defecto activa).
             * @default true
             */
            active: boolean;
        };
        UpdateBranchRequest: {
            name?: string;
            address?: string;
            phone?: string | null;
            latitude?: number | null;
            longitude?: number | null;
        };
        UpdateBranchStatusRequest: {
            active: boolean;
            /** @description Obligatorio al desactivar; opcional al activar. */
            reason?: string;
        };
        BranchRef: {
            /** Format: uuid */
            id: string;
            name: string;
            code: string;
        };
        /**
         * @description Alcance de UN permiso: `allBranches` (asignación global) o las sucursales ACTIVAS donde lo posee.
         *     Solo cuentan asignaciones activas de personal activo hacia sucursales activas.
         */
        GrantScope: {
            allBranches: boolean;
            branchIds: string[];
        };
        /**
         * @description Derivado de `staff_users.auth_user_id`: PENDING_LINK = preautorizado, aún sin iniciar sesión con Google;
         *     LINKED = identidad vinculada. Independiente de `active`.
         * @enum {string}
         */
        StaffIdentityStatus: "PENDING_LINK" | "LINKED";
        RoleRef: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
        };
        StaffAssignmentView: {
            role: components["schemas"]["RoleRef"];
            /** @description null = alcance GLOBAL (todas las sucursales; solo el rol admin). */
            branch: components["schemas"]["BranchRef"] | null;
            /** @description false si la asignación está inactiva o su sucursal está inactiva (no concede acceso operativo). */
            effective: boolean;
        };
        StaffRef: {
            /** Format: uuid */
            id: string;
            fullName: string;
        };
        /** @description Nunca incluye `authUserId`. */
        AdminStaff: {
            /** Format: uuid */
            id: string;
            fullName: string;
            /** @description Minúsculas. */
            email: string;
            active: boolean;
            identityStatus: components["schemas"]["StaffIdentityStatus"];
            /**
             * Format: date-time
             * @description null si PENDING_LINK o vinculado antes de F03.
             */
            linkedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @description null = proceso manual (bootstrap) o anterior a F03. */
            createdBy: components["schemas"]["StaffRef"] | null;
            assignments: components["schemas"]["StaffAssignmentView"][];
            /** @description El solicitante puede modificar a este empleado (alcance completo y roles otorgables). Solo orienta la UI. */
            manageable: boolean;
        };
        AdminStaffPage: {
            items: components["schemas"]["AdminStaff"][];
            page: number;
            pageSize: number;
            /** @description Total que cumple filtros y alcance. */
            total: number;
        };
        StaffAssignmentInput: {
            /** Format: uuid */
            roleId: string;
            /**
             * Format: uuid
             * @description null = global (solo con el rol admin y solo otorgable con alcance global).
             */
            branchId: string | null;
        };
        CreateStaffRequest: {
            fullName: string;
            /**
             * Format: email
             * @description Se normaliza a minúsculas.
             */
            email: string;
            assignments: components["schemas"]["StaffAssignmentInput"][];
        };
        UpdateStaffRequest: {
            fullName?: string;
            /**
             * Format: email
             * @description Solo mientras PENDING_LINK.
             */
            email?: string;
        };
        UpdateStaffStatusRequest: {
            active: boolean;
            /** @description Obligatorio al desactivar. */
            reason?: string;
        };
        ReplaceStaffAssignmentsRequest: {
            assignments: components["schemas"]["StaffAssignmentInput"][];
        };
        PermissionRef: {
            /** @example orders.accept */
            code: string;
            description: string;
            /** @description Prefijo del código (orders, staff...). */
            module: string;
        };
        AdminRole: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
            /** @description Solo lectura (no editable por API). */
            isSystem: boolean;
            permissions: components["schemas"]["PermissionRef"][];
            /** @description Empleados activos con una asignación activa de este rol. */
            assignedStaffCount: number;
        };
        AdminRoleList: {
            items: components["schemas"]["AdminRole"][];
        };
        ReplaceRolePermissionsRequest: {
            permissions: string[];
        };
        AdminPermissionModule: {
            module: string;
            permissions: {
                code: string;
                description: string;
            }[];
        };
        AdminPermissionCatalog: {
            items: components["schemas"]["AdminPermissionModule"][];
        };
        AuthStaffAssignment: {
            role: components["schemas"]["StaffRole"];
            /**
             * Format: uuid
             * @description null = todas las sucursales.
             */
            branchId: string | null;
        };
        AuthStaffContext: {
            /** Format: uuid */
            staffId: string;
            fullName: string;
            assignments: components["schemas"]["AuthStaffAssignment"][];
            /** @description Unión de permisos de los roles con asignación activa. */
            permissions: components["schemas"]["StaffPermission"][];
            /**
             * @deprecated
             * @description Unión plana de todos los roles (solo orienta la UI; NUNCA autoriza). Usa `grants` para saber dónde aplica
             *     cada permiso.
             */
            allBranches: boolean;
            /** @deprecated */
            branchIds: string[];
            /**
             * @description F03. Permiso -> alcance (`GrantScope`), calculado en el servidor solo con asignaciones activas de personal
             *     activo hacia sucursales activas. Sin caché entre solicitudes: la revocación es inmediata.
             */
            grants: {
                [key: string]: components["schemas"]["GrantScope"];
            };
            /** @description Sucursales ACTIVAS sobre las que el empleado tiene algún permiso (todas las activas si tiene alcance global). */
            branches: components["schemas"]["BranchRef"][];
        };
        AuthContextResponse: {
            /**
             * Format: uuid
             * @description auth.users.id (claim sub).
             */
            authUserId: string;
            email: string | null;
            /** @description Proveedor de identidad (p. ej. google). */
            provider: string | null;
            /** @description Existe un perfil de cliente para esta identidad. */
            isCustomer: boolean;
            /**
             * @description Nivel de aseguramiento de ESTA sesión, leído del JWT verificado (aal2 = TOTP verificado).
             * @enum {string}
             */
            aal: "aal1" | "aal2";
            /** @description Personal activo con asignación activa (independiente del nivel MFA). */
            staffAuthorized: boolean;
            /** @description Personal autorizado cuya sesión aún no es aal2 (debe configurar o verificar TOTP). */
            mfaRequired: boolean;
            /**
             * @description NOT_STAFF = sin autorización administrativa; MFA_REQUIRED = personal activo en aal1;
             *     GRANTED = personal activo en aal2.
             * @enum {string}
             */
            access: "NOT_STAFF" | "MFA_REQUIRED" | "GRANTED";
            /** @description Solo con `access = GRANTED`; null en cualquier otro caso (nada administrativo antes de aal2). */
            staff: components["schemas"]["AuthStaffContext"] | null;
            /** @description Igual a `access = GRANTED`. Indicador para la UI; el acceso real lo decide cada endpoint. */
            backofficeAccess: boolean;
        };
        AdminContextResponse: {
            /** Format: uuid */
            authUserId: string;
            email: string | null;
            /** @enum {string} */
            aal: "aal2";
            staff: components["schemas"]["AuthStaffContext"];
        };
        CustomerProfile: {
            /** Format: uuid */
            id: string;
            fullName: string;
            email: string | null;
            phone: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        MeResponse: {
            /** Format: uuid */
            authUserId: string;
            /** @description Correo de la identidad de Supabase Auth (solo lectura). */
            email: string | null;
            customer: components["schemas"]["CustomerProfile"];
            isStaff: boolean;
        };
        /**
         * @description Campos editables del perfil comercial. Omitido = sin cambios. `phone: null` o cadena vacía borra el teléfono.
         *     Cualquier otra propiedad (identidad, correo, roles, permisos, `customerId`…) responde 400.
         */
        UpdateCustomerProfileRequest: {
            /**
             * @description Se recortan espacios y se colapsan los internos. Solo letras (incluidas tildes y ñ), espacios,
             *     apóstrofos, guiones y puntos; debe contener al menos una letra. Sin `null`.
             */
            fullName?: string;
            /**
             * @description Guatemala: 8 dígitos locales, con o sin `+502`/`502`; se guarda como `+502XXXXXXXX`.
             *     Otros países: `+` seguido de 8 a 15 dígitos (E.164), sin prefijo de país asumido.
             */
            phone?: string | null;
        };
        CustomerStorefrontContext: {
            /** Format: uuid */
            authUserId: string;
            /** @description Correo de la identidad (Auth), no editable. */
            email: string | null;
            /** @description Proveedor de identidad (p. ej. google). */
            provider: string | null;
            /**
             * Format: uri
             * @description Imagen de la identidad de Google (https, dominio permitido). Null si no existe. No se copia a almacenamiento propio.
             */
            avatarUrl: string | null;
            customer: components["schemas"]["CustomerProfile"];
            isStaff: boolean;
            /** @description Secciones de Mi cuenta sin contrato implementado todavía. No tienen contadores. */
            pendingSections: ("favorites" | "orders")[];
        };
        /**
         * @description Estado del producto favorito según el catálogo (enum abierto: tolerar valores futuros). `ACTIVE` = publicado y
         *     pedible; `UNAVAILABLE` = publicado pero no pedible ahora; `INACTIVE` = despublicado; `REMOVED` = ya no existe;
         *     `UNKNOWN` = no se pudo consultar el catálogo. Solo `ACTIVE` y `UNAVAILABLE` traen `product`.
         * @enum {string}
         */
        FavoriteProductStatus: "ACTIVE" | "INACTIVE" | "UNAVAILABLE" | "REMOVED" | "UNKNOWN";
        /**
         * @description Resumen público MÍNIMO que entrega el catálogo. Sin precios, sin disponibilidad por sucursal y sin datos internos
         *     (costos, notas, banderas administrativas). El precio vigente lo resuelve el catálogo de la sucursal elegida.
         */
        FavoriteProductSummary: {
            /** Format: uuid */
            id: string;
            name: string;
            nameEn: string | null;
            /** Format: uri */
            imageUrl: string | null;
            /** Format: uuid */
            categoryId: string | null;
        };
        FavoriteItem: {
            /** Format: uuid */
            productId: string;
            /** Format: date-time */
            addedAt: string;
            status: components["schemas"]["FavoriteProductStatus"];
            /** @description null cuando `status` no es `ACTIVE`/`UNAVAILABLE` (retirado, despublicado o catálogo no consultable). */
            product: components["schemas"]["FavoriteProductSummary"] | null;
        };
        CustomerFavorites: {
            /** @description Página pedida (vacía con `pageSize=0`). */
            items: components["schemas"]["FavoriteItem"][];
            page: number;
            pageSize: number;
            /** @description Cantidad total de favoritos del cliente (≤ `limit`). */
            total: number;
            /** @description TODOS los ids favoritos (≤ `limit`), más recientes primero. Fuente del estado `isFavorite` de las tarjetas. */
            favoriteProductIds: string[];
            /** @description Tope de favoritos por cliente (200). */
            limit: number;
            /**
             * @description `UNAVAILABLE` = el catálogo no pudo consultarse; los items vienen con `status = UNKNOWN` y `product = null`.
             * @enum {string}
             */
            catalogStatus: "AVAILABLE" | "UNAVAILABLE";
        };
        ReadyResponse: {
            /** @enum {string} */
            status: "ok";
            checks: {
                /** @enum {string} */
                database: "up";
                /** @enum {string} */
                schemaApp: "present";
            };
        };
        HealthResponse: {
            /** @enum {string} */
            status: "ok";
        };
        ErrorResponse: {
            statusCode: number;
            error: string;
            message: string;
            /** @description Identificador de la solicitud (igual a la cabecera X-Request-Id). */
            requestId?: string;
            /** @description Mensajes de validación por campo (solo en 400). */
            details?: string[];
            /**
             * @description Código de negocio estable y legible por máquina (opcional; p. ej. `HOURS_VERSION_CONFLICT`, `CLOSURE_OVERLAP`,
             *     `SCHEDULE_INVALID`, `BRANCH_SCHEDULE_BUSY`, `CLOSURE_LIMIT_REACHED`; F09: `DELIVERY_ZONE_DUPLICATE`, `DELIVERY_ZONE_VERSION_CONFLICT`, `MUNICIPALITY_NOT_FOUND`, `DEPARTMENT_NOT_FOUND`, `BRANCH_NOT_AVAILABLE`; F10: `CATEGORY_SLUG_TAKEN`, `CATEGORY_CYCLE`, `CATEGORY_DEPTH_EXCEEDED`, `CATEGORY_PARENT_INVALID`, `CATEGORY_REORDER_MISMATCH`, `CATEGORY_LIMIT_REACHED`; F11: `PRODUCT_NOT_FOUND`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_SKU_TAKEN`, `PRODUCT_CATEGORY_INVALID`, `PRODUCT_MEDIA_INVALID`; F12: `MODIFIER_GROUP_NOT_FOUND`, `MODIFIER_NOT_FOUND`, `MODIFIER_GROUP_NAME_TAKEN`, `MODIFIER_NAME_TAKEN`, `MODIFIER_LIMITS_INVALID`, `MODIFIER_GROUP_UNSATISFIABLE`, `MODIFIER_LIMIT_REACHED`, `MODIFIER_REORDER_MISMATCH`, `MODIFIER_GROUP_INVALID`; F13: `BRANCH_NOT_FOUND`, `BRANCH_PRICE_INVALID`, `PRODUCT_NOT_AVAILABLE` (solo servicio, F19), `BRANCH_NOT_AVAILABLE`; 503 reintentable: `CATEGORIES_BUSY`, `PRODUCTS_BUSY`, `MODIFIERS_BUSY`, `BRANCH_PRODUCTS_BUSY`; F14: `MEDIA_NOT_FOUND`, `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE`, `MEDIA_PENDING_LIMIT_REACHED`, `MEDIA_UPLOAD_EXPIRED` (410), `MEDIA_OBJECT_MISSING`, `MEDIA_CONTENT_MISMATCH`, `MEDIA_IN_USE`, `MEDIA_ALREADY_ATTACHED`, `MEDIA_ASSET_NOT_READY`, `MEDIA_REORDER_MISMATCH`, `PRODUCT_MEDIA_NOT_FOUND`, `MEDIA_STORAGE_UNAVAILABLE` (503), `MEDIA_BUSY` (503 reintentable); F15: `PROMOTION_NOT_FOUND`, `PROMOTION_CODE_TAKEN`, `PROMOTION_VERSION_CONFLICT`, `PROMOTION_VALUE_INVALID`, `PROMOTION_PERIOD_INVALID`, `PROMOTION_SCHEDULE_INVALID`, `PROMOTION_SCOPE_INVALID`, `PROMOTION_SCOPE_FORBIDDEN` (403), `PROMOTIONS_BUSY` (503 reintentable); F16: `BANNER_NOT_FOUND`, `BANNER_CODE_TAKEN`, `BANNER_VERSION_CONFLICT`, `BANNER_IMAGE_INVALID`, `BANNER_TRANSLATION_INVALID`, `BANNER_CTA_INVALID`, `BANNER_PERIOD_INVALID`, `BANNER_SCOPE_INVALID`, `BANNER_PROMOTION_INVALID`, `BANNER_REORDER_MISMATCH`, `BANNER_LIMIT_REACHED`, `BANNER_SCOPE_FORBIDDEN` (403), `BANNERS_BUSY` (503 reintentable); F19: `QUOTE_LIMITS_EXCEEDED` (400), `CHECKOUT_BUSY` (503 reintentable); F20: `IDEMPOTENCY_KEY_INVALID` (400), `QUOTE_CHANGED` (409), `QUOTE_EXPIRED` (409), `IDEMPOTENCY_KEY_REUSED` (409), `IDEMPOTENCY_IN_PROGRESS` (409), `QUOTE_INVALID` (422), `CHECKOUT_BLOCKED` (422), `DELIVERY_PROVIDER_NOT_SELECTABLE` (422), `CONTACT_INCOMPLETE` (422), `PENDING_ORDERS_LIMIT` (429), `ORDERS_BUSY` (503 reintentable), `ORDERS_UNAVAILABLE` (503); 404 de dirección ajena sin código; F22: `ORDER_NOT_FOUND` (404), `ORDER_REASON_REQUIRED` (400), `ORDER_CURSOR_INVALID` (400), `ORDER_ACTION_FORBIDDEN` (403), `ORDER_STATE_CONFLICT` (409), `ORDER_TRANSITION_INVALID` (422; `violations[].code`: `ORDER_TERMINAL`, `ORDER_FULFILLMENT_MISMATCH`, `ORDER_SOURCE_INVALID`, `ORDER_DISPATCH_NOT_AVAILABLE`, `ORDER_PROVIDER_BLOCKED_EXTERNAL`, `ORDER_CANCEL_NOT_ALLOWED`); 503 reintentable: `ORDERS_BUSY`; F24 (pagos en efectivo; `PAYMENT_METHOD_UNAVAILABLE` de F20 queda RETIRADO: ahora cualquier método distinto de `cash` es 400): `PAYMENT_AMOUNT_INVALID` (400), `PAYMENT_CONFIRMATION_REQUIRED` (400), `PAYMENT_ACTION_FORBIDDEN` (403), `PAYMENT_ALREADY_REGISTERED` (409), `ORDER_NOT_PAYABLE` (409), `CASH_AMOUNT_INSUFFICIENT` (422), `CASH_TENDERED_TOO_LARGE` (422), `PAYMENT_NOT_COLLECTABLE` (422; `violations[].code`: `PROVIDER_BLOCKED_EXTERNAL`, `LEGACY_PAYMENT_METHOD`, `AMOUNT_ZERO`); reutiliza `ORDER_NOT_FOUND`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `ORDERS_BUSY`); F27 (motoristas propios): `RIDER_NOT_FOUND` (404), `RIDER_ACTION_FORBIDDEN` (403), `RIDER_PHONE_TAKEN` (409), `RIDER_VERSION_CONFLICT` (409; `current` = versión vigente), `RIDER_HAS_ACTIVE_DELIVERY` (409), `RIDER_INACTIVE` (409), `BRANCH_NOT_AVAILABLE` (422, reutilizado), `RIDERS_BUSY` (503 reintentable); F28 (entregas propias): `DELIVERY_NOT_FOUND` (404), `DELIVERY_ACTION_FORBIDDEN` (403), `DELIVERY_CURSOR_INVALID` (400), `DELIVERY_REASON_REQUIRED` (400), `DELIVERY_STATE_CONFLICT` (409; `current` = `{status, version}` de la entrega), `ORDER_HAS_ACTIVE_DELIVERY` (409; `current` del pedido; al cancelar un pedido con entrega abierta), `DELIVERY_ORDER_NOT_ELIGIBLE` (422; `violations[].code`: `ORDER_STATUS_NOT_DISPATCHABLE`, `ORDER_NOT_DELIVERY`, `ORDER_PROVIDER_NOT_OWN`), `RIDER_NOT_ELIGIBLE` (422; `violations[].code`: `INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`, `BUSY`, `OWN_DELIVERY_DISABLED`), `DELIVERIES_BUSY` (503 reintentable); reutiliza `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `ORDER_TRANSITION_INVALID`, `RIDER_NOT_FOUND`, `BRANCH_NOT_FOUND`. Los clientes deben ramificar por `code`, nunca por `message`.
             */
            code?: string;
            /** @description Violaciones estructuradas de reglas de negocio (422/409 de F08 y F09). */
            violations?: components["schemas"]["ErrorViolation"][];
        };
        /** @description Violación estructurada de una regla de negocio (F08). `path` localiza el elemento; `code` es estable. */
        ErrorViolation: {
            /**
             * @description Ruta en la solicitud (p. ej. `days[4].intervals[1]`, `startsAt`) o, en CLOSURE_OVERLAP, `closures/<id>` del cierre en conflicto.
             * @example days[4].intervals[1]
             */
            path: string;
            /** @example INTERVAL_OVERLAP */
            code: string;
            message: string;
        };
        /**
         * @description Intervalo semiabierto `[opensAt, closesAt)` en hora LOCAL del restaurante. `opensAt < closesAt` estricto; no
         *     existe cruce de medianoche (un turno nocturno se divide en dos días). `closesAt` admite `24:00` (fin del día).
         */
        BranchHoursInterval: {
            /** @example 11:00 */
            opensAt: string;
            /** @example 24:00 */
            closesAt: string;
        };
        BranchHoursDay: {
            /**
             * @description ISO 8601: 1 = lunes … 7 = domingo. NO es `Date.getDay()` (0 = domingo).
             * @enum {integer}
             */
            weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
            /** @description Ordenados por `opensAt` en las respuestas. Vacío = sin atención ese día. */
            intervals: components["schemas"]["BranchHoursInterval"][];
        };
        /** @description Horario semanal administrativo con su versión de concurrencia optimista. */
        BranchHours: {
            /** Format: uuid */
            branchId: string;
            /** @example America/Guatemala */
            timezone: string;
            /** @description SHA-256 (hex minúsculas) del horario canónico. Reenviar como `expectedVersion`. */
            version: string;
            /** @description Siempre 7 días, `weekday` 1..7 ascendente. */
            days: components["schemas"]["BranchHoursDay"][];
        };
        /** @description Ventana de cierre sin motivo (el motivo nunca es público). */
        PublicClosureWindow: {
            /**
             * Format: date-time
             * @description Instante UTC (`...Z`).
             */
            startsAt: string;
            /**
             * Format: date-time
             * @description Instante UTC (`...Z`).
             */
            endsAt: string;
        };
        PublicBranchHours: {
            /** Format: uuid */
            branchId: string;
            /** @example America/Guatemala */
            timezone: string;
            days: components["schemas"]["BranchHoursDay"][];
            /** @description Cierres en curso o que empiezan en los próximos 30 días, por `startsAt`. Sin motivo. */
            upcomingClosures: components["schemas"]["PublicClosureWindow"][];
        };
        ReplaceBranchHoursRequest: {
            expectedVersion: string;
            /** @description Exactamente los 7 `weekday` 1..7, cada uno una vez, en cualquier orden. */
            days: components["schemas"]["BranchHoursDay"][];
        };
        BranchClosure: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            branchId: string;
            /**
             * Format: date-time
             * @description Instante UTC (`...Z`).
             */
            startsAt: string;
            /**
             * Format: date-time
             * @description Instante UTC (`...Z`), exclusivo.
             */
            endsAt: string;
            reason: string | null;
            /**
             * @description Calculado con el reloj del servidor al responder.
             * @enum {string}
             */
            status: "upcoming" | "active" | "past";
        };
        CreateBranchClosureRequest: {
            /**
             * Format: date-time
             * @description ISO 8601 CON zona (`Z` u offset como `-06:00`). Sin zona => 400. Se normaliza a UTC, truncado al segundo.
             */
            startsAt: string;
            /**
             * Format: date-time
             * @description Igual que `startsAt`; debe ser posterior.
             */
            endsAt: string;
            reason?: string | null;
        };
        UpdateBranchClosureRequest: {
            /** Format: date-time */
            startsAt?: string;
            /** Format: date-time */
            endsAt?: string;
            reason?: string | null;
        };
        BranchClosureList: {
            items: components["schemas"]["BranchClosure"][];
            page: number;
            pageSize: number;
            total: number;
        };
        /**
         * @description Motivo único por orden de evaluación. `INACTIVE` solo lo produce el puerto interno (HTTP público => 404).
         *     No existen `ORDER_CUTOFF_REACHED` ni `OPERATIONS_PAUSED` (bloqueados: falta política/modelo de negocio).
         * @enum {string}
         */
        BranchAvailabilityReason: "OPEN" | "INACTIVE" | "OUTSIDE_BUSINESS_HOURS" | "EXCEPTIONAL_CLOSURE" | "SCHEDULE_NOT_CONFIGURED";
        BranchAvailability: {
            /** Format: uuid */
            branchId: string;
            /** @example America/Guatemala */
            timezone: string;
            /**
             * Format: date-time
             * @description Instante UTC (`...Z`) de la evaluación.
             */
            serverTime: string;
            isOpenNow: boolean;
            /** @description Hoy igual a `isOpenNow`. Siempre implica `isOpenNow`. */
            isAcceptingOrders: boolean;
            reason: components["schemas"]["BranchAvailabilityReason"];
            /**
             * Format: date-time
             * @description Próxima apertura real (si está cerrada); `null` si abierta o sin apertura en 14 días.
             */
            nextOpensAt: string | null;
            /**
             * Format: date-time
             * @description Próximo cierre real (si está abierta); `null` si cerrada o sin cierre en 14 días.
             */
            nextClosesAt: string | null;
            /**
             * Format: date-time
             * @description El menor no nulo de `nextOpensAt`/`nextClosesAt`. Horizonte máximo 14 días.
             */
            nextTransitionAt: string | null;
        };
        LocalizedText: {
            es: string;
            en?: string;
        };
        /** @description Horario de un día (0 = domingo … 6 = sábado), hora local de Guatemala. */
        DraftBranchHours: {
            day: number;
            /** @example 12:00 */
            open: string;
            /** @example 22:00 */
            close: string;
            closed: boolean;
        };
        /** @enum {string} */
        DeliveryTierId: "near" | "mid" | "extended" | "far";
        DeliveryTier: {
            id: components["schemas"]["DeliveryTierId"];
            fee: number;
            etaMinMinutes: number;
            etaMaxMinutes: number;
        };
        /** @description Nivel de envío de una sucursal para un municipio (zone null = todo el municipio). */
        CoverageRule: {
            department: string;
            municipality: string;
            zone: string | null;
            tier: components["schemas"]["DeliveryTierId"];
        };
        DraftMunicipality: {
            name: string;
            /** @description Número de zonas (0 = el municipio no usa zonas). */
            zones: number;
        };
        DraftDepartment: {
            department: string;
            municipalities: components["schemas"]["DraftMunicipality"][];
        };
        StoreConfig: {
            name: string;
            tagline: string;
            /** @enum {string} */
            currency: "GTQ";
            /** @example America/Guatemala */
            timezone: string;
            /**
             * Format: date-time
             * @description Hora del servidor (en el mock, el reloj de la demo). La UI calcula horarios con ella.
             */
            serverTime: string;
            whatsappOrdersNumber: string;
            phoneDisplay: string;
            phoneHref: string;
            instagramHandle: string;
            instagramUrl: string;
            locationLabel: string;
            mapsUrl: string;
            wazeUrl: string;
            openingHours: {
                /** @enum {string} */
                key: "monThu" | "friSat" | "sun";
                open: string;
                close: string;
            }[];
            weeklyHours: components["schemas"]["DraftBranchHours"][];
            schedule: {
                stepMinutes: number;
                lastOrderBeforeClose: number;
                minLeadMinutes: number;
                days: number;
            };
            deliveryTiers: components["schemas"]["DeliveryTier"][];
            departments: components["schemas"]["DraftDepartment"][];
            /** @description Zonas de la Ciudad de Guatemala que no existen (20, 22, 23). */
            nonexistentZones: number[];
        };
        Branch: {
            id: string;
            name: string;
            area: components["schemas"]["LocalizedText"];
            /** @example Zona 4 · Cuatro Grados Norte */
            zoneLabel: string;
            address: string;
            phone: string;
            hoursLabel: string;
            hours: components["schemas"]["DraftBranchHours"][];
            radiusKm: number;
            /** @enum {string} */
            status: "active" | "coming_soon";
            /** @description Interruptor abierta/cerrada del backoffice. */
            isOpen: boolean;
            /** @description isOpen y dentro del horario a la hora del servidor. */
            openNow: boolean;
            coverage: components["schemas"]["CoverageRule"][];
            coverageLabels: string[];
        };
        DeliveryQuote: {
            covered: boolean;
            /** @enum {string|null} */
            reason: "not_covered" | "branch_not_covered" | null;
            quoteId: string | null;
            branchId: string | null;
            tier: components["schemas"]["DeliveryTierId"] | null;
            fee: number | null;
            /** @enum {string} */
            currency: "GTQ";
            etaMinMinutes: number | null;
            etaMaxMinutes: number | null;
            simulated: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        Category: {
            id: string;
            name: string;
            nameEn?: string;
            sortOrder: number;
            visible: boolean;
            /**
             * @description happy_hour es un acceso a la promoción; no agrupa productos.
             * @enum {string}
             */
            kind: "products" | "happy_hour";
            illustration?: string;
            jpLabel?: string;
        };
        DraftBranchAvailability: {
            branchId: string;
            available: boolean;
        };
        Product: {
            id: string;
            name: string;
            nameEn?: string;
            description: string;
            descriptionEn?: string;
            price: number;
            categoryId: string;
            illustration: string;
            featured: boolean;
            food: boolean;
            /** @description Disponible en la sucursal pedida (o en alguna sucursal activa si no se indica). */
            available: boolean;
            availability: components["schemas"]["DraftBranchAvailability"][];
        };
        /** @enum {string} */
        OrderStatus: "received" | "accepted" | "preparing" | "ready" | "on_the_way" | "delivered" | "rejected" | "cancelled";
        /** @enum {string} */
        PaymentStatus: "pending" | "approved" | "declined" | "review";
        /** @enum {string} */
        PaymentMethod: "cash" | "card";
        /** @enum {string} */
        DeliveryProvider: "pedidosya" | "own";
        /**
         * @description PedidosYa: searching → assigned → picking_up → picked_up → on_the_way → delivered. Propio: assigned → on_the_way → delivered. failed = el proveedor no encontró repartidor.
         * @enum {string}
         */
        DeliveryStatus: "searching" | "assigned" | "picking_up" | "picked_up" | "on_the_way" | "delivered" | "failed";
        /** @enum {string} */
        FulfillmentType: "pickup" | "delivery";
        OrderSchedule: {
            /** @enum {string} */
            kind: "now" | "scheduled";
            /**
             * Format: date
             * @description Fecha local (YYYY-MM-DD) si es programado.
             */
            date?: string;
            /**
             * @description Hora local (HH:mm) si es programado.
             * @example 19:30
             */
            time?: string;
        };
        OrderAddress: {
            department: string;
            municipality: string;
            /** @description Vacío si el municipio no usa zonas. */
            zone: string;
            line: string;
            references: string;
        };
        OrderCustomer: {
            name: string;
            phone: string;
            email: string;
        };
        OrderLine: {
            productId: string;
            name: string;
            quantity: number;
            note: string;
            /** @description Precio al momento del pedido. */
            unitPrice: number;
            subtotal: number;
        };
        OrderStatusEvent: {
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            kind: "order" | "payment" | "delivery";
            /** @description Valor de OrderStatus, PaymentStatus o DeliveryStatus según kind. */
            status: string;
            reason: string | null;
            /** @description Repartidor, referencia o proveedor. */
            detail: string | null;
        };
        Payment: {
            method: components["schemas"]["PaymentMethod"];
            status: components["schemas"]["PaymentStatus"];
            amount: number;
            reference: string | null;
            cardBrand: string | null;
            /** @description Único dato de tarjeta que se conserva (nunca PAN completo, CVV ni PIN). */
            cardLast4: string | null;
            simulated: boolean;
            /** Format: date-time */
            processedAt: string | null;
        };
        Delivery: {
            provider: components["schemas"]["DeliveryProvider"];
            status: components["schemas"]["DeliveryStatus"];
            riderId: string | null;
            riderName: string | null;
            reference: string | null;
            /** @description Costo del courier (null para repartidor propio). */
            cost: number | null;
            /** Format: date-time */
            requestedAt: string;
            /** Format: date-time */
            etaAt: string | null;
            /** Format: date-time */
            deliveredAt: string | null;
            simulated: boolean;
        };
        Order: {
            /**
             * @description Número público del pedido.
             * @example MON-490217
             */
            id: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            branchId: string;
            fulfillment: components["schemas"]["FulfillmentType"];
            schedule: components["schemas"]["OrderSchedule"];
            customer: components["schemas"]["OrderCustomer"];
            address: components["schemas"]["OrderAddress"] | null;
            lines: components["schemas"]["OrderLine"][];
            subtotal: number;
            deliveryFee: number;
            discount: number;
            total: number;
            /** @enum {string} */
            currency: "GTQ";
            note: string;
            deliveryTier: components["schemas"]["DeliveryTierId"] | null;
            status: components["schemas"]["OrderStatus"];
            rejectionReason: string | null;
            payment: components["schemas"]["Payment"];
            delivery: components["schemas"]["Delivery"] | null;
            history: components["schemas"]["OrderStatusEvent"][];
            incidents: components["schemas"]["Incident"][];
        };
        CreateOrderLine: {
            productId: string;
            quantity: number;
            note?: string;
        };
        /** @description El cliente nunca envía precios ni totales; el servidor los calcula. */
        CreateOrderRequest: {
            /** @description Obligatorio para recoger; opcional a domicilio. */
            branchId?: string;
            fulfillment: components["schemas"]["FulfillmentType"];
            schedule: components["schemas"]["OrderSchedule"];
            customer: components["schemas"]["OrderCustomer"];
            address?: components["schemas"]["OrderAddress"];
            lines: components["schemas"]["CreateOrderLine"][];
            paymentMethod: components["schemas"]["PaymentMethod"];
            note?: string;
        };
        OrderLookupRequest: {
            orderNumber: string;
            phone: string;
        };
        /** @description Solo simulación (NeoNet pendiente de documentación). La integración real tokenizará la tarjeta en el navegador; el servidor nunca debe recibir ni guardar PAN/CVV/PIN. */
        CardPaymentRequest: {
            orderId: string;
            cardNumber: string;
            holderName: string;
            /** @example 12/28 */
            expiry: string;
            cvv: string;
        };
        PaymentResult: {
            orderId: string;
            status: components["schemas"]["PaymentStatus"];
            reference: string | null;
            amount: number;
            /** Format: date-time */
            processedAt: string;
            simulated: boolean;
        };
        CourierQuote: {
            quoteId: string;
            orderId: string;
            /** @enum {string} */
            provider: "pedidosya";
            cost: number;
            /** @enum {string} */
            currency: "GTQ";
            /** @description Envío cobrado al cliente (para mostrar la diferencia). */
            customerFee: number;
            etaMinMinutes: number;
            etaMaxMinutes: number;
            /** Format: date-time */
            expiresAt: string;
            simulated: boolean;
        };
        DispatchRequest: {
            provider: components["schemas"]["DeliveryProvider"];
            /** @description Obligatorio con provider = own. */
            riderId?: string;
        };
        OrderStatusChangeRequest: {
            status: components["schemas"]["OrderStatus"];
            /** @description Obligatorio para rejected y cancelled. */
            reason?: string;
        };
        Rider: {
            id: string;
            name: string;
            branchId: string;
            vehicle: string;
            phone: string;
            active: boolean;
            busy: boolean;
        };
        /** @enum {string} */
        StaffRole: "admin" | "manager" | "kitchen" | "staff";
        /**
         * @description Código granular `modulo.accion` (F03, ADR-0010; catálogo en `GET /v1/admin/permissions`). Reemplaza los 10
         *     permisos gruesos de F01 (dashboard, orders.status, products.edit, branches, users...). Es dato sembrado
         *     por migración, por eso no se lista como enum.
         */
        StaffPermission: string;
        StaffUser: {
            id: string;
            name: string;
            email: string;
            role: components["schemas"]["StaffRole"];
            /** @description null = todas las sucursales (admin). */
            branchId: string | null;
            active: boolean;
            permissions: components["schemas"]["StaffPermission"][];
        };
        StaffUserInput: {
            name: string;
            email: string;
            role: components["schemas"]["StaffRole"];
            branchId?: string | null;
            active?: boolean;
            permissions?: components["schemas"]["StaffPermission"][];
        };
        Customer: {
            email: string;
            fullName: string;
            phone: string;
            defaultAddressId: string | null;
        };
        /** @description Dirección guardada del cliente autenticado (F05). Nunca indica cobertura ni tarifa. */
        CustomerAddress: {
            /** Format: uuid */
            id: string;
            /** @example Casa */
            label: string;
            department: {
                /** Format: uuid */
                id: string;
                name: string;
            };
            municipality: {
                /** Format: uuid */
                id: string;
                name: string;
            };
            zone: string | null;
            addressLine: string;
            referenceNote: string | null;
            latitude: number | null;
            longitude: number | null;
            isDefault: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description Direcciones del cliente. Sin paginación: el límite por cliente es 10. Primero la predeterminada. */
        CustomerAddressList: {
            items: components["schemas"]["CustomerAddress"][];
        };
        CreateCustomerAddressRequest: {
            label: string;
            /** Format: uuid */
            municipalityId: string;
            /** @description Obligatoria en la ciudad de Guatemala con formato «Zona N» (N 1..25); en otros municipios, texto libre opcional. */
            zone?: string | null;
            addressLine: string;
            referenceNote?: string | null;
            latitude?: number | null;
            longitude?: number | null;
            /** @description Si el cliente ya tiene una predeterminada, true la reemplaza. La primera dirección siempre queda predeterminada. */
            isDefault?: boolean;
        };
        /** @description Actualización parcial. No incluye `isDefault` (usar PATCH /v1/me/addresses/{id}/default). */
        UpdateCustomerAddressRequest: {
            label?: string;
            /** Format: uuid */
            municipalityId?: string;
            /** @description Obligatoria en la ciudad de Guatemala con formato «Zona N» (N 1..25); en otros municipios, texto libre opcional. */
            zone?: string | null;
            addressLine?: string;
            referenceNote?: string | null;
            latitude?: number | null;
            longitude?: number | null;
        };
        Incident: {
            /** @example INC-1042 */
            id: string;
            orderId: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            type: "missing" | "wrong" | "late" | "quality" | "charge" | "other";
            /** @description productId afectados. */
            items: string[];
            description: string;
            /** @enum {string} */
            resolution: "replace" | "refund" | "credit" | "inform";
            /** @enum {string} */
            status: "received" | "in_review" | "resolved";
            answer: components["schemas"]["LocalizedText"] | null;
        };
        CreateIncidentRequest: {
            orderId: string;
            /** @description Verificación de invitado. */
            phone?: string;
            /** @enum {string} */
            type: "missing" | "wrong" | "late" | "quality" | "charge" | "other";
            items: string[];
            description: string;
            /** @enum {string} */
            resolution: "replace" | "refund" | "credit" | "inform";
        };
        JobApplication: {
            id: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            status: "received";
            name: string;
            email: string;
            phone: string;
            position: string;
            /** @enum {string} */
            experience: "none" | "lt1" | "y1to3" | "gt3";
            message: string;
            cvFileName: string;
        };
        /** @description El CV se subirá con almacenamiento firmado (pendiente); en el mock solo viajan nombre y tamaño. */
        JobApplicationRequest: {
            name: string;
            email: string;
            phone: string;
            position: string;
            /** @enum {string} */
            experience: "none" | "lt1" | "y1to3" | "gt3";
            message?: string;
            consent: boolean;
            cvFileName: string;
            cvSizeBytes: number;
        };
        BranchCount: {
            branchId: string;
            orders: number;
            sales: number;
        };
        DashboardAlert: {
            /** @enum {string} */
            type: "unaccepted" | "no_rider" | "searching_rider";
            orderId: string;
            minutes: number;
        };
        DashboardSummary: {
            /** Format: date */
            date: string;
            branchId: string | null;
            /** @description Pedidos del día. */
            received: number;
            newPending: number;
            /** @description accepted + preparing. */
            inPreparation: number;
            readyForDispatch: number;
            onTheWay: number;
            delivered: number;
            /** @description rejected + cancelled. */
            cancelled: number;
            /** @description Total de pedidos aceptados (excluye received, rejected y cancelled). */
            sales: number;
            byBranch: components["schemas"]["BranchCount"][];
            alerts: components["schemas"]["DashboardAlert"][];
        };
        ReportGroup: {
            /** @description Hora ('12'…'22') o fecha (YYYY-MM-DD). */
            key: string;
            orders: number;
            sales: number;
            byBranch: components["schemas"]["BranchCount"][];
        };
        TopProduct: {
            productId: string;
            name: string;
            quantity: number;
        };
        ReportSummary: {
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            branchId: string | null;
            /** @enum {string} */
            unit: "hour" | "day";
            /** @description El rango pedido se recortó a los datos disponibles. */
            clipped: boolean;
            /** Format: date */
            minDate: string;
            groups: components["schemas"]["ReportGroup"][];
            byBranch: components["schemas"]["BranchCount"][];
            topProducts: components["schemas"]["TopProduct"][];
            orders: number;
            cancelled: number;
            sales: number;
            averageTicket: number;
            deliveryOrders: number;
        };
        Department: {
            /** Format: uuid */
            id: string;
            /** @example Guatemala */
            name: string;
        };
        DepartmentListResponse: {
            items: components["schemas"]["Department"][];
        };
        Municipality: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            departmentId: string;
            /** @example Mixco */
            name: string;
        };
        MunicipalityListResponse: {
            items: components["schemas"]["Municipality"][];
        };
        /** @enum {string} */
        CurrencyGtq: "GTQ";
        /**
         * @description Monto GTQ como string decimal EXACTO con 2 decimales (nunca número flotante). Rango 0.00..99999.99
         *     (tope técnico anti-error de captura; CHECK en BD).
         * @example 15.00
         */
        MoneyGtq: string;
        /**
         * @description Monto GTQ de entrada, string decimal con 0 a 2 decimales ("15", "15.5", "15.00"). No se acepta número JSON, signo ni notación científica.
         * @example 15.00
         */
        MoneyGtqInput: string;
        AdminDeliveryZone: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            branchId: string;
            /** Format: uuid */
            municipalityId: string;
            municipalityName: string;
            /** Format: uuid */
            departmentId: string;
            departmentName: string;
            /** @description Etiqueta legible normalizada (NFC, recortada, espacios colapsados). `null` = cobertura GENERAL del municipio. */
            zoneLabel: string | null;
            baseFee: components["schemas"]["MoneyGtq"];
            currency: components["schemas"]["CurrencyGtq"];
            active: boolean;
            /** @description Contador de concurrencia optimista; se reenvía como `expectedVersion` en PATCH. */
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminDeliveryZonePage: {
            items: components["schemas"]["AdminDeliveryZone"][];
            page: number;
            pageSize: number;
            /** @description Total de zonas que cumplen los filtros y el alcance. */
            total: number;
        };
        CreateDeliveryZoneRequest: {
            /** Format: uuid */
            branchId: string;
            /** Format: uuid */
            municipalityId: string;
            /** @description Opcional. Máx. 60 caracteres tras normalizar; sin caracteres de control. `null`, ausente o en blanco = cobertura general del municipio. */
            zoneLabel?: string | null;
            baseFee: components["schemas"]["MoneyGtqInput"];
            /** @default true */
            active: boolean;
        };
        /** @description Además de `expectedVersion` debe venir al menos `zoneLabel` o `baseFee` (si no, 400). */
        UpdateDeliveryZoneRequest: {
            expectedVersion: number;
            zoneLabel?: string | null;
            baseFee?: components["schemas"]["MoneyGtqInput"];
        };
        UpdateDeliveryZoneStatusRequest: {
            active: boolean;
            /** @description Texto libre de operador; se guarda en auditoría. NO debe contener datos personales. */
            reason?: string;
        };
        /**
         * @description Conjunto cerrado de vehículos (F27). Opcional en el motorista.
         * @enum {string}
         */
        RiderVehicleType: "MOTORCYCLE" | "BICYCLE" | "CAR" | "ON_FOOT";
        /**
         * @description Disponibilidad MANUAL persistida. `BUSY` no existe aquí: es derivado (F28) y nunca se guarda.
         * @enum {string}
         */
        RiderAvailability: "AVAILABLE" | "UNAVAILABLE";
        /**
         * @description Filtro del listado sobre el estado operativo derivado.
         * @enum {string}
         */
        RiderAvailabilityFilter: "AVAILABLE" | "UNAVAILABLE" | "BUSY";
        /**
         * @description Derivado por el servidor, en este orden: `INACTIVE` (active=false), `UNAVAILABLE` (marcado no disponible), `BUSY` (entrega activa real; solo con `busyKnown=true`), `AVAILABLE`.
         *     Mientras no exista F28 `busyKnown=false`, nunca hay `BUSY` y `AVAILABLE` no garantiza que esté libre.
         * @enum {string}
         */
        RiderOperationalState: "INACTIVE" | "UNAVAILABLE" | "BUSY" | "AVAILABLE";
        /** @description Fila del listado. Sin teléfono completo ni placa (PII mínima). */
        AdminRiderSummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            branchId: string;
            branchName: string;
            fullName: string;
            /** @example +502****5678 */
            phoneMasked: string;
            vehicleType: components["schemas"]["RiderVehicleType"] | null;
            active: boolean;
            availability: components["schemas"]["RiderAvailability"];
            /** @description Tiene una entrega activa. `false` si `busyKnown=false`. */
            busy: boolean;
            /** @description `false` mientras no exista F28 (adaptador "sin entregas"): `busy` no es una afirmación real. */
            busyKnown: boolean;
            operationalState: components["schemas"]["RiderOperationalState"];
            /** @description Se reenvía como `expectedVersion` en PATCH /riders/{id}. */
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @description Detalle completo (PII: teléfono y placa solo con `riders.read`). */
        AdminRider: components["schemas"]["AdminRiderSummary"] & {
            /** @example +50255501122 */
            phone: string;
            /** @description Normalizada: mayúsculas, sin espacios ni guiones (`^[A-Z0-9]{4,10}$`). */
            licensePlate: string | null;
        };
        AdminRiderPage: {
            items: components["schemas"]["AdminRiderSummary"][];
            page: number;
            pageSize: number;
            /** @description Total de motoristas que cumplen filtros y alcance. */
            total: number;
        };
        CreateRiderRequest: {
            /** Format: uuid */
            branchId: string;
            /** @description Normalizado (NFC, recortado, espacios colapsados); sin caracteres de control. */
            fullName: string;
            phone: string;
            vehicleType?: components["schemas"]["RiderVehicleType"] | null;
            /** @description Se normaliza (mayúsculas, sin espacios ni guiones) y debe cumplir `^[A-Z0-9]{4,10}$`. */
            licensePlate?: string | null;
        };
        /** @description Además de `expectedVersion` debe venir al menos un campo editable (si no, 400). `active` y `availability` NO se aceptan aquí. */
        UpdateRiderRequest: {
            expectedVersion: number;
            fullName?: string;
            phone?: string;
            vehicleType?: components["schemas"]["RiderVehicleType"] | null;
            licensePlate?: string | null;
            /**
             * Format: uuid
             * @description Traslado: mueve el MISMO registro a otra sucursal activa (exige `riders.update` en origen y destino).
             */
            branchId?: string;
        };
        UpdateRiderStatusRequest: {
            active: boolean;
            /** @description Texto libre de operador (opcional, máx. 200). Se valida pero NO se persiste ni se devuelve: la auditoría solo guarda `hasReason` y `reasonLength`. NO debe contener datos personales. */
            reason?: string;
        };
        UpdateRiderAvailabilityRequest: {
            availability: components["schemas"]["RiderAvailability"];
        };
        /** @enum {string} */
        CourierProvider: "PEDIDOSYA" | "OWN";
        /**
         * @description Estado de la integración del proveedor en este servidor. `BLOCKED_EXTERNAL`: sin documentación/credenciales
         *     (valor por defecto y el único posible en producción hoy). `MOCK`: adaptador simulado (solo desarrollo/pruebas).
         *     `LIVE`: reservado para F29; F09 nunca lo produce. Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        ProviderIntegrationStatus: "BLOCKED_EXTERNAL" | "MOCK" | "LIVE";
        /**
         * @description Motivo estable de un estado no determinante. Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        CoverageReason: "PROVIDER_DISABLED" | "INTEGRATION_NOT_CONFIGURED" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "INVALID_REQUEST" | "PROVIDER_UNDETERMINED" | "NO_ZONE_COVERAGE";
        BranchDeliverySettings: {
            /** Format: uuid */
            branchId: string;
            /** @description Entrega con repartidores propios y zonas del restaurante. Por defecto false. */
            ownDeliveryZonesEnabled: boolean;
            /** @description Indicador ADMINISTRATIVO. No equivale a integración operativa ni habilita llamadas reales. Por defecto true. */
            pedidosyaEnabled: boolean;
            pedidosyaIntegrationStatus: components["schemas"]["ProviderIntegrationStatus"];
            /** @description true si la sucursal aún no tiene fila (valores por defecto). */
            isDefault: boolean;
            /** Format: date-time */
            updatedAt: string | null;
        };
        UpdateBranchDeliverySettingsRequest: {
            ownDeliveryZonesEnabled?: boolean;
            pedidosyaEnabled?: boolean;
        };
        DeliveryCoverageCheckRequest: {
            /** Format: uuid */
            branchId: string;
            /** Format: uuid */
            municipalityId: string;
            /** @description Zona opcional (texto libre; se normaliza igual que `zoneLabel`). Sin zona solo puede aplicar la cobertura general del municipio. */
            zone?: string | null;
        };
        PedidosYaCoverage: {
            enabled: boolean;
            /**
             * @description Solo significativo si `enabled=true`. UNKNOWN = no verificable (no es UNAVAILABLE).
             * @enum {string}
             */
            coverageStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
            integrationStatus: components["schemas"]["ProviderIntegrationStatus"];
            /**
             * @description F09 no cotiza (la cobertura y la cotización son conceptos separados). Puede ampliarse en F29.
             * @enum {string}
             */
            quoteStatus: "NOT_AVAILABLE";
            reason?: components["schemas"]["CoverageReason"];
        };
        OwnCoverage: {
            enabled: boolean;
            /**
             * @description Solo significativo si `enabled=true` (deshabilitado => UNAVAILABLE sin evaluar zonas).
             * @enum {string}
             */
            coverageStatus: "AVAILABLE" | "UNAVAILABLE";
            /** Format: uuid */
            deliveryZoneId: string | null;
            baseFee: components["schemas"]["MoneyGtq"] | null;
            currency: components["schemas"]["CurrencyGtq"];
            /**
             * @description ZONE = zona específica; MUNICIPALITY = cobertura general; null = sin cobertura.
             * @enum {string|null}
             */
            matchedBy: "ZONE" | "MUNICIPALITY" | null;
            reason?: components["schemas"]["CoverageReason"];
        };
        /**
         * @description Resumen derivado en servidor. `confirmedProviders`: proveedores habilitados con cobertura AVAILABLE.
         *     `pendingProviders`: habilitados con UNKNOWN (no confirmado). `status`: CONFIRMED si hay algún confirmado; PENDING
         *     si no hay confirmados pero sí pendientes; NONE si no hay ninguno. `simulated=true` si algún dato proviene del
         *     mock: nunca autoriza operaciones reales.
         */
        DeliveryEligibility: {
            /** @enum {string} */
            status: "CONFIRMED" | "PENDING" | "NONE";
            confirmedProviders: components["schemas"]["CourierProvider"][];
            pendingProviders: components["schemas"]["CourierProvider"][];
            simulated: boolean;
        };
        DeliveryCoverageCheckResponse: {
            /** Format: uuid */
            branchId: string;
            /** Format: uuid */
            municipalityId: string;
            /** @description Zona normalizada (o null). */
            zone: string | null;
            /**
             * Format: date-time
             * @description Reloj del servidor, ISO 8601 UTC con milisegundos.
             */
            checkedAt: string;
            providers: {
                PEDIDOSYA: components["schemas"]["PedidosYaCoverage"];
                OWN: components["schemas"]["OwnCoverage"];
            };
            eligibility: components["schemas"]["DeliveryEligibility"];
        };
        /** @description Categoría visible del menú (F10). Sin campos internos; `children` ya viene ordenado y solo con hijas visibles. */
        PublicCategory: {
            /** Format: uuid */
            id: string;
            slug: string;
            name: string;
            description: string | null;
            /** @description Hijas visibles (vacío en hojas). Profundidad máxima del árbol: 3 niveles. */
            children: components["schemas"]["PublicCategory"][];
        };
        PublicCategoryTree: {
            /** @description Categorías raíz visibles, ordenadas por `sortOrder`, `name`, `id`. */
            items: components["schemas"]["PublicCategory"][];
        };
        AdminCategory: {
            /** Format: uuid */
            id: string;
            /**
             * Format: uuid
             * @description `null` = raíz.
             */
            parentId: string | null;
            slug: string;
            name: string;
            description: string | null;
            /** @description Posición entre hermanos (base 0). */
            sortOrder: number;
            /** @description Estado propio (administrativo). */
            active: boolean;
            /** @description `true` solo si la categoría y TODOS sus ancestros están activos (lo que ve el público). */
            effectivelyVisible: boolean;
            /** @description Nivel en el árbol (raíz = 1). */
            depth: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminCategoryList: {
            items: components["schemas"]["AdminCategory"][];
            /** @description Número de elementos devueltos (tope 500). */
            total: number;
        };
        CreateCategoryRequest: {
            name: string;
            /** @description Opcional. Si falta se genera desde `name` y se desambigua; si se envía y existe => 409 `CATEGORY_SLUG_TAKEN`. */
            slug?: string;
            description?: string | null;
            /**
             * Format: uuid
             * @description `null` o ausente = raíz.
             */
            parentId?: string | null;
            /** @description Opcional; por defecto `true` en el servidor. */
            active?: boolean;
        };
        UpdateCategoryRequest: {
            name?: string;
            slug?: string;
            description?: string | null;
            /**
             * Format: uuid
             * @description `null` = mover a la raíz.
             */
            parentId?: string | null;
            active?: boolean;
        };
        ReorderCategoriesRequest: {
            /**
             * Format: uuid
             * @description `null` = categorías raíz.
             */
            parentId: string | null;
            /** @description Todos los hermanos actuales del padre, en el orden deseado, sin duplicados. */
            orderedIds: string[];
        };
        /**
         * @description Importe decimal en GTQ como CADENA con 2 decimales (nunca `number`; evita errores de coma flotante). > 0 y <= 999999.99.
         * @example 85.00
         */
        ProductPrice: string;
        PublicProductCategoryRef: {
            /** Format: uuid */
            id: string;
            slug: string;
            name: string;
        };
        PublicProductMedia: {
            /**
             * Format: uri
             * @description URL https estable (R2 detrás del dominio configurado en F14, o una URL externa previa).
             */
            url: string;
            altText: string | null;
        };
        /** @description Producto visible del menú (F11). Sin SKU ni campos internos. `media` ordenada (vacía = la web muestra un placeholder). */
        PublicProduct: {
            /** Format: uuid */
            id: string;
            slug: string;
            name: string;
            /** @description Texto plano. */
            description: string | null;
            basePrice: components["schemas"]["ProductPrice"];
            category: components["schemas"]["PublicProductCategoryRef"];
            media: components["schemas"]["PublicProductMedia"][];
        };
        /** @description Precio EFECTIVO y disponibilidad de UNA sucursal para la ficha (F13). Informativo. */
        StoreProductOffer: {
            /** Format: uuid */
            branchId: string;
            price: components["schemas"]["ProductPrice"];
            available: boolean;
        };
        /** @description Ficha pública, igual que `PublicProduct` más los ancestros visibles de la categoría para el breadcrumb y los grupos de modificadores ofrecibles (F12). */
        PublicProductDetail: components["schemas"]["PublicProduct"] & {
            /** @description F17. Solo con `branchId`: precio EFECTIVO y disponibilidad de esa sucursal (F13). Se omite sin `branchId`. */
            offer?: components["schemas"]["StoreProductOffer"];
            /** @description F17. Solo con `branchId`: promociones públicas indicativas vigentes que aplican al producto (F15; nunca cupones ni códigos), la de mayor ahorro primero. Se omite sin `branchId`. */
            promotions?: components["schemas"]["StoreProductPromo"][];
            /**
             * Format: date-time
             * @description F17. Solo con `branchId`: hora del servidor al generar la respuesta.
             */
            generatedAt?: string;
            /**
             * Format: date-time
             * @description F17. Solo con `branchId`: próximo cambio por tiempo de las promociones (14 días); `null` si no hay. Acota `s-maxage`.
             */
            nextChangeAt?: string | null;
            /**
             * @description F12. Solo grupos ACTIVOS asociados al producto que se pueden ofrecer (con al menos `max(minSelect, 1)` opciones activas), en el orden
             *     de asociación, con SOLO sus opciones activas (orden de `sortOrder`). Vacío si no hay. Los precios extra son INFORMATIVOS: el servidor
             *     recalcula y valida la selección al cotizar (F19) y nunca confía en el cliente. No existe en la lista pública (`PublicProduct`).
             */
            modifierGroups: components["schemas"]["PublicModifierGroup"][];
            /** @description Ancestros de `category`, de la raíz al padre (vacío si es raíz). */
            categoryAncestors: components["schemas"]["PublicProductCategoryRef"][];
        };
        PublicProductPage: {
            items: components["schemas"]["PublicProduct"][];
            page: number;
            pageSize: number;
            /** @description Total de productos que cumplen el filtro (todas las páginas). */
            total: number;
        };
        AdminProductCategory: {
            /** Format: uuid */
            id: string;
            slug: string;
            name: string;
            active: boolean;
            /** @description Categoría y todos sus ancestros activos (F10). */
            effectivelyVisible: boolean;
        };
        AdminProductMedia: {
            /** Format: uuid */
            id: string;
            /** Format: uri */
            url: string;
            altText: string | null;
            sortOrder: number;
            /**
             * Format: uuid
             * @description F14. Asset de `media_assets` del que proviene la imagen; `null` = URL externa previa a F14 (o referenciada con el PATCH `media` de F11 sin asset).
             */
            assetId?: string | null;
        };
        AdminProduct: {
            /** Format: uuid */
            id: string;
            sku: string | null;
            slug: string;
            name: string;
            description: string | null;
            basePrice: components["schemas"]["ProductPrice"];
            /** Format: uuid */
            categoryId: string;
            category: components["schemas"]["AdminProductCategory"];
            /** @description Estado propio (administrativo). */
            active: boolean;
            /** @description `active` Y categoría efectivamente visible: lo que ve el público. */
            publiclyVisible: boolean;
            media: components["schemas"]["AdminProductMedia"][];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminProductPage: {
            items: components["schemas"]["AdminProduct"][];
            page: number;
            pageSize: number;
            total: number;
        };
        ProductMediaInput: {
            /** @description URL `https` absoluta, <= 2048 caracteres. Otro esquema (http, data, javascript…), longitud, IP literal, `localhost`, host sin punto o host fuera de la lista `PRODUCT_MEDIA_ALLOWED_HOSTS` (si está definida) => 422 `PRODUCT_MEDIA_INVALID` (no 400). */
            url: string;
            /** @description <= 200 caracteres; si no => 422 `PRODUCT_MEDIA_INVALID` (no 400). */
            altText?: string | null;
        };
        CreateProductRequest: {
            name: string;
            /** @description Opcional. Si falta se genera desde `name` y se desambigua; si se envía y existe => 409 `PRODUCT_SLUG_TAKEN`. */
            slug?: string;
            /** @description Opcional, único; se guarda en mayúsculas. Repetido => 409 `PRODUCT_SKU_TAKEN`. */
            sku?: string | null;
            description?: string | null;
            basePrice: components["schemas"]["ProductPrice"];
            /**
             * Format: uuid
             * @description Categoría existente y activa; si no => 422 `PRODUCT_CATEGORY_INVALID`.
             */
            categoryId: string;
            /** @description Opcional; por defecto `true` en el servidor. */
            active?: boolean;
            /** @description Opcional, máx. 8 (más => 422 `PRODUCT_MEDIA_INVALID`). El orden define `sortOrder`. */
            media?: components["schemas"]["ProductMediaInput"][];
        };
        UpdateProductRequest: {
            name?: string;
            slug?: string;
            /** @description `null` borra el SKU. */
            sku?: string | null;
            description?: string | null;
            basePrice?: components["schemas"]["ProductPrice"];
            /**
             * Format: uuid
             * @description Si cambia, la nueva debe existir y estar activa => 422 `PRODUCT_CATEGORY_INVALID`.
             */
            categoryId?: string;
            active?: boolean;
            /** @description REEMPLAZA la lista completa (`[]` la vacía); omitir = no tocar. Máx. 8 (más => 422 `PRODUCT_MEDIA_INVALID`). */
            media?: components["schemas"]["ProductMediaInput"][];
        };
        /**
         * @description Importe extra decimal en GTQ como CADENA con 2 decimales (nunca `number`). `0.00` permitido; <= 9999.99.
         * @example 5.00
         */
        ModifierExtraPrice: string;
        PublicModifierOption: {
            /** Format: uuid */
            id: string;
            name: string;
            extraPrice: components["schemas"]["ModifierExtraPrice"];
        };
        /** @description Grupo ofrecible de una ficha (F12). Cada opción se elige 0 o 1 vez; se debe elegir entre `minSelect` y `maxSelect` opciones del grupo. */
        PublicModifierGroup: {
            /** Format: uuid */
            id: string;
            name: string;
            minSelect: number;
            maxSelect: number;
            /** @description Derivado: `minSelect >= 1`. */
            required: boolean;
            options: components["schemas"]["PublicModifierOption"][];
        };
        /**
         * @description F18 (spec 019, ADR-0024). Una opción de modificador elegida en una línea del carrito. SOLO ids: nunca nombres ni precios (el servidor los resuelve y recalcula).
         *     `quantity` es la cantidad de ESA opción por unidad de la línea; en la v1 de F12 cada opción se elige 0 o 1 vez, por eso `maximum: 1` (el campo existe para no
         *     romper el contrato si negocio admite «doble porción»; subirlo exigirá F12 + F19).
         */
        CartQuoteSelectionInput: {
            /** Format: uuid */
            groupId: string;
            /** Format: uuid */
            optionId: string;
            quantity: number;
        };
        /**
         * @description F18 (spec 019). Línea de carrito en el formato de entrada de la cotización de checkout (F19). SIN precios, nombres, imágenes ni notas: la API recalcula todo.
         *     Una configuración idéntica (producto + selecciones) aparece UNA sola vez con la cantidad sumada. `selections` ordenadas por `groupId` y luego `optionId`.
         */
        CartQuoteLineInput: {
            /** Format: uuid */
            productId: string;
            quantity: number;
            selections: components["schemas"]["CartQuoteSelectionInput"][];
        };
        /**
         * @description F18 (spec 019, ADR-0024). Entrada reutilizable que `POST /v1/checkout/quote` (F19, `CheckoutQuoteRequest.cart`) compone sin cambios. Una sola sucursal por carrito.
         *     Lo produce la función pura `toQuoteInput(cart)` de la web; las líneas van en orden determinista (`productId`, luego clave canónica de selecciones). F19 amplía el
         *     cuerpo (modalidad, dirección, cupón) en `CheckoutQuoteRequest`, que lo COMPONE sin cambiar sus campos.
         */
        CartQuoteInput: {
            /** Format: uuid */
            branchId: string;
            lines: components["schemas"]["CartQuoteLineInput"][];
        };
        /**
         * @description Importe en GTQ como CADENA decimal de 2 posiciones (nunca `number`). Calculado con centavos enteros.
         * @example 85.00
         */
        CheckoutMoney: string;
        /**
         * @description Estado de una línea cotizada, alineado con los estados de F18 (`cart-rules.ts`). `OK` y `PRICE_CHANGED` son comprables;
         *     el resto bloquea. `NOT_FOUND`: el producto no existe; `INACTIVE`: existe pero no es ordenable (inactivo o categoría
         *     oculta); `UNAVAILABLE`: agotado en la sucursal; `MODIFIER_INVALID`: selección de extras inválida (grupo, mínimo,
         *     máximo, obligatorio); `OPTION_UNAVAILABLE`: una opción elegida ya no existe o está inactiva. `BRANCH_MISMATCH` es
         *     solo del cliente. Precedencia: NOT_FOUND > INACTIVE > UNAVAILABLE > OPTION_UNAVAILABLE > MODIFIER_INVALID > PRICE_CHANGED > OK.
         *     Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        CheckoutLineStatus: "OK" | "PRICE_CHANGED" | "UNAVAILABLE" | "INACTIVE" | "NOT_FOUND" | "MODIFIER_INVALID" | "OPTION_UNAVAILABLE";
        /**
         * @description Modalidad. `PICKUP`: no admite ningún otro campo. `DELIVERY`: exactamente UNO de `customerAddressId` (dirección
         *     guardada, exige sesión de cliente y propiedad) o `municipalityId` (+ `zone` opcional; invitado o dirección nueva).
         *     En el municipio de la ciudad de Guatemala la zona es obligatoria con formato «Zona N» (decisión C2 de F05); si falta
         *     => blocker `ADDRESS_INCOMPLETE`. No hay texto libre de dirección: la cotización solo necesita municipio y zona.
         *     `deliveryProvider` es una preferencia explícita (no se sustituye en silencio). Combinaciones incoherentes => 400.
         */
        CheckoutFulfillmentInput: {
            /** @enum {string} */
            type: "PICKUP" | "DELIVERY";
            /** Format: uuid */
            customerAddressId?: string;
            /** Format: uuid */
            municipalityId?: string;
            zone?: string | null;
            deliveryProvider?: components["schemas"]["CourierProvider"];
        };
        /** @description Precio unitario de producto (sin extras ni descuento) que el cliente VIO para la línea `index` de `cart.lines`. Pista no autoritativa. */
        CheckoutClientLineView: {
            index: number;
            unitPrice: components["schemas"]["CheckoutMoney"];
        };
        /**
         * @description Lo que el cliente ya vio. SOLO sirve para avisar (`PRICE_CHANGED`, `TOTAL_CHANGED`); el servidor no lo usa para calcular,
         *     validar ni cobrar. No es un importe de entrada.
         */
        CheckoutClientView: {
            lines?: components["schemas"]["CheckoutClientLineView"][];
            total?: components["schemas"]["CheckoutMoney"];
        };
        /**
         * @description Cuerpo de `POST /v1/checkout/quote`. COMPONE `CartQuoteInput` (F18) sin cambiar sus campos: `toQuoteInput(cart)` va
         *     tal cual en `cart`. Topes adicionales: ≤ 200 unidades y ≤ 300 selecciones en total (si no, 400 `QUOTE_LIMITS_EXCEEDED`);
         *     cuerpo ≤ 64 KB.
         */
        CheckoutQuoteRequest: {
            cart: components["schemas"]["CartQuoteInput"];
            fulfillment: components["schemas"]["CheckoutFulfillmentInput"];
            /** @description Cupón opcional (sin patrón, para que un formato inválido no se distinga de uno inexistente). Se normaliza en el servidor. Nunca se registra en logs. */
            couponCode?: string;
            clientView?: components["schemas"]["CheckoutClientView"];
        };
        CheckoutQuoteMeta: {
            /** Format: date-time */
            generatedAt: string;
            /**
             * Format: date-time
             * @description Vigencia fija (10 min). No reserva inventario ni precio.
             */
            expiresAt: string;
            /**
             * @description Firma sin estado (HMAC-SHA256, secreto de servidor) de {sucursal, modalidad, proveedor, totales, huella de la entrada,
             *     sujeto, vigencia}. Opaco para el cliente. `null` si el servidor no tiene secreto configurado (F20 debe rechazarlo).
             *     Solo `canProceed=true` emite token.
             */
            token: string | null;
        };
        /** @description Horario de la sucursal (F08, America/Guatemala). Es DISTINTO de la disponibilidad logística del proveedor de entrega. */
        CheckoutBranchState: {
            /** Format: uuid */
            id: string;
            isAcceptingOrders: boolean;
            reason: components["schemas"]["BranchAvailabilityReason"];
            /** Format: date-time */
            nextOpensAt: string | null;
        };
        CheckoutModifierLine: {
            /** Format: uuid */
            groupId: string;
            /** Format: uuid */
            optionId: string;
            extraPrice: components["schemas"]["CheckoutMoney"];
        };
        /**
         * @description Una línea por cada elemento de `cart.lines`, en el mismo orden (`index`). En una línea no comprable los importes son `null`.
         *     `lineSubtotal = (unitPrice + extrasPerUnit) × quantity`; `lineTotal = lineSubtotal − discount`.
         */
        CheckoutQuoteLine: {
            index: number;
            /** Format: uuid */
            productId: string;
            quantity: number;
            status: components["schemas"]["CheckoutLineStatus"];
            /** @description Precio EFECTIVO de la sucursal (F13), nunca `basePrice`. */
            unitPrice: components["schemas"]["CheckoutMoney"] | null;
            modifiers: components["schemas"]["CheckoutModifierLine"][];
            extrasPerUnit: components["schemas"]["CheckoutMoney"] | null;
            lineSubtotal: components["schemas"]["CheckoutMoney"] | null;
            discount: components["schemas"]["CheckoutMoney"] | null;
            /** Format: uuid */
            promotionId: string | null;
            lineTotal: components["schemas"]["CheckoutMoney"] | null;
            /** @description Eco de `clientView` solo si el precio cambió (`status=PRICE_CHANGED`); informativo. */
            previousUnitPrice: components["schemas"]["CheckoutMoney"] | null;
        };
        /**
         * @description Evaluación independiente de un proveedor para la dirección dada. `customerFee` es lo que se cobraría AL CLIENTE; el
         *     costo interno del proveedor jamás se expone. `selectable=false` => `unavailableReason` presente.
         */
        CheckoutDeliveryOption: {
            provider: components["schemas"]["CourierProvider"];
            enabled: boolean;
            /** @enum {string} */
            coverageStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
            /** @description Solo PEDIDOSYA. */
            integrationStatus?: components["schemas"]["ProviderIntegrationStatus"];
            /** @description true si el resultado viene de un adaptador simulado (solo desarrollo/pruebas). */
            simulated: boolean;
            customerFee: components["schemas"]["CheckoutMoney"] | null;
            selectable: boolean;
            /**
             * @description `PROVIDER_DISABLED`, `NO_ZONE_COVERAGE`, `COVERAGE_UNKNOWN`, `SIMULATED`, `CUSTOMER_FEE_UNDEFINED` o un `CoverageReason`
             *     de F09. Los clientes deben tolerar valores futuros.
             */
            unavailableReason?: string;
        };
        CheckoutDelivery: {
            selectedProvider: components["schemas"]["CourierProvider"] | null;
            options: components["schemas"]["CheckoutDeliveryOption"][];
        };
        /**
         * @description Motivo que impide continuar. `code` estable (los clientes ramifican por él): por línea (`scope=LINE`, `lineIndex`):
         *     `UNAVAILABLE`, `INACTIVE`, `NOT_FOUND`, `MODIFIER_INVALID`, `OPTION_UNAVAILABLE`; sucursal (`BRANCH`): `BRANCH_CLOSED`;
         *     modalidad (`FULFILLMENT`): `ADDRESS_INCOMPLETE`, `DELIVERY_UNAVAILABLE` (ningún proveedor cubre), `DELIVERY_UNVERIFIED`
         *     (no se pudo verificar cobertura), `DELIVERY_PROVIDER_NOT_SELECTABLE` (el proveedor pedido no es seleccionable).
         *     Valores futuros posibles.
         */
        CheckoutBlocker: {
            code: string;
            /** @enum {string} */
            scope: "LINE" | "BRANCH" | "FULFILLMENT";
            lineIndex?: number;
        };
        /** @description Aviso que NO bloquea: `PRICE_CHANGED` (línea), `TOTAL_CHANGED`, `PROMOTIONS_TRUNCATED` (había más de 200 promociones candidatas; no es «cupón inválido»). */
        CheckoutNotice: {
            code: string;
            lineIndex?: number;
        };
        /** @description Vista del cliente: solo `APPLIED` o `NOT_APPLIED`, sin motivo (un cupón inexistente, vencido, de otra sucursal o sin ahorro responden igual). */
        CheckoutCoupon: {
            /** @enum {string} */
            status: "APPLIED" | "NOT_APPLIED";
        };
        CheckoutQuote: {
            quote: components["schemas"]["CheckoutQuoteMeta"];
            /** @enum {string} */
            currency: "GTQ";
            branch: components["schemas"]["CheckoutBranchState"];
            fulfillment: {
                /** @enum {string} */
                type: "PICKUP" | "DELIVERY";
                delivery: components["schemas"]["CheckoutDelivery"] | null;
            };
            lines: components["schemas"]["CheckoutQuoteLine"][];
            subtotal: components["schemas"]["CheckoutMoney"];
            extrasTotal: components["schemas"]["CheckoutMoney"];
            discountTotal: components["schemas"]["CheckoutMoney"];
            /** @description `0.00` en PICKUP; `null` si a domicilio no hay tarifa verificable. */
            deliveryFee: components["schemas"]["CheckoutMoney"] | null;
            total: components["schemas"]["CheckoutMoney"] | null;
            coupon: components["schemas"]["CheckoutCoupon"] | null;
            canProceed: boolean;
            blockers: components["schemas"]["CheckoutBlocker"][];
            notices: components["schemas"]["CheckoutNotice"][];
        };
        /**
         * @description Catálogo OFICIAL de estados del pedido (F20 define; F22 gobierna las transiciones). F20 solo escribe `pending`. F21 los presenta como `OrderPublicStatus`.
         *     `pending` recibido; `accepted` aceptado por la sucursal; `preparing` en cocina; `ready` listo; `on_the_way` en camino
         *     (solo DELIVERY); `delivered` entregado al cliente (DELIVERY); `picked_up` recogido (PICKUP); `rejected` rechazado por
         *     la sucursal; `cancelled` cancelado. Es INDEPENDIENTE del pago (F24) y de la entrega (F28/F29). Los clientes deben
         *     tolerar valores futuros. Reemplaza al `OrderStatus` borrador (`received` => `pending`).
         * @enum {string}
         */
        OrderLifecycleStatus: "pending" | "accepted" | "preparing" | "ready" | "on_the_way" | "delivered" | "picked_up" | "rejected" | "cancelled";
        /**
         * @description Preferencia declarada por el cliente al crear el pedido (no es un pago). F24 (spec 025, ADR-0030): SOLO `cash` (efectivo). Cualquier otro valor
         *     (`bank_transfer`, `card`, …) => 400 de validación. Las filas históricas de F20 con `bank_transfer` se leen como `null` (la API no devuelve valores retirados).
         *     El pago real vive en `payments` y se expone como `payment{method: CASH, status: PENDING|PAID}`.
         * @enum {string}
         */
        OrderPaymentPreference: "cash";
        /**
         * @description Datos de contacto. Invitado: `fullName` y `phone` obligatorios. Autenticado: opcional (se completa con el perfil; si
         *     falta el teléfono en ambos => 422 `CONTACT_INCOMPLETE`). Teléfono de Guatemala (8 dígitos, `+502` opcional); se
         *     normaliza a `+502XXXXXXXX`. Correo opcional con formato válido.
         */
        OrderContactInput: {
            fullName?: string;
            /** @example +502 5555 1234 */
            phone?: string;
            /** Format: email */
            email?: string;
        };
        /**
         * @description Texto de la dirección de entrega. Obligatorio con `fulfillment.type=DELIVERY` y `municipalityId` (dirección nueva o
         *     invitado); PROHIBIDO con `customerAddressId` (se copia la dirección guardada) y con PICKUP (=> 400). No afecta al precio
         *     ni a la huella del token (la cobertura sigue siendo municipio + zona).
         */
        OrderDeliveryAddressInput: {
            addressLine: string;
            referenceNote?: string;
        };
        /**
         * @description Cuerpo de `POST /v1/orders` (≤ 64 KB). `cart`, `fulfillment` y `couponCode` son EXACTAMENTE los de
         *     `CheckoutQuoteRequest` (se recotizan en el servidor). Sin `clientView`, sin importes.
         */
        OrderCreateRequest: {
            cart: components["schemas"]["CartQuoteInput"];
            fulfillment: components["schemas"]["CheckoutFulfillmentInput"];
            couponCode?: string;
            /** @description `quote.token` de la cotización que el cliente aceptó. */
            quoteToken: string;
            contact?: components["schemas"]["OrderContactInput"];
            deliveryAddress?: components["schemas"]["OrderDeliveryAddressInput"];
            /** @description Nota general del pedido (sin datos personales sensibles). */
            notes?: string;
            paymentMethodPreference?: components["schemas"]["OrderPaymentPreference"];
        };
        OrderDetailModifier: {
            name: string;
            extraPrice: components["schemas"]["CheckoutMoney"];
        };
        /** @description Snapshot de la línea al crear el pedido (inmutable). */
        OrderDetailLine: {
            productName: string;
            quantity: number;
            unitPrice: components["schemas"]["CheckoutMoney"];
            modifiers: components["schemas"]["OrderDetailModifier"][];
            extrasPerUnit: components["schemas"]["CheckoutMoney"];
            lineSubtotal: components["schemas"]["CheckoutMoney"];
            discount: components["schemas"]["CheckoutMoney"];
            lineTotal: components["schemas"]["CheckoutMoney"];
            notes: string | null;
        };
        OrderDetailPromotion: {
            name: string;
            amount: components["schemas"]["CheckoutMoney"];
        };
        /** @description Snapshot de la dirección (sin coordenadas). */
        OrderDetailAddress: {
            municipalityName: string;
            zone: string | null;
            addressLine: string;
            referenceNote: string | null;
        };
        /** @description Minimización de PII: teléfono enmascarado y sin correo. */
        OrderDetailContact: {
            fullName: string;
            /** @example ****1234 */
            phoneMasked: string;
        };
        /**
         * @description Método de pago real. F24: SOLO `CASH` (efectivo). Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        PaymentMethodCode: "CASH";
        /**
         * @description Estado de pago (F24, spec 025). INDEPENDIENTE del estado del pedido: pedido ≠ pagado ≠ aceptado ≠ entregado. `PENDING` = pago en efectivo aún no recibido (se crea con el pedido);
         *     `PAID` = el personal registró la recepción del efectivo (inmutable). NO existen `VOIDED`, `REFUNDED` ni parciales (anulaciones P82+, reembolsos F26). Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        OrderPaymentStatus: "PENDING" | "PAID";
        /**
         * @description Pago del pedido con vocabulario PÚBLICO seguro (F24). Siempre efectivo (`CASH`). `paidAt` solo con `PAID`. NUNCA identifica al empleado que cobró ni trae historial ni auditoría. Un pedido PICKUP se
         *     paga en mostrador al recoger; un DELIVERY `OWN`, al recibirlo. Reemplaza al `{methodPreference, status: NOT_STARTED}` de F20 (F20 aún no está en producción: cambio incompatible aceptado, sin `/v2`).
         * @example {
         *       "method": "CASH",
         *       "status": "PENDING",
         *       "paidAt": null
         *     }
         */
        OrderDetailPayment: {
            method: components["schemas"]["PaymentMethodCode"];
            status: components["schemas"]["OrderPaymentStatus"];
            /**
             * Format: date-time
             * @description Instante del servidor en que se registró la recepción del efectivo; `null` si `PENDING`.
             */
            paidAt: string | null;
        };
        /**
         * @description Pago en el RECIBO NO fiscal (F24). Mismos campos que `OrderDetailPayment` más, solo con `PAID`, el importe aplicado a la deuda (`amountPaid` = total del pedido), el efectivo entregado
         *     (`tendered`) y el cambio devuelto (`change`). El cambio NO es un ingreso. Sin identidad del empleado. `PENDING` => `amountPaid`, `tendered` y `change` son `null`.
         * @example {
         *       "method": "CASH",
         *       "status": "PAID",
         *       "paidAt": "2026-11-19T19:05:12.000Z",
         *       "amountPaid": "185.00",
         *       "tendered": "200.00",
         *       "change": "15.00"
         *     }
         */
        OrderReceiptPayment: {
            method: components["schemas"]["PaymentMethodCode"];
            status: components["schemas"]["OrderPaymentStatus"];
            /** Format: date-time */
            paidAt: string | null;
            amountPaid: components["schemas"]["CheckoutMoney"] | null;
            tendered: components["schemas"]["CheckoutMoney"] | null;
            change: components["schemas"]["CheckoutMoney"] | null;
        };
        /**
         * @description Pedido persistido (reemplaza al `Order` borrador para `http`). NO lleva línea de tiempo ni entrega: eso es
         *     `OrderTracking` (F21, `getOrderTracking`). Importes en cadenas decimales GTQ; `total = subtotal − discountTotal + deliveryFee`.
         */
        OrderDetail: {
            /** Format: uuid */
            id: string;
            /**
             * Format: int64
             * @description Secuencia de PostgreSQL: creciente, única, NO contigua. Nunca es una credencial.
             */
            orderNumber: number;
            /** @example MON-001042 */
            displayNumber: string;
            status: components["schemas"]["OrderLifecycleStatus"];
            /** Format: uuid */
            branchId: string;
            /** @enum {string} */
            fulfillmentType: "PICKUP" | "DELIVERY";
            /** @description `OWN` en entrega propia, `null` en PICKUP. `PEDIDOSYA` no es creable en F20. */
            deliveryProvider: components["schemas"]["CourierProvider"] | null;
            /** @enum {string} */
            currency: "GTQ";
            lines: components["schemas"]["OrderDetailLine"][];
            promotions: components["schemas"]["OrderDetailPromotion"][];
            address: components["schemas"]["OrderDetailAddress"] | null;
            contact: components["schemas"]["OrderDetailContact"];
            notes: string | null;
            subtotal: components["schemas"]["CheckoutMoney"];
            extrasTotal: components["schemas"]["CheckoutMoney"];
            discountTotal: components["schemas"]["CheckoutMoney"];
            deliveryFee: components["schemas"]["CheckoutMoney"];
            total: components["schemas"]["CheckoutMoney"];
            payment: components["schemas"]["OrderDetailPayment"];
            /** Format: date-time */
            placedAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /**
         * @description Credencial de invitado, mostrada SOLO en la creación (o en una repetición idempotente, que revoca la anterior). El
         *     servidor guarda únicamente su sha256. Guardar en `sessionStorage`; nunca en la URL ni en logs.
         */
        OrderGuestAccess: {
            guestToken: string;
            /** Format: date-time */
            expiresAt: string;
        };
        OrderCreated: {
            order: components["schemas"]["OrderDetail"];
            /** @description `null` si el pedido es de un cliente autenticado (accede con su sesión). */
            access: components["schemas"]["OrderGuestAccess"] | null;
        };
        /**
         * @description F23 (spec 024). Fila del historial del cliente. Columnas mínimas: SIN líneas, modificadores, promociones, dirección, teléfono, correo ni notas. `publicStatus`/`terminal` salen del MISMO
         *     mapeo de F21 (`OrderPublicStatus`), para que la web no lo reimplemente. Un `rejected`/`cancelled` se lista con su estado y NUNCA con el motivo interno (P64).
         */
        MyOrderSummary: {
            /** Format: uuid */
            id: string;
            /** Format: int64 */
            orderNumber: number;
            /** @example MON-001042 */
            displayNumber: string;
            status: components["schemas"]["OrderLifecycleStatus"];
            publicStatus: components["schemas"]["OrderPublicStatus"];
            /** @description `delivered`, `picked_up`, `rejected` o `cancelled` (no cambian más). */
            terminal: boolean;
            /** Format: uuid */
            branchId: string;
            branchName: string;
            /** @enum {string} */
            fulfillmentType: "PICKUP" | "DELIVERY";
            deliveryProvider: components["schemas"]["CourierProvider"] | null;
            /** @description Unidades del pedido (suma de cantidades de las líneas), agregadas en SQL. */
            itemCount: number;
            total: components["schemas"]["CheckoutMoney"];
            /** @enum {string} */
            currency: "GTQ";
            /** @description Solo la preferencia declarada (`cash` o `null`); NO es un pago. */
            paymentMethodPreference: components["schemas"]["OrderPaymentPreference"] | null;
            /** Format: date-time */
            placedAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        MyOrderPage: {
            items: components["schemas"]["MyOrderSummary"][];
            /** @description Cursor opaco de la página siguiente; `null` = no hay más. */
            nextCursor: string | null;
            /** Format: date-time */
            generatedAt: string;
        };
        /** @description Datos PÚBLICOS de la sucursal que atendió el pedido (sin id). */
        OrderReceiptBranch: {
            name: string;
            address: string;
            phone: string | null;
        };
        OrderReceiptFulfillment: {
            /** @enum {string} */
            type: "PICKUP" | "DELIVERY";
            /** @description Tal como quedó registrado. Un pedido `PEDIDOSYA` histórico se muestra sin estados externos inventados (`BLOCKED_EXTERNAL`). */
            provider: components["schemas"]["CourierProvider"] | null;
        };
        /**
         * @description F23 (spec 024, ADR-0029). Datos del recibo NO fiscal construidos desde los snapshots del pedido (mismos importes que `OrderDetail`; `total = subtotal − discountTotal + deliveryFee`).
         *     NO contiene id de pedido/líneas/cliente/sucursal, tokens, correo, teléfono completo, coordenadas, motivo de rechazo/cancelación, historial ni actor.
         */
        OrderReceipt: {
            /**
             * @description Siempre `NOT_FISCAL`: documento informativo, sin validez tributaria (sin FEL/SAT/NIT).
             * @enum {string}
             */
            fiscalStatus: "NOT_FISCAL";
            /** @example MON-001042 */
            displayNumber: string;
            status: components["schemas"]["OrderLifecycleStatus"];
            publicStatus: components["schemas"]["OrderPublicStatus"];
            /** Format: date-time */
            placedAt: string;
            /**
             * Format: date-time
             * @description Instante en que el servidor armó estos datos (no es una fecha de emisión fiscal).
             */
            generatedAt: string;
            /** @enum {string} */
            timeZone: "America/Guatemala";
            /** @enum {string} */
            currency: "GTQ";
            branch: components["schemas"]["OrderReceiptBranch"];
            fulfillment: components["schemas"]["OrderReceiptFulfillment"];
            address: components["schemas"]["OrderDetailAddress"] | null;
            contact: components["schemas"]["OrderDetailContact"];
            lines: components["schemas"]["OrderDetailLine"][];
            promotions: components["schemas"]["OrderDetailPromotion"][];
            notes: string | null;
            subtotal: components["schemas"]["CheckoutMoney"];
            extrasTotal: components["schemas"]["CheckoutMoney"];
            discountTotal: components["schemas"]["CheckoutMoney"];
            deliveryFee: components["schemas"]["CheckoutMoney"];
            total: components["schemas"]["CheckoutMoney"];
            payment: components["schemas"]["OrderReceiptPayment"];
        };
        /** @description Cuerpo opcional (`{}` o ausente = sucursal del pedido original). Cualquier otra propiedad (precios, líneas, cantidades, `customerId`) => 400. */
        OrderReorderRequest: {
            /**
             * Format: uuid
             * @description Sucursal contra la que se valida y se precia. Por defecto, la del pedido original.
             */
            branchId?: string;
        };
        /**
         * @description `AVAILABLE`: la línea candidata se puede añadir tal cual (puede traer avisos informativos: `PRICE_CHANGED`, `QUANTITY_ADJUSTED`, `NOTE_DROPPED`).
         *     `NEEDS_CONFIGURATION`: el producto se puede pedir pero el cliente debe volver a elegir (opción retirada/inactiva, selección obligatoria nueva o regla de grupo cambiada); `candidate`
         *     trae solo lo retenido y NO debe añadirse al carrito sin que el cliente la configure. `UNAVAILABLE`: no se puede pedir en esa sucursal; sin `candidate`.
         * @enum {string}
         */
        OrderReorderLineStatus: "AVAILABLE" | "NEEDS_CONFIGURATION" | "UNAVAILABLE";
        /**
         * @description Diagnóstico estable (los clientes ramifican por el código, no por texto; deben tolerar valores futuros). Bloqueantes de la línea: `PRODUCT_REMOVED` (el producto ya no existe),
         *     `PRODUCT_INACTIVE` (inactivo o su categoría no es visible), `PRODUCT_OUT_OF_STOCK` (agotado en la sucursal), `BRANCH_UNAVAILABLE` (sucursal inactiva). Piden reconfigurar:
         *     `OPTION_REMOVED` (la opción ya no se ofrece con el producto), `OPTION_INACTIVE` (la opción o su grupo están inactivos), `GROUP_RULE_CHANGED` (la selección retenida excede el máximo vigente
         *     del grupo), `REQUIRED_SELECTION_MISSING` (hay un grupo obligatorio sin la selección mínima). Informativos: `PRICE_CHANGED` (precio por unidad vigente distinto del histórico, ambos con los extras
         *     retenidos), `QUANTITY_ADJUSTED` (la cantidad histórica excedía el tope vigente), `NOTE_DROPPED` (la nota no cumple el formato vigente y se omitió).
         * @enum {string}
         */
        OrderReorderIssueCode: "PRODUCT_REMOVED" | "PRODUCT_INACTIVE" | "PRODUCT_OUT_OF_STOCK" | "BRANCH_UNAVAILABLE" | "OPTION_REMOVED" | "OPTION_INACTIVE" | "GROUP_RULE_CHANGED" | "REQUIRED_SELECTION_MISSING" | "PRICE_CHANGED" | "QUANTITY_ADJUSTED" | "NOTE_DROPPED";
        OrderReorderIssue: {
            code: components["schemas"]["OrderReorderIssueCode"];
            /**
             * @description `blocking` = la línea no se puede añadir; `warning` = requiere acción del cliente; `info` = solo aviso.
             * @enum {string}
             */
            severity: "info" | "warning" | "blocking";
            /** Format: uuid */
            groupId?: string | null;
            groupName?: string | null;
            /** Format: uuid */
            optionId?: string | null;
            /** @description Nombre de la opción tal como quedó en el pedido (snapshot) cuando ya no existe. */
            optionName?: string | null;
            /** @description Solo `PRICE_CHANGED`: precio por unidad del pedido original (con los extras retenidos). Informativo; NO se reutiliza. */
            previousUnitPrice?: components["schemas"]["CheckoutMoney"] | null;
            /** @description Solo `PRICE_CHANGED`: precio por unidad vigente en la sucursal (con los extras retenidos). */
            currentUnitPrice?: components["schemas"]["CheckoutMoney"] | null;
            /** @description Solo `QUANTITY_ADJUSTED`: cantidad original. */
            from?: number | null;
            /** @description Solo `QUANTITY_ADJUSTED`: cantidad propuesta. */
            to?: number | null;
        };
        /** @description Lo que se pidió (snapshot del pedido, solo informativo). */
        OrderReorderOriginalLine: {
            productName: string;
            quantity: number;
            unitPrice: components["schemas"]["CheckoutMoney"];
            extrasPerUnit: components["schemas"]["CheckoutMoney"];
            modifiers: components["schemas"]["OrderDetailModifier"][];
            notes: string | null;
        };
        /** @description Precios VIGENTES de la sucursal, solo para mostrar (el servidor recotiza en F19/F20). */
        OrderReorderCurrent: {
            /** @description Precio efectivo de la sucursal (F13), SIN extras. */
            unitPrice: components["schemas"]["CheckoutMoney"];
            /** @description Suma de los extras RETENIDOS a su precio vigente, por unidad. */
            extrasPerUnit: components["schemas"]["CheckoutMoney"];
        };
        OrderReorderOptionDisplay: {
            /** Format: uuid */
            groupId: string;
            /** Format: uuid */
            optionId: string;
            groupName: string;
            optionName: string;
            extraPrice: components["schemas"]["CheckoutMoney"];
        };
        /** @description Datos para pintar la línea del carrito sin otra petición (nombres vigentes). NO son fuente de verdad del precio. */
        OrderReorderCandidateDisplay: {
            name: string;
            imageUrl: string | null;
            unitPrice: components["schemas"]["CheckoutMoney"];
            options: components["schemas"]["OrderReorderOptionDisplay"][];
        };
        /**
         * @description Línea candidata. `line` es EXACTAMENTE `CartQuoteLineInput` (F18; solo ids, `selections` ordenadas por `groupId` y `optionId`); `slug`, `note` y `display` completan la línea del carrito local.
         *     `note` es la observación del cliente en ese pedido (≤ 140), copiada solo si cumple el formato vigente.
         */
        OrderReorderCandidate: {
            line: components["schemas"]["CartQuoteLineInput"];
            slug: string;
            note: string | null;
            display: components["schemas"]["OrderReorderCandidateDisplay"];
        };
        /** @description Una línea del pedido original (mismo orden que `lineNo`) con su diagnóstico. */
        OrderReorderLine: {
            lineNo: number;
            status: components["schemas"]["OrderReorderLineStatus"];
            original: components["schemas"]["OrderReorderOriginalLine"];
            /** @description `null` si el producto no existe, no es visible o la sucursal no está activa. */
            current: components["schemas"]["OrderReorderCurrent"] | null;
            issues: components["schemas"]["OrderReorderIssue"][];
            /** @description `null` en `UNAVAILABLE`. En `NEEDS_CONFIGURATION` solo trae lo retenido y NO es agregable sin configurar. */
            candidate: components["schemas"]["OrderReorderCandidate"] | null;
        };
        /** @description Sucursal contra la que se validó. `acceptingOrders=false` NO impide añadir al carrito (F19 decide al cotizar), solo avisa. */
        OrderReorderBranch: {
            /** Format: uuid */
            originalBranchId: string;
            /** Format: uuid */
            requestedBranchId: string;
            sameBranch: boolean;
            name: string;
            active: boolean;
            acceptingOrders: boolean;
            /** @enum {string} */
            reason: "OPEN" | "INACTIVE" | "OUTSIDE_BUSINESS_HOURS" | "EXCEPTIONAL_CLOSURE" | "SCHEDULE_NOT_CONFIGURED";
            /** Format: date-time */
            nextOpensAt: string | null;
        };
        OrderReorderSummary: {
            lines: number;
            available: number;
            needsConfiguration: number;
            unavailable: number;
            /** @description Líneas con aviso `PRICE_CHANGED`. */
            priceChanged: number;
            /** @description Unidades de las líneas `AVAILABLE` (tras ajustes). */
            units: number;
            /** @description ESTIMACIÓN de las líneas `AVAILABLE` a precios vigentes, sin promociones, cupón ni entrega. NO es una cotización. */
            estimatedSubtotal: components["schemas"]["CheckoutMoney"];
            /** @description `true` si al menos una línea es `AVAILABLE`. */
            canAddAny: boolean;
        };
        /** @description F23 (spec 024, ADR-0029). Resultado de la vista previa. No crea ni guarda nada. La modalidad (`source.fulfillmentType`) y la dirección NO se copian: se eligen de nuevo en el checkout (F19). */
        OrderReorderPreview: {
            /** Format: date-time */
            generatedAt: string;
            /** @description Referencia informativa del pedido original (sin ids internos). */
            source: {
                /** @example MON-001042 */
                displayNumber: string;
                status: components["schemas"]["OrderLifecycleStatus"];
                /** @enum {string} */
                fulfillmentType: "PICKUP" | "DELIVERY";
                deliveryProvider: components["schemas"]["CourierProvider"] | null;
                /** Format: date-time */
                placedAt: string;
            };
            branch: components["schemas"]["OrderReorderBranch"];
            lines: components["schemas"]["OrderReorderLine"][];
            summary: components["schemas"]["OrderReorderSummary"];
        };
        /**
         * @description Fase PÚBLICA normalizada del pedido (F21, spec 022 §3). El servidor entrega CÓDIGOS estables; las etiquetas y
         *     descripciones (es/en) las pone la web. Mapeo desde `OrderLifecycleStatus`: `pending`=>`received`, `accepted`=>`accepted`,
         *     `preparing`=>`preparing`, `ready`=>`ready`, `on_the_way`=>`on_the_way`, `delivered`|`picked_up`=>`completed` (la web
         *     distingue entrega/retiro con `fulfillmentType`), `rejected`=>`rejected`, `cancelled`=>`cancelled`. No existe fase de
         *     «incidencia» ni de «pendiente de pago» (no son estados del pedido). Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        OrderPublicStatus: "received" | "accepted" | "preparing" | "ready" | "on_the_way" | "completed" | "rejected" | "cancelled";
        /**
         * @description Una fase del recorrido esperado. `reachedAt` = `changed_at` del PRIMER evento registrado cuya fase pública es esta;
         *     `null` = no ocurrida o sin registro (nunca una hora estimada). Una fase anterior a la actual con `reachedAt: null`
         *     indica un salto de estados en el historial (se muestra como superada, sin hora).
         */
        OrderTrackingStep: {
            phase: components["schemas"]["OrderPublicStatus"];
            /** Format: date-time */
            reachedAt: string | null;
        };
        /**
         * @description Una fila de `order_status_history` tal como está registrada. Sin `changed_by`, sin `reason` y sin identificadores
         *     internos. `seq` es la posición (desde 1) en el orden `changed_at, id` y solo sirve como clave estable de lista.
         */
        OrderTrackingEvent: {
            seq: number;
            status: components["schemas"]["OrderLifecycleStatus"];
            publicStatus: components["schemas"]["OrderPublicStatus"];
            /**
             * Format: date-time
             * @description ISO-8601 UTC; la web formatea en America/Guatemala.
             */
            occurredAt: string;
        };
        /**
         * @description Solo en pedidos DELIVERY. Hoy NO existe fuente de entregas (`deliveries`: F28/F29), por lo que únicamente se informa el
         *     proveedor del pedido y `status` es SIEMPRE `null`. Nunca incluye repartidor, teléfono, ubicación, GPS ni ETA. Con
         *     `PEDIDOSYA` (`BLOCKED_EXTERNAL`, F29) la web no muestra seguimiento externo.
         */
        OrderTrackingDelivery: {
            provider: components["schemas"]["CourierProvider"];
            /**
             * @description F28 (ADR-0032 D12, spec 029 §12): estado PÚBLICO y grueso de la entrega propia, derivado sin PII del motorista: `PENDING` (sin motorista), `ASSIGNED`, `PICKED_UP`, `DELIVERED` (incluye el retorno); `null` si
             *     no hay entrega, está `cancelled` o el proveedor es `PEDIDOSYA` (F29). Sigue siendo `string` y los clientes deben ignorar valores desconocidos; nunca expone nombre, teléfono ni ubicación del motorista.
             */
            status: string | null;
        };
        /** @description Seguimiento ligero para polling (ver `getOrderTracking`). Sin importes, líneas, contacto ni dirección. */
        OrderTracking: {
            /** Format: uuid */
            orderId: string;
            /** @example MON-001042 */
            displayNumber: string;
            /** Format: uuid */
            branchId: string;
            /** @enum {string} */
            fulfillmentType: "PICKUP" | "DELIVERY";
            status: components["schemas"]["OrderLifecycleStatus"];
            publicStatus: components["schemas"]["OrderPublicStatus"];
            /** @description `true` si `status` es `delivered`, `picked_up`, `rejected` o `cancelled`: no habrá más cambios que consultar. */
            terminal: boolean;
            /** Format: date-time */
            placedAt: string;
            /** Format: date-time */
            updatedAt: string;
            /**
             * Format: date-time
             * @description Hora del servidor al responder.
             */
            generatedAt: string;
            steps: components["schemas"]["OrderTrackingStep"][];
            events: components["schemas"]["OrderTrackingEvent"][];
            /** @description `true` si el historial tiene más de 50 eventos (se devuelven los 50 más recientes, en orden cronológico; faltan los más antiguos). */
            eventsTruncated: boolean;
            /** @description `null` en PICKUP. */
            delivery: components["schemas"]["OrderTrackingDelivery"] | null;
            /** @description F24: método y estado de pago reales (efectivo `PENDING|PAID`); independiente del estado del pedido y fuera del timeline. */
            payment: components["schemas"]["OrderDetailPayment"];
            /** @description Sugerencia de espera antes del siguiente refresco; `null` si `terminal`. */
            pollAfterSeconds: number | null;
        };
        OrderQuoteChange: {
            /** @enum {string} */
            field: "provider" | "subtotal" | "discountTotal" | "deliveryFee" | "total" | "lines";
            /** @description Valor cotizado antes (importe o proveedor; `null` en `lines`). */
            previous?: string | null;
            current?: string | null;
        };
        /** @description Conflicto 409 `QUOTE_CHANGED` / `QUOTE_EXPIRED`. Hereda `ErrorResponse` y añade la cotización vigente para re-aceptar. */
        OrderQuoteConflict: components["schemas"]["ErrorResponse"] & {
            changes: components["schemas"]["OrderQuoteChange"][];
            quote: components["schemas"]["CheckoutQuote"];
        };
        /** @description 422 `CHECKOUT_BLOCKED`. Hereda `ErrorResponse` y añade los bloqueos de la recotización. */
        OrderBlocked: components["schemas"]["ErrorResponse"] & {
            blockers: components["schemas"]["CheckoutBlocker"][];
        };
        AdminModifier: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            groupId: string;
            name: string;
            extraPrice: components["schemas"]["ModifierExtraPrice"];
            active: boolean;
            sortOrder: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminModifierList: {
            items: components["schemas"]["AdminModifier"][];
        };
        AdminModifierGroupSummary: {
            /** Format: uuid */
            id: string;
            name: string;
            minSelect: number;
            maxSelect: number;
            /** @description Derivado: `minSelect >= 1` (no se almacena). */
            required: boolean;
            active: boolean;
            /** @description Opciones totales (activas e inactivas). */
            optionCount: number;
            activeOptionCount: number;
            /** @description Productos a los que está asociado. */
            productCount: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @description Grupo con todas sus opciones (activas e inactivas) ordenadas por `sortOrder`. */
        AdminModifierGroup: components["schemas"]["AdminModifierGroupSummary"] & {
            options: components["schemas"]["AdminModifier"][];
        };
        AdminModifierGroupPage: {
            items: components["schemas"]["AdminModifierGroupSummary"][];
            page: number;
            pageSize: number;
            total: number;
        };
        AdminProductModifiers: {
            /** Format: uuid */
            productId: string;
            /** @description Grupos asociados (activos e inactivos) en el orden de asociación, con todas sus opciones. */
            groups: components["schemas"]["AdminModifierGroup"][];
        };
        ModifierOptionInput: {
            name: string;
            /** @description Opcional; por defecto `"0.00"`. */
            extraPrice?: components["schemas"]["ModifierExtraPrice"];
        };
        CreateModifierGroupRequest: {
            name: string;
            /** @description Opcional, por defecto 0. Rango y relación (0 <= min <= max) => 422 `MODIFIER_LIMITS_INVALID` (no 400). */
            minSelect?: number;
            /** @description Opcional, por defecto 1. Debe estar en 1-20 => 422 `MODIFIER_LIMITS_INVALID` (no 400). */
            maxSelect?: number;
            /** @description Opcional; por defecto `true`. */
            active?: boolean;
            /** @description Opcional. Máx. 30 (31-100 => 422 `MODIFIER_LIMIT_REACHED`). El orden define `sortOrder`. */
            options?: components["schemas"]["ModifierOptionInput"][];
        };
        UpdateModifierGroupRequest: {
            name?: string;
            /** @description Rango y relación => 422 `MODIFIER_LIMITS_INVALID`. */
            minSelect?: number;
            /** @description 1-20 => si no, 422 `MODIFIER_LIMITS_INVALID`. */
            maxSelect?: number;
            active?: boolean;
        };
        CreateModifierRequest: {
            name: string;
            /** @description Opcional; por defecto `"0.00"`. */
            extraPrice?: components["schemas"]["ModifierExtraPrice"];
            /** @description Opcional; por defecto `true`. */
            active?: boolean;
        };
        UpdateModifierRequest: {
            name?: string;
            extraPrice?: components["schemas"]["ModifierExtraPrice"];
            active?: boolean;
        };
        ReorderModifiersRequest: {
            /** @description TODAS las opciones actuales del grupo, en el orden deseado, sin duplicados ni ajenas (si no => 422 `MODIFIER_REORDER_MISMATCH`). */
            orderedIds: string[];
        };
        ReplaceProductModifierGroupsRequest: {
            /** @description Lista completa y ordenada (`[]` quita todos). Máx. 10 (11-50 => 422 `MODIFIER_LIMIT_REACHED`); duplicados/inexistentes/inactivos nuevos => 422 `MODIFIER_GROUP_INVALID`. */
            groupIds: string[];
        };
        /** @description Promoción pública INDICATIVA vigente que aplica a un producto en una sucursal (F15; cantidad 1, precio de la sucursal, esa promoción por sí sola). NO es una cotización y nunca revela un cupón ni su código. */
        StoreProductPromo: {
            /** Format: uuid */
            promotionId: string;
            name: string;
            isHappyHour: boolean;
            /** @description Solo consumo en el local; nunca aplica a recojo ni entrega. */
            dineInOnly: boolean;
            regularPrice: components["schemas"]["ProductPrice"];
            promoPrice: components["schemas"]["ProductPrice"];
        };
        /**
         * @description Tarjeta de un producto visible (F13, ampliada en F17). Los 4 primeros campos son los de F13 y no cambian de significado; los demás son aditivos y el servidor siempre los envía.
         *     Sin precio base ni indicio de override, sin stock, sin SKU, sin modificadores ni galería.
         */
        StoreBranchMenuItem: {
            /** Format: uuid */
            productId: string;
            slug: string;
            /** @description Precio EFECTIVO en esa sucursal (override o base); el base si no se envió `branchId`. Informativo; el servidor recalcula al cotizar (F19). */
            price: components["schemas"]["ProductPrice"];
            /** @description `false` = agotado/no disponible en esa sucursal (sin cantidades). `null` = no se envió `branchId` (se desconoce). La web lo muestra deshabilitado y no lo permite añadir al carrito. */
            available: boolean | null;
            name?: string;
            /** @description Descripción corta derivada de la descripción del producto (texto plano, recortada sin partir palabras); `null` si no hay descripción. */
            summary?: string | null;
            /** @description Imagen principal (la de menor `sortOrder`); `null` = la web muestra un placeholder. */
            image?: components["schemas"]["PublicProductMedia"] | null;
            category?: components["schemas"]["PublicProductCategoryRef"];
            /** @description La promoción indicativa vigente de mayor ahorro (desempate como ADR-0021); `null` sin sucursal o sin promoción aplicable. */
            promo?: components["schemas"]["StoreProductPromo"] | null;
        };
        StoreBranchMenu: {
            /**
             * Format: uuid
             * @description `null` = no se envió `branchId`.
             */
            branchId: string | null;
            items: components["schemas"]["StoreBranchMenuItem"][];
            /** @description Siempre presente desde F17. */
            page?: number;
            /** @description Siempre presente desde F17. */
            pageSize?: number;
            /** @description Productos que cumplen el filtro (todas las páginas). Siempre presente desde F17. */
            total?: number;
            /**
             * Format: date-time
             * @description Hora del servidor al generar la respuesta (puede estar en caché hasta 15 s). Siempre presente desde F17.
             */
            generatedAt?: string;
            /**
             * Format: date-time
             * @description Próximo instante (en 14 días) en que cambia por tiempo la info promocional de esta página; `null` si no hay. Acota `s-maxage`. Siempre presente desde F17.
             */
            nextChangeAt?: string | null;
        };
        StoreSearchPage: {
            /** Format: uuid */
            branchId: string | null;
            items: components["schemas"]["StoreBranchMenuItem"][];
            page: number;
            pageSize: number;
            /** @description Productos que cumplen la búsqueda (todas las páginas). */
            total: number;
            /** Format: date-time */
            generatedAt: string;
            /**
             * Format: date-time
             * @description Próximo cambio por tiempo de la info promocional de esta página; `null` si no hay. Acota `s-maxage`.
             */
            nextChangeAt: string | null;
        };
        /** @description Categoría raíz visible (F10), sin hijas; el árbol completo es `listStoreCategories`. */
        StoreBootstrapCategory: {
            /** Format: uuid */
            id: string;
            slug: string;
            name: string;
            description: string | null;
            /** @description Tiene al menos una hija visible. */
            hasChildren: boolean;
        };
        /**
         * @description Secciones NO críticas del agregado: si fallan, la respuesta sigue siendo 200 con la sección vacía o `null` y su nombre en `degraded`.
         * @enum {string}
         */
        StoreBootstrapSection: "availability" | "featured" | "promotions" | "banners";
        StoreBootstrap: {
            /**
             * Format: date-time
             * @description Hora del servidor al generar la respuesta (puede estar en caché hasta 15 s).
             */
            generatedAt: string;
            /**
             * Format: date-time
             * @description El MENOR no nulo entre `promotions` (cambio de vigencia), `banners` (inicio/fin) y `availability.nextTransitionAt`, con horizonte de 14 días; `null` si no hay. Acota `max-age`/`s-maxage`.
             */
            nextChangeAt: string | null;
            locale: components["schemas"]["BannerLocale"];
            /** Format: uuid */
            branchId: string | null;
            /** @description `null` sin `branchId`. */
            branch: components["schemas"]["PublicBranch"] | null;
            /** @description `null` sin `branchId` o si la sección falló (`degraded`). */
            availability: components["schemas"]["BranchAvailability"] | null;
            /** @description Categorías raíz visibles, ordenadas por `sortOrder`, `name`, `id`. */
            categories: components["schemas"]["StoreBootstrapCategory"][];
            /** @description Productos destacados visibles (tarjeta de `getStoreBranchMenu`). Vacío si ninguno está destacado (criterio P23) o la sección falló. */
            featured: components["schemas"]["StoreBranchMenuItem"][];
            /** @description Promociones y cupones VIGENTES ahora (forma pública de `listStorePromotions`, nunca `code`), SIN `items`. Vacío sin sucursal, sin vigentes o si la sección falló. */
            promotions: components["schemas"]["StorePromotion"][];
            /** @description Banners elegibles ahora (forma de `listStoreBanners`), ya ordenados. Vacío si ninguno aplica o la sección falló. */
            banners: components["schemas"]["StoreBanner"][];
            /** @description Productos visibles del menú (disponibles o no) para el pie del Inicio. */
            productCount: number;
            /** @description Secciones no críticas que fallaron en esta respuesta. Si no está vacío, la respuesta lleva `Cache-Control: no-store`. */
            degraded: components["schemas"]["StoreBootstrapSection"][];
        };
        /** @description Estado de un producto en una sucursal (F13). Sin fila en `branch_products` => `priceOverride=null`, `available=true`, `updatedAt=null`. */
        AdminBranchProductState: {
            /** Format: uuid */
            branchId: string;
            /** Format: uuid */
            productId: string;
            basePrice: components["schemas"]["ProductPrice"];
            /** @description Precio de la sucursal (`null` = usa el precio base). */
            priceOverride: string | null;
            effectivePrice: components["schemas"]["ProductPrice"];
            available: boolean;
            /** @description El público ve y puede pedir el producto en esa sucursal: producto visible (F11) Y `available`. */
            offered: boolean;
            /**
             * Format: date-time
             * @description Última escritura de la fila (`null` si no existe fila).
             */
            updatedAt: string | null;
        };
        /** @description Fila de la matriz por sucursal (`listAdminBranchProducts`). */
        AdminBranchProductRow: components["schemas"]["AdminBranchProductState"] & {
            sku: string | null;
            slug: string;
            name: string;
            category: components["schemas"]["AdminProductCategory"];
            /** @description Estado propio del producto (F11). */
            active: boolean;
            /** @description `active` Y categoría efectivamente visible. */
            publiclyVisible: boolean;
        };
        AdminBranchProductPage: {
            /** Format: uuid */
            branchId: string;
            items: components["schemas"]["AdminBranchProductRow"][];
            page: number;
            pageSize: number;
            total: number;
        };
        /** @description Fila de la matriz por producto (`listAdminProductBranches`). */
        AdminProductBranchRow: components["schemas"]["AdminBranchProductState"] & {
            branchCode: string;
            branchName: string;
            branchActive: boolean;
        };
        AdminProductBranches: {
            /** Format: uuid */
            productId: string;
            basePrice: components["schemas"]["ProductPrice"];
            active: boolean;
            publiclyVisible: boolean;
            items: components["schemas"]["AdminProductBranchRow"][];
        };
        SetBranchProductPricingRequest: {
            /** @description Cadena decimal GTQ (`"85.00"`; nunca `number`) o `null` para eliminar el override. Forma inválida => 400; `"0.00"` => 422 `BRANCH_PRICE_INVALID`. */
            priceOverride: string | null;
        };
        SetProductAvailabilityRequest: {
            /** Format: uuid */
            branchId: string;
            available: boolean;
        };
        /**
         * @description Tipo de medio. `PRODUCT_IMAGE` (F14; clave `products/<yyyy>/<uuid>.<ext>`, <= 5 MiB) y `BANNER_IMAGE` (F16; clave `banners/<yyyy>/<uuid>.<ext>`, <= 1 MiB; solo la sube y la usa un banner). Ampliar de nuevo exige migración y ADR.
         * @enum {string}
         */
        MediaKind: "PRODUCT_IMAGE" | "BANNER_IMAGE";
        /**
         * @description `PENDING` = intent emitido, objeto sin confirmar (caduca); `READY` = objeto verificado en R2 y publicable.
         * @enum {string}
         */
        MediaStatus: "PENDING" | "READY";
        /**
         * @description `R2` = adaptador real S3 de Cloudflare; `MOCK` = en memoria, solo desarrollo/pruebas (nunca prueba una integración real). Sin almacenamiento configurado las operaciones de subida responden 503.
         * @enum {string}
         */
        MediaStorageMode: "R2" | "MOCK";
        CreateMediaUploadIntentRequest: {
            kind: components["schemas"]["MediaKind"];
            /** @description `image/jpeg`, `image/png`, `image/webp` o `image/avif`. Cualquier otro valor => 422 `MEDIA_TYPE_NOT_ALLOWED` (no 400). La extensión del objeto se deriva de este MIME, no de un nombre de archivo. */
            mimeType: string;
            /**
             * Format: int64
             * @description Bytes exactos del archivo. Más de `MEDIA_MAX_BYTES` (5 MiB por defecto) => 422 `MEDIA_TOO_LARGE` (no 400).
             */
            sizeBytes: number;
            /** @description SHA-256 del archivo en hexadecimal minúsculas. Se firma como `x-amz-checksum-sha256` (base64) para que R2 lo verifique al recibir los bytes. */
            checksumSha256: string;
        };
        AdminMediaAsset: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["MediaKind"];
            status: components["schemas"]["MediaStatus"];
            /**
             * Format: uri
             * @description URL pública HTTPS estable (`R2_PUBLIC_BASE_URL` + clave de objeto). `null` mientras el asset está PENDING. NUNCA es una URL firmada.
             */
            url: string | null;
            mimeType: string;
            /** Format: int64 */
            sizeBytes: number;
            checksumSha256: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            confirmedAt: string | null;
            /**
             * Format: date-time
             * @description Solo PENDING: caducidad del intent.
             */
            expiresAt: string | null;
            /** @description Filas de `product_media` MÁS banners (`banners.image_asset_id`) que lo referencian (F16). */
            usageCount: number;
            storageMode: components["schemas"]["MediaStorageMode"];
        };
        AdminMediaUsage: {
            /** Format: uuid */
            productId: string;
            productName: string;
            /** Format: uuid */
            productMediaId: string;
        };
        AdminMediaBannerUsage: {
            /** Format: uuid */
            bannerId: string;
            bannerCode: string;
        };
        AdminMediaAssetDetail: components["schemas"]["AdminMediaAsset"] & {
            usages: components["schemas"]["AdminMediaUsage"][];
            /** @description F16 (aditivo, opcional): banners que usan el asset. Un asset de banner referenciado no se puede borrar (409 `MEDIA_IN_USE`). */
            bannerUsages?: components["schemas"]["AdminMediaBannerUsage"][];
        };
        AdminMediaAssetPage: {
            items: components["schemas"]["AdminMediaAsset"][];
            page: number;
            pageSize: number;
            total: number;
        };
        /** @description Resultado de `createAdminMediaUpload`. Con `deduplicated=true` no hay subida (`uploadUrl`, `headers` y `expiresAt` son `null`). */
        AdminMediaUploadIntent: {
            /** Format: uuid */
            assetId: string;
            deduplicated: boolean;
            /**
             * Format: uri
             * @description URL PUT firmada (SigV4) contra el endpoint S3 de R2. Secreto de corta vida: solo existe en esta respuesta; no guardarla, registrarla ni cachearla.
             */
            uploadUrl: string | null;
            /** @description Cabeceras firmadas del PUT: `Content-Type`, `Cache-Control` y `x-amz-checksum-sha256` se envían EXACTAMENTE; `Content-Length` (= `sizeBytes`, también firmado) lo fija el navegador solo al enviar el cuerpo: NO se envía manualmente (con XHR no llamar a `setRequestHeader` para él). El cuerpo debe ser exactamente el archivo declarado. */
            headers: {
                [key: string]: string;
            } | null;
            /** Format: date-time */
            expiresAt: string | null;
            storageMode: components["schemas"]["MediaStorageMode"];
            asset: components["schemas"]["AdminMediaAsset"];
        };
        CompleteMediaUploadRequest: {
            /** Format: uuid */
            assetId: string;
        };
        AttachProductMediaRequest: {
            /** Format: uuid */
            assetId: string;
            /** @description <= 200 caracteres; si no => 422 `PRODUCT_MEDIA_INVALID` (no 400). */
            altText?: string | null;
        };
        UpdateProductMediaRequest: {
            /** @description `null` o vacío lo borra; <= 200 caracteres; si no => 422 `PRODUCT_MEDIA_INVALID`. */
            altText: string | null;
        };
        ReorderProductMediaRequest: {
            /** @description Ids de `product_media` (no de assets), exactamente todos los del producto. */
            orderedIds: string[];
        };
        AdminProductMediaList: {
            items: components["schemas"]["AdminProductMedia"][];
        };
        /**
         * @description `PERCENT`: porcentaje de descuento sobre el precio de la línea (`value` 0 < v <= 100). `FIXED_AMOUNT`: monto fijo en GTQ descontado POR UNIDAD (`value` > 0), sin superar nunca el precio
         *     de la unidad. Las modalidades `2x1` y «precio especial» del prototipo NO existen en F15 (decisión de negocio P15).
         * @enum {string}
         */
        PromotionKind: "PERCENT" | "FIXED_AMOUNT";
        /** @enum {string} */
        PromotionScope: "ALL" | "SELECTED";
        /**
         * @description Número decimal como CADENA con 2 decimales (porcentaje o importe en GTQ según `kind`); nunca `number`.
         * @example 15.00
         */
        PromotionDecimal: string;
        PromotionScheduleSlot: {
            /** @description Día ISO (1 = lunes … 7 = domingo). Nunca `Date.getDay()`. Es el día de la hora LOCAL de `America/Guatemala`. */
            weekday: number;
            /**
             * @description Hora local `HH:mm`, inclusiva.
             * @example 15:00
             */
            startsAt: string;
            /**
             * @description Hora local `HH:mm` o `24:00`, exclusiva; debe ser mayor que `startsAt` (no se cruza la medianoche: parte el tramo en dos días).
             * @example 18:00
             */
            endsAt: string;
        };
        StorePromotionItem: {
            /** Format: uuid */
            productId: string;
            regularPrice: components["schemas"]["ProductPrice"];
            promoPrice: components["schemas"]["ProductPrice"];
        };
        StorePromotion: {
            /** Format: uuid */
            id: string;
            name: string;
            description: string | null;
            /** @description `true` = cupón: nunca se devuelve el código ni el descuento. */
            requiresCode: boolean;
            /** @description Promoción automática con horario semanal (derivado de `schedule`). */
            isHappyHour: boolean;
            /** @description Solo consumo en el local; nunca aplica a recojo ni entrega. */
            dineInOnly: boolean;
            /** @enum {string} */
            state: "live" | "upcoming";
            /** @description Ausente si `requiresCode`. */
            kind?: components["schemas"]["PromotionKind"];
            /** @description Ausente si `requiresCode`. */
            value?: components["schemas"]["PromotionDecimal"];
            /**
             * Format: date-time
             * @description Inicio de vigencia (inclusivo), instante con zona.
             */
            validFrom: string;
            /**
             * Format: date-time
             * @description Fin de vigencia (EXCLUSIVO), instante con zona.
             */
            validUntil: string;
            /** @description Tramos semanales locales; vacío = todos los días y todo el día dentro de la vigencia. */
            schedule: components["schemas"]["PromotionScheduleSlot"][];
            /**
             * Format: date-time
             * @description Próximo instante en que pasa a regir (si `upcoming`) o vuelve a regir tras terminar el tramo actual; `null` si no hay en 14 días.
             */
            nextStartsAt?: string | null;
            /**
             * Format: date-time
             * @description Próximo instante en que deja de regir (si `live`; tramos contiguos fusionados); `null` si no hay.
             */
            nextEndsAt?: string | null;
            productScope: components["schemas"]["PromotionScope"];
            /** @description Solo si `productScope=SELECTED` y no `requiresCode`. */
            productIds?: string[];
            /** @description Precios INDICATIVOS calculados por el servidor (ver la operación). Solo promociones automáticas con productos seleccionados. */
            items?: components["schemas"]["StorePromotionItem"][];
        };
        StorePromotionList: {
            /** Format: uuid */
            branchId: string;
            /**
             * Format: date-time
             * @description Hora del servidor al generar la respuesta (puede estar en caché hasta 30 s).
             */
            generatedAt: string;
            /**
             * Format: date-time
             * @description Próximo instante (en 14 días) en que cambia el conjunto de promociones vigentes de la sucursal; `null` si no hay. Acota `max-age`.
             */
            nextChangeAt: string | null;
            truncated: boolean;
            items: components["schemas"]["StorePromotion"][];
        };
        AdminPromotionBranchRef: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        AdminPromotionProductRef: {
            /** Format: uuid */
            id: string;
            name: string;
            slug: string;
        };
        AdminPromotionSummary: {
            /** Format: uuid */
            id: string;
            /** @description Código del cupón en mayúsculas; `null` = promoción automática. */
            code: string | null;
            name: string;
            description: string | null;
            kind: components["schemas"]["PromotionKind"];
            value: components["schemas"]["PromotionDecimal"];
            /** Format: date-time */
            startsAt: string;
            /**
             * Format: date-time
             * @description Exclusivo.
             */
            endsAt: string;
            dineInOnly: boolean;
            active: boolean;
            /**
             * @description Precedencia INACTIVE > EXPIRED > SCHEDULED > RUNNING (solo vigencia; el horario semanal está en `liveNow`).
             * @enum {string}
             */
            lifecycle: "INACTIVE" | "SCHEDULED" | "RUNNING" | "EXPIRED";
            /** @description `RUNNING` Y dentro de un tramo semanal (o sin tramos) en este instante. */
            liveNow: boolean;
            branchScope: components["schemas"]["PromotionScope"];
            /** @description Sucursales seleccionadas, recortadas al alcance del actor; vacío si `branchScope=ALL`. */
            branches: components["schemas"]["AdminPromotionBranchRef"][];
            productScope: components["schemas"]["PromotionScope"];
            productCount: number;
            scheduleCount: number;
            /** @description El actor cubre TODAS las sucursales de la promoción con `promotions.update`. */
            editable: boolean;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminPromotion: components["schemas"]["AdminPromotionSummary"] & {
            /** @description Productos seleccionados (vacío si `productScope=ALL`), orden `name`, `id`. */
            products: components["schemas"]["AdminPromotionProductRef"][];
            /** @description Orden `weekday`, `startsAt`. */
            schedule: components["schemas"]["PromotionScheduleSlot"][];
        };
        AdminPromotionPage: {
            items: components["schemas"]["AdminPromotionSummary"][];
            page: number;
            pageSize: number;
            total: number;
        };
        CreatePromotionRequest: {
            name: string;
            description?: string | null;
            /** @description `null` u omitido = automática. Se guarda en mayúsculas; único sin distinguir mayúsculas (409 `PROMOTION_CODE_TAKEN`). */
            code?: string | null;
            kind: components["schemas"]["PromotionKind"];
            value: components["schemas"]["PromotionDecimal"];
            /**
             * Format: date-time
             * @description Instante con zona (`Z` u offset); sin zona => 400.
             */
            startsAt: string;
            /**
             * Format: date-time
             * @description Exclusivo; debe ser mayor que `startsAt` (422 `PROMOTION_PERIOD_INVALID`).
             */
            endsAt: string;
            /** @default false */
            dineInOnly: boolean;
            /** @default true */
            active: boolean;
            branchScope: components["schemas"]["PromotionScope"];
            /** @description Obligatorio y no vacío si `SELECTED`; omitido o vacío si `ALL` (si no, 400). */
            branchIds?: string[];
            productScope: components["schemas"]["PromotionScope"];
            /** @description Obligatorio y no vacío si `SELECTED` (si no, 422 `PROMOTION_SCOPE_INVALID`); omitido o vacío si `ALL` (si no, 400). */
            productIds?: string[];
            schedule?: components["schemas"]["PromotionScheduleSlot"][];
        };
        UpdatePromotionRequest: {
            expectedVersion: number;
            name?: string;
            description?: string | null;
            code?: string | null;
            kind?: components["schemas"]["PromotionKind"];
            value?: components["schemas"]["PromotionDecimal"];
            /** Format: date-time */
            startsAt?: string;
            /** Format: date-time */
            endsAt?: string;
            dineInOnly?: boolean;
            branchScope?: components["schemas"]["PromotionScope"];
            branchIds?: string[];
            productScope?: components["schemas"]["PromotionScope"];
            productIds?: string[];
            schedule?: components["schemas"]["PromotionScheduleSlot"][];
        };
        UpdatePromotionStatusRequest: {
            active: boolean;
            /** @description Opcional; sin datos personales. */
            reason?: string;
        };
        /**
         * @description Idioma de los textos. `es` es el idioma de respaldo y el único obligatorio al crear.
         * @default es
         * @enum {string}
         */
        BannerLocale: "es" | "en";
        /**
         * @description Estado derivado (no es columna). Precedencia INACTIVE > EXPIRED > SCHEDULED > PUBLISHED; solo mira `active` y la vigencia `[startsAt, endsAt)`. Que además se muestre depende de `visibleNow`.
         * @enum {string}
         */
        BannerLifecycle: "INACTIVE" | "SCHEDULED" | "PUBLISHED" | "EXPIRED";
        /**
         * @description Precedencia cuando hay varios motivos: `PROMOTION_NOT_LIVE` > `CTA_TARGET_INACTIVE` > `IMAGE_UNAVAILABLE`. Por qué un banner `PUBLISHED` no se muestra ahora: su promoción vinculada no está vigente o no aplica a su alcance, su producto/categoría destino está inactivo, o la imagen no tiene URL pública. `null` si se muestra o si no está `PUBLISHED`.
         * @enum {string}
         */
        BannerHiddenReason: "PROMOTION_NOT_LIVE" | "CTA_TARGET_INACTIVE" | "IMAGE_UNAVAILABLE";
        /**
         * @description Destino estructurado. Los enlaces externos (`EXTERNAL`) NO existen en v1: incorporarlos exige migración, ADR y decisión P19.
         * @enum {string}
         */
        BannerCtaType: "NONE" | "MENU" | "PROMOTIONS" | "CATEGORY" | "PRODUCT" | "PAGE";
        /**
         * @description Lista blanca de páginas públicas de la tienda (`/trabaja-con-nosotros`, `/consultar`, `/incidencias`); la ruta la resuelve la web, nunca se guarda texto libre.
         * @enum {string}
         */
        BannerPage: "CAREERS" | "TRACK_ORDER" | "INCIDENTS";
        /** @description Solo el campo que corresponde al tipo: `CATEGORY` => `categoryId`; `PRODUCT` => `productId`; `PAGE` => `page`; el resto sin campos. Otra combinación => 422 `BANNER_CTA_INVALID`. */
        BannerCtaInput: {
            type: components["schemas"]["BannerCtaType"];
            /** Format: uuid */
            categoryId?: string | null;
            /** Format: uuid */
            productId?: string | null;
            /** @description Solo con `type=PAGE`. Valores permitidos: `CAREERS`, `TRACK_ORDER`, `INCIDENTS` (ver `BannerPage`). Se declara `string` a propósito: cualquier otro valor es una regla de negocio y responde 422 `BANNER_CTA_INVALID` (violation `TARGET_UNKNOWN`), no 400. Nunca se guardan rutas ni URL de texto libre. */
            page?: string | null;
        };
        /** @description Textos de un idioma. Cadenas recortadas; en blanco = ausente. Longitudes en caracteres. */
        BannerTranslationInput: {
            title?: string | null;
            subtitle?: string | null;
            /** @description Texto del botón; ausente => la web usa su etiqueta genérica localizada. */
            ctaLabel?: string | null;
            /** @description Texto alternativo de la imagen en este idioma. */
            imageAlt?: string | null;
        };
        BannerTranslationsInput: {
            es: components["schemas"]["BannerTranslationInput"];
            en?: components["schemas"]["BannerTranslationInput"] | null;
        };
        BannerTranslationsPatch: {
            es?: components["schemas"]["BannerTranslationInput"];
            /** @description `null` elimina la traducción al inglés. */
            en?: components["schemas"]["BannerTranslationInput"] | null;
        };
        BannerTranslationsView: {
            es: components["schemas"]["BannerTranslationInput"];
            en: components["schemas"]["BannerTranslationInput"] | null;
        };
        /** @description Imagen principal (escritorio). Ampliable con una imagen móvil sin romper clientes (campo opcional nuevo); no existe en v1. */
        StoreBannerImage: {
            /**
             * Format: uri
             * @description URL pública HTTPS permanente (`MediaUrlService`); nunca firmada.
             */
            url: string;
            mimeType: string;
        };
        StoreBannerCta: {
            type: components["schemas"]["BannerCtaType"];
            /** @description Solo `CATEGORY`. */
            categorySlug?: string | null;
            /**
             * Format: uuid
             * @description Solo `PRODUCT`.
             */
            productId?: string | null;
            page?: components["schemas"]["BannerPage"] | null;
        };
        StoreBanner: {
            /** Format: uuid */
            id: string;
            title: string;
            subtitle: string | null;
            ctaLabel: string | null;
            imageAlt: string;
            image: components["schemas"]["StoreBannerImage"];
            cta: components["schemas"]["StoreBannerCta"];
            /** @description Campos cuyo texto vino en español porque faltaba en el idioma pedido. */
            fallbackFields: ("title" | "subtitle" | "ctaLabel" | "imageAlt")[];
        };
        StoreBannerList: {
            /** Format: uuid */
            branchId: string | null;
            locale: components["schemas"]["BannerLocale"];
            /**
             * Format: date-time
             * @description Hora del servidor al generar la respuesta (puede estar en caché hasta 30 s).
             */
            generatedAt: string;
            /**
             * Format: date-time
             * @description Próximo instante (en 14 días) en que puede cambiar el conjunto publicado por tiempo; `null` si no hay. Acota `max-age`.
             */
            nextChangeAt: string | null;
            items: components["schemas"]["StoreBanner"][];
        };
        AdminBannerBranchRef: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        /** @description Referencia mínima; NUNCA incluye el código ni el descuento de un cupón. */
        AdminBannerPromotionRef: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            lifecycle: "INACTIVE" | "SCHEDULED" | "RUNNING" | "EXPIRED";
        };
        AdminBannerImage: {
            /** Format: uuid */
            assetId: string;
            /** Format: uri */
            url: string | null;
            mimeType: string;
            /** Format: int64 */
            sizeBytes: number;
        };
        AdminBannerCta: {
            type: components["schemas"]["BannerCtaType"];
            /** Format: uuid */
            categoryId: string | null;
            /** Format: uuid */
            productId: string | null;
            page: components["schemas"]["BannerPage"] | null;
            /** @description Nombre de la categoría o del producto destino (solo lectura). */
            targetLabel: string | null;
            /** @description `null` si el tipo no tiene destino de catálogo. */
            targetActive: boolean | null;
        };
        AdminBannerSummary: {
            /** Format: uuid */
            id: string;
            /** @description Identificador estable, único e inmutable. */
            code: string;
            /** @description Título en español (idioma de respaldo). */
            title: string;
            image: components["schemas"]["AdminBannerImage"];
            cta: components["schemas"]["AdminBannerCta"];
            branchScope: components["schemas"]["PromotionScope"];
            /** @description Sucursales seleccionadas, recortadas al alcance del actor; vacío si `branchScope=ALL`. */
            branches: components["schemas"]["AdminBannerBranchRef"][];
            promotion: components["schemas"]["AdminBannerPromotionRef"] | null;
            /**
             * Format: date-time
             * @description Inclusivo; `null` = ya vigente.
             */
            startsAt: string | null;
            /**
             * Format: date-time
             * @description Exclusivo; `null` = sin fin.
             */
            endsAt: string | null;
            active: boolean;
            /** @description Prioridad: menor sale primero; no es única (empate por `createdAt`, `id`). */
            sortOrder: number;
            lifecycle: components["schemas"]["BannerLifecycle"];
            /** @description `PUBLISHED` Y sin motivo para ocultarse (ver `hiddenReason`) con el reloj del servidor. */
            visibleNow: boolean;
            hiddenReason: components["schemas"]["BannerHiddenReason"] | null;
            /** @description Existe una traducción al inglés con título. */
            hasEnglish: boolean;
            /** @description El actor cubre TODAS las sucursales del banner con `banners.update`. */
            editable: boolean;
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminBanner: components["schemas"]["AdminBannerSummary"] & {
            translations: components["schemas"]["BannerTranslationsView"];
        };
        AdminBannerPage: {
            items: components["schemas"]["AdminBannerSummary"][];
            page: number;
            pageSize: number;
            total: number;
        };
        CreateBannerRequest: {
            code: string;
            /** Format: uuid */
            imageAssetId: string;
            translations: components["schemas"]["BannerTranslationsInput"];
            cta: components["schemas"]["BannerCtaInput"];
            branchScope: components["schemas"]["PromotionScope"];
            branchIds?: string[];
            /** Format: uuid */
            promotionId?: string | null;
            /** Format: date-time */
            startsAt?: string | null;
            /** Format: date-time */
            endsAt?: string | null;
            sortOrder?: number;
            /** @default true */
            active: boolean;
        };
        UpdateBannerRequest: {
            expectedVersion: number;
            /** Format: uuid */
            imageAssetId?: string;
            translations?: components["schemas"]["BannerTranslationsPatch"];
            cta?: components["schemas"]["BannerCtaInput"];
            branchScope?: components["schemas"]["PromotionScope"];
            branchIds?: string[];
            /** Format: uuid */
            promotionId?: string | null;
            /** Format: date-time */
            startsAt?: string | null;
            /** Format: date-time */
            endsAt?: string | null;
            sortOrder?: number;
        };
        UpdateBannerStatusRequest: {
            active: boolean;
            /** @description Opcional; sin datos personales. */
            reason?: string;
        };
        ReorderBannersRequest: {
            orderedIds: string[];
        };
        AdminBannerOrderItem: {
            /** Format: uuid */
            id: string;
            sortOrder: number;
            version: number;
        };
        AdminBannerOrder: {
            items: components["schemas"]["AdminBannerOrderItem"][];
        };
        /**
         * @description Acciones que el backoffice puede ofrecer sobre un pedido. `accept|reject|start_preparing|mark_ready|complete|cancel` se ejecutan con las operaciones `…AdminOrder` de F22; `dispatch`
         *     NO es un comando de pedidos: es el ACCESO al despacho en Entregas. F28: en entrega propia (`OWN`) está HABILITADA si el personal tiene `deliveries.assign` en la sucursal del pedido (la web abre Entregas; no cambia el pedido); con `PEDIDOSYA` sigue deshabilitada
         *     (`PROVIDER_BLOCKED_EXTERNAL`, F29). En F22 nunca estaba habilitada; la web debe seguir tolerando ambos casos.
         *     Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminOrderAction: "accept" | "reject" | "start_preparing" | "mark_ready" | "complete" | "cancel" | "dispatch";
        /**
         * @description Estado de una acción para ESTE personal y ESTE pedido. `enabled=false` con `NO_PERMISSION`: la web la OCULTA; con `DISPATCH_NOT_AVAILABLE` (valor heredado de F22; desde F28 ya no se emite para `OWN`) o
         *     `PROVIDER_BLOCKED_EXTERNAL` (PedidosYa: integración pendiente de documentación/credenciales) la muestra DESHABILITADA con el motivo. Solo se listan las acciones que existen para el estado y la
         *     modalidad del pedido (un terminal no lista ninguna).
         */
        AdminOrderActionState: {
            action: components["schemas"]["AdminOrderAction"];
            enabled: boolean;
            /**
             * @description `null` si `enabled`. Los clientes deben tolerar valores futuros.
             * @enum {string|null}
             */
            disabledReason: "NO_PERMISSION" | "DISPATCH_NOT_AVAILABLE" | "PROVIDER_BLOCKED_EXTERNAL" | null;
        };
        /** @description Fila ligera para tablero y listado (sin líneas, dirección, teléfono ni correo). `itemCount` = unidades (suma de cantidades). Importes como cadenas decimales GTQ. */
        AdminOrderSummary: {
            /** Format: uuid */
            id: string;
            /** Format: int64 */
            orderNumber: number;
            /** @example MON-001042 */
            displayNumber: string;
            status: components["schemas"]["OrderLifecycleStatus"];
            /** Format: uuid */
            branchId: string;
            branchName: string;
            /** @enum {string} */
            fulfillmentType: "PICKUP" | "DELIVERY";
            /** @description `null` en PICKUP. */
            deliveryProvider: components["schemas"]["CourierProvider"] | null;
            customerName: string;
            itemCount: number;
            total: components["schemas"]["CheckoutMoney"];
            /** @description Solo la preferencia declarada (`cash` o `null`); NO es un pago. */
            paymentMethodPreference: components["schemas"]["OrderPaymentPreference"] | null;
            /** @description F24: estado de pago real (efectivo). El tablero lo muestra como insignia; es independiente del estado del pedido. */
            paymentStatus: components["schemas"]["OrderPaymentStatus"];
            /**
             * Format: date-time
             * @description Pedido programado (P42: hoy siempre `null`; la programación es `MOCK_ONLY`).
             */
            scheduledFor: string | null;
            /** Format: date-time */
            placedAt: string;
            /** Format: date-time */
            updatedAt: string;
            availableActions: components["schemas"]["AdminOrderActionState"][];
        };
        AdminOrderPage: {
            items: components["schemas"]["AdminOrderSummary"][];
            /** @description Cursor opaco de la página siguiente; `null` = no hay más. */
            nextCursor: string | null;
            /** Format: date-time */
            generatedAt: string;
        };
        AdminOrderBoardSummary: {
            /** @description Pedidos `pending` dentro del alcance (conteo real, no solo las tarjetas mostradas). */
            pending: number;
            /** @description Pedidos en `pending`, `accepted`, `preparing`, `ready` u `on_the_way`. */
            active: number;
            /**
             * Format: date-time
             * @description `placedAt` del `pending` más antiguo (`null` si no hay); sirve para resaltar la espera sin inventar un SLA.
             */
            oldestPendingAt: string | null;
        };
        AdminOrderBoardColumn: {
            status: components["schemas"]["OrderLifecycleStatus"];
            /** @description Conteo real de la columna (activas: todos; terminales: dentro de `terminalWindowHours`). */
            count: number;
            hasMore: boolean;
            items: components["schemas"]["AdminOrderSummary"][];
        };
        /** @description Tablero agregado. `columns` siempre trae los 9 estados del catálogo en este orden fijo. */
        AdminOrderBoard: {
            /** Format: date-time */
            generatedAt: string;
            /**
             * Format: uuid
             * @description La sucursal pedida; `null` = todas las del alcance.
             */
            branchId: string | null;
            /** @enum {integer} */
            terminalWindowHours: 24;
            pollAfterSeconds: number;
            summary: components["schemas"]["AdminOrderBoardSummary"];
            columns: components["schemas"]["AdminOrderBoardColumn"][];
        };
        /**
         * @description Una fila de `order_status_history` para el PERSONAL. `actorName` = nombre del empleado que actuó (`null` si fue el cliente/sistema, p. ej. la creación, o si el empleado ya no existe);
         *     nunca el identificador ni el correo. `reason` es texto interno y solo lo ve el personal con `orders.read`.
         */
        AdminOrderHistoryEntry: {
            seq: number;
            status: components["schemas"]["OrderLifecycleStatus"];
            previousStatus: components["schemas"]["OrderLifecycleStatus"] | null;
            /** Format: date-time */
            at: string;
            actorName: string | null;
            reason: string | null;
        };
        /** @description Datos de contacto para atender el pedido. Sin correo. No se registran en logs ni en auditoría. */
        AdminOrderContact: {
            fullName: string;
            /** @example +50255551234 */
            phone: string;
        };
        /** @description Detalle para el personal: todo `AdminOrderSummary` más líneas/promociones/dirección (snapshots de F20), contacto, notas del cliente, desglose de importes, pago honesto e historial. */
        AdminOrderDetail: components["schemas"]["AdminOrderSummary"] & {
            /** @enum {string} */
            currency: "GTQ";
            lines: components["schemas"]["OrderDetailLine"][];
            promotions: components["schemas"]["OrderDetailPromotion"][];
            /** @description `null` en PICKUP. */
            address: components["schemas"]["OrderDetailAddress"] | null;
            contact: components["schemas"]["AdminOrderContact"];
            notes: string | null;
            subtotal: components["schemas"]["CheckoutMoney"];
            extrasTotal: components["schemas"]["CheckoutMoney"];
            discountTotal: components["schemas"]["CheckoutMoney"];
            deliveryFee: components["schemas"]["CheckoutMoney"];
            payment: components["schemas"]["AdminOrderPaymentSummary"];
            history: components["schemas"]["AdminOrderHistoryEntry"][];
            /** @description `true` si hay más de 50 eventos (se devuelven los 50 más recientes; faltan los más antiguos). */
            historyTruncated: boolean;
        };
        /**
         * @example {
         *       "expectedStatus": "pending"
         *     }
         */
        AdminOrderCommandRequest: {
            /** @description Estado que la persona vio al decidir. Debe ser un origen válido del comando; si el pedido ya cambió => 409. */
            expectedStatus: components["schemas"]["OrderLifecycleStatus"];
        };
        /**
         * @example {
         *       "expectedStatus": "pending",
         *       "reason": "Sin existencias de salmón"
         *     }
         */
        AdminOrderReasonRequest: {
            expectedStatus: components["schemas"]["OrderLifecycleStatus"];
            /** @description Motivo INTERNO (recortado; sin caracteres de control). Se guarda en el historial y la auditoría; nunca se muestra al cliente (P64). No escribir datos personales. */
            reason: string;
        };
        AdminOrderTransition: {
            from: components["schemas"]["OrderLifecycleStatus"];
            to: components["schemas"]["OrderLifecycleStatus"];
            /**
             * Format: date-time
             * @description Momento REAL en que se aplicó la transición (en una repetición, el de la original).
             */
            at: string;
            /** @description `true` = el pedido ya estaba en el destino por esta misma transición; no se escribió nada nuevo. */
            replayed: boolean;
            /** @description Quién la aplicó fue la misma persona que llama (útil para distinguir un doble clic de otra persona). */
            appliedByMe: boolean;
        };
        /**
         * @description Revisión que queda PENDIENTE para otra feature tras cancelar/rechazar; informativa, jamás se ejecuta aquí. `payment_review`: el pedido tiene un pago `PAID` (efectivo ya recibido) y se rechaza/cancela => posible devolución pendiente
         *     (derivado de `payments`, hecho real; la devolución es de F26 y aquí NO se crea ningún reembolso). Con pago `PENDING` o sin cobro: no aparece. `delivery_cancellation`: existe una entrega activa por cancelar (solo la reporta el puerto
         *     `OrderFulfillmentPort` de F28/F29; en F22 nunca aparece). Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminOrderPendingAction: "payment_review" | "delivery_cancellation";
        /**
         * @example {
         *       "order": {
         *         "id": "7b7c3d52-6a0f-4a8e-9a53-0f3a1e0b9c11",
         *         "orderNumber": 1042,
         *         "displayNumber": "MON-001042",
         *         "status": "cancelled",
         *         "branchId": "0b6f6a52-1c55-4c0e-8f3a-3a5d6a3c2b10",
         *         "branchName": "Sushi Mon Zona 10",
         *         "fulfillmentType": "PICKUP",
         *         "deliveryProvider": null,
         *         "customerName": "Ana López",
         *         "itemCount": 3,
         *         "total": "185.00",
         *         "paymentMethodPreference": "cash",
         *         "paymentStatus": "PAID",
         *         "scheduledFor": null,
         *         "placedAt": "2026-11-18T18:02:11.000Z",
         *         "updatedAt": "2026-11-18T18:20:41.512Z",
         *         "availableActions": []
         *       },
         *       "transition": {
         *         "from": "accepted",
         *         "to": "cancelled",
         *         "at": "2026-11-18T18:20:41.512Z",
         *         "replayed": false,
         *         "appliedByMe": true
         *       },
         *       "pendingActions": [
         *         "payment_review"
         *       ]
         *     }
         */
        AdminOrderTransitionResult: {
            order: components["schemas"]["AdminOrderSummary"];
            transition: components["schemas"]["AdminOrderTransition"];
            pendingActions: components["schemas"]["AdminOrderPendingAction"][];
        };
        AdminOrderStateSnapshot: {
            status: components["schemas"]["OrderLifecycleStatus"];
            /** Format: date-time */
            updatedAt: string;
        };
        /**
         * @description 409 `ORDER_STATE_CONFLICT` (el pedido ya no está en `expectedStatus`) y 422 `ORDER_TRANSITION_INVALID` (transición imposible). Hereda `ErrorResponse` y añade el estado ACTUAL para que la web
         *     refresque sin otra consulta. En el 422, `violations[].code` ∈ `ORDER_TERMINAL`, `ORDER_FULFILLMENT_MISMATCH`, `ORDER_SOURCE_INVALID`, `ORDER_DISPATCH_NOT_AVAILABLE`, `ORDER_PROVIDER_BLOCKED_EXTERNAL`,
         *     `ORDER_CANCEL_NOT_ALLOWED`.
         * @example {
         *       "statusCode": 409,
         *       "error": "CONFLICT",
         *       "message": "El pedido cambió mientras lo veías",
         *       "code": "ORDER_STATE_CONFLICT",
         *       "current": {
         *         "status": "rejected",
         *         "updatedAt": "2026-11-18T18:20:41.512Z"
         *       }
         *     }
         */
        AdminOrderStateError: components["schemas"]["ErrorResponse"] & {
            current: components["schemas"]["AdminOrderStateSnapshot"];
        };
        /**
         * @description Quién recibió el efectivo. F24: SOLO `STAFF` (personal en sucursal). F28 añadirá `RIDER` (motorista propio) de forma aditiva; los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        PaymentCollectorType: "STAFF";
        /**
         * @description Dónde se cobra, DERIVADO por el servidor del pedido (nunca de la entrada): `BRANCH` = PICKUP, en mostrador de la sucursal; `OWN_DELIVERY` = DELIVERY con reparto propio (`OWN`), efectivo al recibir.
         *     Un pedido con `delivery_provider = PEDIDOSYA` no tiene contexto de cobro (`null`): no se asume que el proveedor cobre efectivo (F29, `BLOCKED_EXTERNAL`).
         * @enum {string}
         */
        PaymentCollectionContext: "BRANCH" | "OWN_DELIVERY";
        /**
         * @description Por qué ESTE personal no puede registrar el cobro AHORA (calculado en el servidor). `ALREADY_PAID` ya está pagado; `ORDER_CLOSED` pedido `rejected`/`cancelled` (no se cobra);
         *     `PROVIDER_BLOCKED_EXTERNAL` pedido PedidosYa (no se asume cobro del proveedor); `AMOUNT_ZERO` total 0 (nada que cobrar); `LEGACY_PAYMENT_METHOD` pedido histórico de F20 sin pago `CASH`
         *     (preferencia retirada); `NO_PERMISSION` falta `payments.confirm` en la sucursal del pedido. Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminOrderPaymentBlockedReason: "ALREADY_PAID" | "ORDER_CLOSED" | "PROVIDER_BLOCKED_EXTERNAL" | "AMOUNT_ZERO" | "LEGACY_PAYMENT_METHOD" | "NO_PERMISSION";
        AdminOrderPaymentRegistration: {
            allowed: boolean;
            /** @description `null` si `allowed = true`. */
            blockedReason: components["schemas"]["AdminOrderPaymentBlockedReason"] | null;
        };
        /**
         * @description Resumen del pago para el detalle F22 (sin consulta adicional). `amountDue` = `orders.total` (el pedido nunca cambia de total). `outstanding` = `amountDue` si `PENDING`, `0.00` si `PAID`.
         *     `possibleRefundReview` = DERIVADO: `PAID` y pedido `rejected`/`cancelled` => «posible devolución pendiente» (informativo; NO crea reembolso: F26). El pago `PAID` jamás vuelve a `PENDING`.
         */
        AdminOrderPaymentSummary: {
            method: components["schemas"]["PaymentMethodCode"];
            status: components["schemas"]["OrderPaymentStatus"];
            amountDue: components["schemas"]["CheckoutMoney"];
            outstanding: components["schemas"]["CheckoutMoney"];
            /** Format: date-time */
            paidAt: string | null;
            possibleRefundReview: boolean;
            registration: components["schemas"]["AdminOrderPaymentRegistration"];
        };
        /**
         * @description Recepción del efectivo (solo con `PAID`). `amountApplied` = importe aplicado a la deuda = `amountDue` (NUNCA el efectivo entregado: es el ingreso). `tendered` = efectivo entregado; `change` = `tendered − amountApplied`,
         *     calculado SOLO en el servidor y NO es ingreso. `collectorName` = nombre mínimo del empleado (`null` si ya no existe); nunca id ni correo. Solo lo ve el personal con `payments.read`.
         */
        PaymentReception: {
            amountApplied: components["schemas"]["CheckoutMoney"];
            tendered: components["schemas"]["CheckoutMoney"];
            change: components["schemas"]["CheckoutMoney"];
            /**
             * Format: date-time
             * @description Reloj del SERVIDOR; el cliente nunca envía la fecha.
             */
            receivedAt: string;
            collectorType: components["schemas"]["PaymentCollectorType"];
            collectorName: string | null;
            /**
             * Format: uuid
             * @description La sucursal del PEDIDO (no la elige el cliente).
             */
            branchId: string;
            context: components["schemas"]["PaymentCollectionContext"];
        };
        /**
         * @description Detalle del pago de UN pedido para el personal (F24). Resumen + datos del pedido + recepción (si `PAID`). Cada pedido tiene a lo sumo UN pago completo en efectivo (sin parciales ni divididos).
         * @example {
         *       "method": "CASH",
         *       "status": "PAID",
         *       "amountDue": "185.00",
         *       "outstanding": "0.00",
         *       "paidAt": "2026-11-19T19:05:12.000Z",
         *       "possibleRefundReview": false,
         *       "registration": {
         *         "allowed": false,
         *         "blockedReason": "ALREADY_PAID"
         *       },
         *       "orderId": "7b7c3d52-6a0f-4a8e-9a53-0f3a1e0b9c11",
         *       "displayNumber": "MON-001042",
         *       "orderStatus": "picked_up",
         *       "branchId": "0b6f6a52-1c55-4c0e-8f3a-3a5d6a3c2b10",
         *       "fulfillmentType": "PICKUP",
         *       "deliveryProvider": null,
         *       "currency": "GTQ",
         *       "collectionContext": "BRANCH",
         *       "reception": {
         *         "amountApplied": "185.00",
         *         "tendered": "200.00",
         *         "change": "15.00",
         *         "receivedAt": "2026-11-19T19:05:12.000Z",
         *         "collectorType": "STAFF",
         *         "collectorName": "María Pérez",
         *         "branchId": "0b6f6a52-1c55-4c0e-8f3a-3a5d6a3c2b10",
         *         "context": "BRANCH"
         *       },
         *       "generatedAt": "2026-11-19T19:05:13.000Z"
         *     }
         */
        AdminOrderPayment: components["schemas"]["AdminOrderPaymentSummary"] & {
            /** Format: uuid */
            orderId: string;
            /** @example MON-001042 */
            displayNumber: string;
            orderStatus: components["schemas"]["OrderLifecycleStatus"];
            /** Format: uuid */
            branchId: string;
            /** @enum {string} */
            fulfillmentType: "PICKUP" | "DELIVERY";
            deliveryProvider: components["schemas"]["CourierProvider"] | null;
            /** @enum {string} */
            currency: "GTQ";
            /** @description `null` para PedidosYa (no se asume cobro del proveedor). */
            collectionContext: components["schemas"]["PaymentCollectionContext"] | null;
            /** @description `null` mientras `PENDING`. */
            reception: components["schemas"]["PaymentReception"] | null;
            /** Format: date-time */
            generatedAt: string;
        };
        /**
         * @description Registro del efectivo recibido. SOLO dos campos: el cliente nunca envía total, estado, empleado, sucursal, cambio, fecha ni moneda (GTQ fija); cualquier otro campo => 400. `tendered` = efectivo
         *     entregado por el cliente: cadena decimal de HASTA 2 decimales (más => 400 `PAYMENT_AMOUNT_INVALID`, sin redondeo silencioso), `> 0`, `≥` total del pedido (si no, 422 `CASH_AMOUNT_INSUFFICIENT`) y `≤` el tope
         *     de seguridad `Q 5,000.00` (si no, 422 `CASH_TENDERED_TOO_LARGE`; P83). `receivedConfirmed` debe ser `true` (casilla «recibí físicamente el dinero»); `false` o ausente => 400 `PAYMENT_CONFIRMATION_REQUIRED`.
         * @example {
         *       "tendered": "200.00",
         *       "receivedConfirmed": true
         *     }
         */
        AdminCashPaymentRequest: {
            /** @example 200.00 */
            tendered: string;
            /** @enum {boolean} */
            receivedConfirmed: true;
        };
        AdminCashPaymentResult: {
            payment: components["schemas"]["AdminOrderPayment"];
            /** @description `true` = repetición idempotente (misma clave y mismo cuerpo): no se escribió nada nuevo; `payment.reception` es la original. */
            replayed: boolean;
            /** @description La recepción fue registrada por la misma persona que llama (útil para distinguir un doble clic de otra persona). */
            appliedByMe: boolean;
        };
        /**
         * @description 409 de F24. `PAYMENT_ALREADY_REGISTERED` (ya `PAID` con OTRA clave o cuerpo) y `ORDER_NOT_PAYABLE` (pedido `rejected`/`cancelled`: no se cobra). Hereda `ErrorResponse` y añade el pago ACTUAL
         *     para que la web refresque sin otra consulta. `IDEMPOTENCY_KEY_REUSED` (misma clave con otro cuerpo) usa `ErrorResponse` simple.
         */
        AdminPaymentConflict: components["schemas"]["ErrorResponse"] & {
            current: components["schemas"]["AdminOrderPayment"];
        };
        /**
         * @description `CREATED` = pago `PENDING` creado con el pedido (sin actor); `CASH_RECEIVED` = efectivo registrado por personal. Los clientes deben tolerar valores futuros (F26/F28).
         * @enum {string}
         */
        PaymentEventType: "CREATED" | "CASH_RECEIVED";
        /** @description Evento SOLO-AÑADIR del pago. `actorName` = nombre mínimo del empleado (`null` en `CREATED` o si ya no existe); nunca id ni correo. */
        AdminPaymentEvent: {
            seq: number;
            type: components["schemas"]["PaymentEventType"];
            /** Format: date-time */
            at: string;
            actorName: string | null;
            amountDue: components["schemas"]["CheckoutMoney"];
            tendered: components["schemas"]["CheckoutMoney"] | null;
            change: components["schemas"]["CheckoutMoney"] | null;
        };
        AdminPaymentHistory: {
            /** Format: uuid */
            orderId: string;
            /** @example MON-001042 */
            displayNumber: string;
            /** @description Orden cronológico `at, id`. Con un pago completo único hay a lo sumo 2 eventos; el tope de 20 deja margen a F26/F28. */
            items: components["schemas"]["AdminPaymentEvent"][];
            /** Format: date-time */
            generatedAt: string;
        };
        /**
         * @description Estado de la entrega propia (F28, ADR-0032). `pending` = sin motorista; `assigned` = motorista asignado, aún no recogió; `picked_up` = recogió y va en camino (el pedido está `on_the_way`);
         *     `delivered` = entregada al cliente, el motorista REGRESA (sigue ocupado); `returned` = retorno registrado (terminal; libera al motorista); `cancelled` = cancelada antes de la recogida (terminal salvo reapertura).
         *     El motorista cuenta como OCUPADO en `assigned`, `picked_up` y `delivered`. Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminDeliveryStatus: "pending" | "assigned" | "picked_up" | "delivered" | "returned" | "cancelled";
        /**
         * @description Evento del historial (distingue asignar de reasignar y reabrir de crear). Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminDeliveryEvent: "created" | "reopened" | "rider_assigned" | "rider_reassigned" | "rider_unassigned" | "picked_up" | "delivered" | "returned" | "cancelled";
        /**
         * @description Acciones que el backoffice puede ofrecer sobre una entrega. Los clientes deben tolerar valores futuros.
         * @enum {string}
         */
        AdminDeliveryAction: "assign_rider" | "reassign_rider" | "unassign_rider" | "mark_picked_up" | "mark_delivered" | "return_to_branch" | "cancel";
        /**
         * @description Estado de una acción para ESTE personal y ESTE estado de la entrega. `enabled=false` con `NO_PERMISSION`: la web la OCULTA; con `ORDER_NOT_READY` (recoger antes de que el pedido esté `ready`) la
         *     muestra deshabilitada con el motivo. Solo se listan las acciones que existen para el estado. El servidor revalida siempre.
         */
        AdminDeliveryActionState: {
            action: components["schemas"]["AdminDeliveryAction"];
            enabled: boolean;
            /**
             * @description `null` si `enabled`. Los clientes deben tolerar valores futuros.
             * @enum {string|null}
             */
            disabledReason: "NO_PERMISSION" | "ORDER_NOT_READY" | null;
        };
        /** @description Motorista de la entrega. Sin sucursal, placa ni teléfono completo (PII: `getAdminRider`, con `riders.read`). */
        AdminDeliveryRider: {
            /** Format: uuid */
            id: string;
            fullName: string;
            vehicleType: components["schemas"]["RiderVehicleType"] | null;
            /** @example +502****5678 */
            phoneMasked: string;
        };
        /** @description Pedido de la entrega (solo datos operativos; sin importes ni líneas). */
        AdminDeliveryOrderRef: {
            /** Format: uuid */
            id: string;
            /** @example MON-001042 */
            displayNumber: string;
            status: components["schemas"]["OrderLifecycleStatus"];
            deliveryProvider: components["schemas"]["CourierProvider"];
        };
        /** @description Snapshot de la dirección del pedido (PII). Solo en el detalle de una entrega ABIERTA y a quien tiene `orders.read`. */
        AdminDeliveryAddress: {
            municipalityName: string;
            zone: string | null;
            addressLine: string;
            referenceNote: string | null;
        };
        /** @description Contacto del cliente (PII). Mismas condiciones que `AdminDeliveryAddress`. El motorista NO es usuario: el personal le transmite lo necesario. */
        AdminDeliveryCustomer: {
            name: string;
            /** @example +50255501122 */
            phone: string;
        };
        /**
         * @description Fila ligera de entrega (listado y resultado de comandos). Sin PII del cliente. `riderOccupied` = hay motorista y la entrega es `assigned|picked_up|delivered`; `awaitingReturn` = `delivered` (entregada, el
         *     motorista aún no registró el retorno). `version` es la que debe reenviarse como `expectedVersion`.
         */
        AdminDeliverySummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            orderId: string;
            /** @example MON-001042 */
            displayNumber: string;
            /** Format: uuid */
            branchId: string;
            branchName: string;
            status: components["schemas"]["AdminDeliveryStatus"];
            orderStatus: components["schemas"]["OrderLifecycleStatus"];
            municipalityName: string | null;
            zone?: string | null;
            /** @description `null` en `pending` y `cancelled`. */
            rider: components["schemas"]["AdminDeliveryRider"] | null;
            riderOccupied: boolean;
            awaitingReturn: boolean;
            version: number;
            /** Format: date-time */
            assignedAt?: string | null;
            /** Format: date-time */
            pickedUpAt?: string | null;
            /** Format: date-time */
            deliveredAt?: string | null;
            /** Format: date-time */
            returnedAt?: string | null;
            /** Format: date-time */
            cancelledAt?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            availableActions: components["schemas"]["AdminDeliveryActionState"][];
        };
        /** @description Evento del historial de la entrega (solo-añadir). `reason` es texto INTERNO (cancelación/desasignación). `riderName` es el del motorista del evento (puede ser el liberado). */
        AdminDeliveryHistoryEntry: {
            event: components["schemas"]["AdminDeliveryEvent"];
            oldStatus: components["schemas"]["AdminDeliveryStatus"] | null;
            status: components["schemas"]["AdminDeliveryStatus"];
            /** Format: uuid */
            riderId: string | null;
            riderName: string | null;
            reason: string | null;
            /** @description Nombre del personal; `null` si fue el sistema. */
            actorName: string | null;
            /** Format: date-time */
            at: string;
        };
        /** @description Detalle de una entrega: `AdminDeliverySummary` + pedido, contacto y dirección (condicionados) e historial (≤ 50 eventos, cronológico ascendente). */
        AdminDelivery: components["schemas"]["AdminDeliverySummary"] & {
            order: components["schemas"]["AdminDeliveryOrderRef"];
            /** @description `true` solo si la entrega está abierta Y el personal tiene `orders.read` en la sucursal; si no, `customer` y `address` son `null`. */
            contactVisible: boolean;
            customer: components["schemas"]["AdminDeliveryCustomer"] | null;
            address: components["schemas"]["AdminDeliveryAddress"] | null;
            history: components["schemas"]["AdminDeliveryHistoryEntry"][];
            historyTruncated: boolean;
        };
        AdminDeliveryPage: {
            items: components["schemas"]["AdminDeliverySummary"][];
            /** @description Cursor opaco para la página siguiente; `null` = última. */
            nextCursor: string | null;
            /** Format: date-time */
            generatedAt: string;
        };
        AdminDeliveryTransition: {
            /** @description `null` al crear. */
            from: components["schemas"]["AdminDeliveryStatus"] | null;
            to: components["schemas"]["AdminDeliveryStatus"];
            event: components["schemas"]["AdminDeliveryEvent"];
            /**
             * Format: date-time
             * @description Momento real de la transición (en una repetición, el de la original).
             */
            at: string;
            /** @description `true` si la entrega YA estaba en ese estado por este mismo comando: no se escribió nada. */
            replayed: boolean;
            appliedByMe: boolean;
        };
        AdminDeliveryCommandResult: {
            delivery: components["schemas"]["AdminDeliverySummary"];
            transition: components["schemas"]["AdminDeliveryTransition"];
        };
        AdminDeliveryStateSnapshot: {
            status: components["schemas"]["AdminDeliveryStatus"];
            version: number;
        };
        /**
         * @description 409 `DELIVERY_STATE_CONFLICT` (versión o estado distintos de lo esperado) y 409 `ORDER_STATE_CONFLICT` del pedido (en este caso `current` es el del pedido: `AdminOrderStateSnapshot`). Hereda
         *     `ErrorResponse` y añade el estado ACTUAL para refrescar la vista sin otra consulta.
         * @example {
         *       "statusCode": 409,
         *       "error": "CONFLICT",
         *       "message": "La entrega cambió mientras la veías",
         *       "code": "DELIVERY_STATE_CONFLICT",
         *       "current": {
         *         "status": "assigned",
         *         "version": 3
         *       }
         *     }
         */
        AdminDeliveryStateError: components["schemas"]["ErrorResponse"] & {
            current: components["schemas"]["AdminDeliveryStateSnapshot"] | components["schemas"]["AdminOrderStateSnapshot"];
        };
        CreateAdminDeliveryRequest: {
            /** Format: uuid */
            orderId: string;
        };
        AssignOwnRiderRequest: {
            /** Format: uuid */
            riderId: string;
            /** @description La `version` de la entrega que la persona vio. */
            expectedVersion: number;
        };
        AdminDeliveryCommandRequest: {
            /** @description La `version` de la entrega que la persona vio. */
            expectedVersion: number;
        };
        UnassignRiderRequest: {
            expectedVersion: number;
            /** @description Opcional. Texto INTERNO; no incluyas datos personales. */
            reason?: string;
        };
        CancelAdminDeliveryRequest: {
            expectedVersion: number;
            /** @description OBLIGATORIO. Texto INTERNO; no incluyas datos personales. */
            reason: string;
        };
    };
    responses: never;
    parameters: {
        /** @description UUID de la promoción (`promotions.id`). */
        PromotionId: string;
        /** @description UUID del banner (`banners.id`). */
        BannerId: string;
        /** @description UUID del empleado (`staff_users.id`). */
        StaffId: string;
        /** @description UUID del rol. */
        RoleId: string;
        /** @description UUID de la sucursal. */
        BranchId: string;
        /** @description UUID del cierre extraordinario (`branch_closures.id`). */
        ClosureId: string;
        /** @description UUID de la zona de entrega (`delivery_zones.id`). */
        DeliveryZoneId: string;
        /** @description UUID del motorista (`riders.id`). */
        RiderId: string;
        /** @description UUID del producto (`products.id`, catálogo F11). */
        FavoriteProductId: string;
        /** @description UUID de la categoría (`categories.id`). */
        CategoryId: string;
        /** @description UUID del producto (`products.id`). */
        ProductId: string;
        /** @description Slug público del producto (`products.slug`). */
        ProductSlug: string;
        /** @description UUID del grupo de modificadores (`modifier_groups.id`). */
        ModifierGroupId: string;
        /** @description UUID de la opción (`modifiers.id`). */
        ModifierId: string;
        /** @description UUID del asset de medios (`media_assets.id`, F14). */
        MediaAssetId: string;
        /** @description UUID de la fila de imagen del producto (`product_media.id`, F14). */
        ProductMediaId: string;
        /** @description UUID del producto (`products.id`) cuyo precio de sucursal se gestiona (F13). */
        BranchProductId: string;
        /** @description UUID del pedido (`orders.id`). */
        AdminOrderId: string;
        /** @description UUID de la entrega (`deliveries.id`). */
        DeliveryId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dependencias disponibles */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadyResponse"];
                };
            };
            /** @description Token de salud ausente o inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Base de datos o esquema `app` no disponible */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAuthContext: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contexto de la identidad */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthContextResponse"];
                };
            };
            /** @description Token ausente, inválido, expirado o con emisor/audiencia incorrectos */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminContext: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contexto administrativo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminContextResponse"];
                };
            };
            /** @description Token ausente, inválido, expirado o con emisor/audiencia incorrectos */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta un permiso, o es personal con sesión `aal1` (mensaje `MFA_REQUIRED`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Perfil del cliente */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCustomerProfileRequest"];
            };
        };
        responses: {
            /** @description Perfil actualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Datos inválidos (formato, longitud o campo no permitido) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getCustomerStorefront: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contexto de cuenta del cliente autenticado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerStorefrontContext"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMyOrders: {
        parameters: {
            query?: {
                /** @description Estados del catálogo `OrderLifecycleStatus` separados por comas (p. ej. `pending,accepted,preparing,ready,on_the_way` para «en curso»). Un valor fuera del catálogo => 400. */
                status?: string;
                /** @description Filtra por sucursal del pedido. Una sucursal sin pedidos del cliente devuelve una página vacía (no se confirma si existe). */
                branchId?: string;
                /** @description Instante ISO 8601 con zona (inclusive). Sin zona => 400. */
                from?: string;
                /** @description Instante ISO 8601 con zona (exclusivo); mayor que `from` y a lo sumo 366 días después (si no, 400). */
                to?: string;
                /** @description Cursor opaco devuelto por la página anterior (`nextCursor`). */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de pedidos del cliente (puede venir vacía) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c",
                     *           "orderNumber": 1042,
                     *           "displayNumber": "MON-001042",
                     *           "status": "picked_up",
                     *           "publicStatus": "completed",
                     *           "terminal": true,
                     *           "branchId": "0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b",
                     *           "branchName": "Sushi Mon Zona 10",
                     *           "fulfillmentType": "PICKUP",
                     *           "deliveryProvider": null,
                     *           "itemCount": 3,
                     *           "total": "165.00",
                     *           "currency": "GTQ",
                     *           "paymentMethodPreference": "cash",
                     *           "placedAt": "2026-11-18T19:42:10.000Z",
                     *           "updatedAt": "2026-11-18T20:15:44.000Z"
                     *         }
                     *       ],
                     *       "nextCursor": null,
                     *       "generatedAt": "2026-11-19T15:00:00.000Z"
                     *     }
                     */
                    "application/json": components["schemas"]["MyOrderPage"];
                };
            };
            /** @description Parámetros inválidos (estado fuera del catálogo, fechas sin zona, rango excesivo) o `ORDER_CURSOR_INVALID` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP y actor; contador propio de esta ruta). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`, reintentable (`Retry-After`) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMyFavorites: {
        parameters: {
            query?: {
                page?: number;
                /** @description 0 = solo `favoriteProductIds`/`total` (sin `items` ni consulta al catálogo). Máximo 50. */
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Favoritos del cliente */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerFavorites"];
                };
            };
            /** @description Parámetros de consulta inválidos o desconocidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: 120 por minuto por IP en esta ruta. `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    addMyFavorite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`, catálogo F11). */
                productId: components["parameters"]["FavoriteProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description El producto es favorito del cliente (recién marcado o ya lo era). Sin cuerpo. */
            204: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `productId` no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND`: el producto no existe o no está publicado */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `FAVORITES_LIMIT_REACHED`: el cliente ya tiene el máximo de favoritos */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: 60 por minuto por IP en esta ruta. `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description `CATALOG_UNAVAILABLE`: no se puede validar el producto (catálogo sin implementar, caído o con timeout).
             *     No se guardó nada; reintentar más tarde. También `FAVORITES_BUSY` (candado o tiempo de la transacción agotados;
             *     reintentable). Son los únicos 5xx que exponen `code`.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    removeMyFavorite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`, catálogo F11). */
                productId: components["parameters"]["FavoriteProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description El producto ya no es favorito del cliente (lo fuera o no antes). Sin cuerpo. */
            204: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `productId` no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: 60 por minuto por IP en esta ruta. `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMyAddresses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Direcciones del cliente */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerAddressList"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createMyAddress: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCustomerAddressRequest"];
            };
        };
        responses: {
            /** @description Dirección creada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerAddress"];
                };
            };
            /** @description Datos inválidos (`ADDRESS_INVALID`), municipio inexistente (`MUNICIPALITY_NOT_FOUND`) o zona de la ciudad de Guatemala ausente (`ZONE_REQUIRED`) o inválida (`ZONE_INVALID`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Límite de direcciones alcanzado (ADDRESS_LIMIT_REACHED) o duplicado (ADDRESS_DUPLICATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getMyAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dirección */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerAddress"];
                };
            };
            /** @description Identificador inválido (no es UUID) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no pertenece al cliente (ADDRESS_NOT_FOUND) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteMyAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dirección eliminada */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Identificador inválido (no es UUID) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no pertenece al cliente (ADDRESS_NOT_FOUND) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateMyAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCustomerAddressRequest"];
            };
        };
        responses: {
            /** @description Dirección actualizada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerAddress"];
                };
            };
            /** @description Datos inválidos, campo no permitido, municipio inexistente o zona de la ciudad de Guatemala ausente (`ZONE_REQUIRED`) o inválida (`ZONE_INVALID`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no pertenece al cliente (ADDRESS_NOT_FOUND) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Duplicado (ADDRESS_DUPLICATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    setDefaultMyAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dirección predeterminada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerAddress"];
                };
            };
            /** @description Identificador inválido (no es UUID) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no pertenece al cliente (ADDRESS_NOT_FOUND) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listPublicBranches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucursales activas */
            200: {
                headers: {
                    /** @description public, max-age=60, s-maxage=300, stale-while-revalidate=600 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicBranchListResponse"];
                };
            };
        };
    };
    getPublicBranch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucursal activa */
            200: {
                headers: {
                    /** @description public, max-age=60, s-maxage=300, stale-while-revalidate=600 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicBranch"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no está activa */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminBranches: {
        parameters: {
            query?: {
                /** @description Busca por nombre o código (contiene, sin distinguir mayúsculas). Máx. 100 caracteres. */
                q?: string;
                /** @description Filtra por estado administrativo. Sin valor = todas. */
                active?: boolean;
                sort?: "name" | "code" | "createdAt";
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de sucursales */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranchPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminBranch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBranchRequest"];
            };
        };
        responses: {
            /** @description Sucursal creada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranch"];
                };
            };
            /** @description Datos inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin permiso, sin alcance global o sesión no aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Ya existe una sucursal con ese código */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminBranch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucursal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranch"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBranch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranchRequest"];
            };
        };
        responses: {
            /** @description Sucursal actualizada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranch"];
                };
            };
            /** @description Datos inválidos o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin permiso o sesión no aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBranchStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranchStatusRequest"];
            };
        };
        responses: {
            /** @description Sucursal con su estado actual */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranch"];
                };
            };
            /** @description Datos inválidos (p. ej. desactivar sin motivo) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin permiso o sesión no aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminStaff: {
        parameters: {
            query?: {
                /** @description Busca por nombre o correo (contiene, sin distinguir mayúsculas). Máx. 100 caracteres. */
                q?: string;
                /** @description Empleados con una asignación a esta sucursal. */
                branchId?: string;
                /** @description Empleados con una asignación de este rol. */
                roleId?: string;
                /** @description Estado del empleado. Sin valor = todos. */
                active?: boolean;
                /** @description Estado de vínculo de identidad. */
                identityStatus?: components["schemas"]["StaffIdentityStatus"];
                /** @description Campo de orden. */
                sort?: "fullName" | "email" | "createdAt";
                /** @description Sentido. */
                order?: "asc" | "desc";
                /** @description Página. */
                page?: number;
                /** @description Tamaño de página. */
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de empleados */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaffPage"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminStaff: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateStaffRequest"];
            };
        };
        responses: {
            /** @description Empleado preautorizado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaff"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Ya existe un empleado con ese correo */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminStaff: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del empleado (`staff_users.id`). */
                id: components["parameters"]["StaffId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Empleado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaff"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminStaff: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del empleado (`staff_users.id`). */
                id: components["parameters"]["StaffId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStaffRequest"];
            };
        };
        responses: {
            /** @description Empleado actualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaff"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Correo ya en uso, o correo de una identidad ya vinculada */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminStaffStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del empleado (`staff_users.id`). */
                id: components["parameters"]["StaffId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStaffStatusRequest"];
            };
        };
        responses: {
            /** @description Empleado con su estado actual */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaff"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Dejaría al sistema sin administrador activo y vinculado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    resetAdminStaffMfa: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del empleado (`staff_users.id`). */
                id: components["parameters"]["StaffId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description MFA reiniciado (o el empleado no tenía factores). Sin cuerpo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Identificador inválido (no es UUID) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description No es personal activo, falta `staff.update`, sesión no `aal2` (`MFA_REQUIRED`), el actor no tiene alcance global
             *     o el objetivo es el propio actor (mensaje genérico `Acceso denegado`; el motivo queda en auditoría)
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description El empleado no existe o está fuera del alcance del actor (`STAFF_NOT_FOUND`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description El empleado aún no vinculó su cuenta de Auth (`STAFF_NOT_LINKED`); no hay factores que reiniciar */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Demasiadas solicitudes (`RATE_LIMITED`, 5 por minuto por actor o 20 por minuto por IP) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description El proveedor de identidad falló al listar o eliminar factores (`MFA_RESET_FAILED`, mensaje fijo) */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Reinicio no disponible por configuración (`MFA_RESET_UNAVAILABLE`, falta la clave de servicio en el servidor) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replaceAdminStaffAssignments: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del empleado (`staff_users.id`). */
                id: components["parameters"]["StaffId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceStaffAssignmentsRequest"];
            };
        };
        responses: {
            /** @description Empleado con sus asignaciones */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminStaff"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Dejaría al sistema sin administrador activo y vinculado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Roles */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRoleList"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del rol. */
                id: components["parameters"]["RoleId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rol */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRole"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replaceAdminRolePermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del rol. */
                id: components["parameters"]["RoleId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceRolePermissionsRequest"];
            };
        };
        responses: {
            /** @description Rol actualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRole"];
                };
            };
            /** @description Datos o parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o está fuera del alcance del empleado (no se distingue) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description El rol es del sistema y no es editable */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Permisos por módulo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPermissionCatalog"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sin el permiso requerido, sesión no aal2 o regla anti-escalada (mensaje genérico; el motivo queda en auditoría) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getBranchHours: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Horario público */
            200: {
                headers: {
                    /** @description public, max-age=60, s-maxage=300, stale-while-revalidate=600 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicBranchHours"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no está activa */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getBranchAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disponibilidad */
            200: {
                headers: {
                    /** @description public, max-age=N, s-maxage=N con N = min(10, segundos enteros hasta nextTransitionAt); `no-store` si faltan menos de 1 s. Nunca stale-while-revalidate. */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchAvailability"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o no está activa */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminBranchHours: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Horario con versión */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchHours"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replaceAdminBranchHours: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceBranchHoursRequest"];
            };
        };
        responses: {
            /** @description Horario guardado (o ya vigente) con su nueva versión */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchHours"];
                };
            };
            /** @description Forma de la solicitud inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_hours` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `HOURS_VERSION_CONFLICT` (el horario cambió desde que se leyó; recargar y reintentar) o `BRANCH_SCHEDULE_BUSY` (la sucursal está siendo modificada: lock timeout; reintentable, sin detalle interno). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `SCHEDULE_INVALID`. Reglas de horario violadas (ver `violations`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminBranchClosures: {
        parameters: {
            query?: {
                status?: "current" | "upcoming" | "active" | "past" | "all";
                /** @description Instante ISO 8601 con zona (Z u offset). Requiere `to` mayor si ambos se envían. */
                from?: string;
                /** @description Instante ISO 8601 con zona (Z u offset). */
                to?: string;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de cierres */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchClosureList"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminBranchClosure: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBranchClosureRequest"];
            };
        };
        responses: {
            /** @description Cierre creado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchClosure"];
                };
            };
            /** @description Forma de la solicitud inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_hours` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CLOSURE_OVERLAP` (se solapa con otro cierre; el cierre en conflicto va en `violations[0].path` como `closures/<id>`) o `BRANCH_SCHEDULE_BUSY` (lock timeout; reintentable). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CLOSURE_RANGE_INVALID` (rango, duración, horizonte, retroactividad `STARTS_TOO_EARLY` o cierre ya terminado) o `CLOSURE_LIMIT_REACHED` (más de 100 cierres vigentes o futuros en la sucursal). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteAdminBranchClosure: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
                /** @description UUID del cierre extraordinario (`branch_closures.id`). */
                closureId: components["parameters"]["ClosureId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cierre eliminado */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Identificador no UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_hours` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sucursal o cierre inexistente o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CLOSURE_NOT_DELETABLE` (el cierre ya comenzó o terminó) o `BRANCH_SCHEDULE_BUSY` (lock timeout; reintentable). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBranchClosure: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
                /** @description UUID del cierre extraordinario (`branch_closures.id`). */
                closureId: components["parameters"]["ClosureId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranchClosureRequest"];
            };
        };
        responses: {
            /** @description Cierre actualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchClosure"];
                };
            };
            /** @description Forma de la solicitud inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_hours` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sucursal o cierre inexistente o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CLOSURE_NOT_EDITABLE` (terminado, o cambio no permitido en curso), `CLOSURE_OVERLAP` o `BRANCH_SCHEDULE_BUSY` (lock timeout; reintentable). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CLOSURE_RANGE_INVALID`. Rango o duración inválidos. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listLocationDepartments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Lista completa de departamentos */
            200: {
                headers: {
                    /** @description public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DepartmentListResponse"];
                };
            };
        };
    };
    listLocationMunicipalities: {
        parameters: {
            query: {
                departmentId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Municipios del departamento */
            200: {
                headers: {
                    /** @description public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MunicipalityListResponse"];
                };
            };
            /** @description `departmentId` ausente o no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DEPARTMENT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminDeliveryZones: {
        parameters: {
            query?: {
                branchId?: string;
                departmentId?: string;
                municipalityId?: string;
                /** @description Sin valor = todas. */
                active?: boolean;
                /** @description Busca en la etiqueta de zona. Máx. 60 caracteres. */
                q?: string;
                sort?: "municipality" | "baseFee" | "createdAt";
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de zonas */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryZonePage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `branchId` inexistente o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminDeliveryZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateDeliveryZoneRequest"];
            };
        };
        responses: {
            /** @description Zona creada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryZone"];
                };
            };
            /** @description Forma inválida (UUID, `baseFee` no decimal/negativo/fuera de rango, `zoneLabel` demasiado larga o con caracteres de control) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_delivery_zones` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Sucursal inexistente o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_ZONE_DUPLICATE` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MUNICIPALITY_NOT_FOUND` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminDeliveryZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la zona de entrega (`delivery_zones.id`). */
                id: components["parameters"]["DeliveryZoneId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zona */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryZone"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminDeliveryZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la zona de entrega (`delivery_zones.id`). */
                id: components["parameters"]["DeliveryZoneId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateDeliveryZoneRequest"];
            };
        };
        responses: {
            /** @description Zona actualizada (o sin cambios) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryZone"];
                };
            };
            /** @description Forma inválida o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_delivery_zones` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_ZONE_VERSION_CONFLICT` o `DELIVERY_ZONE_DUPLICATE` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminDeliveryZoneStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la zona de entrega (`delivery_zones.id`). */
                id: components["parameters"]["DeliveryZoneId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateDeliveryZoneStatusRequest"];
            };
        };
        responses: {
            /** @description Zona con su estado actual */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryZone"];
                };
            };
            /** @description Forma inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_delivery_zones` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminBranchDeliverySettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuración vigente o por defecto */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchDeliverySettings"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `branches.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBranchDeliverySettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranchDeliverySettingsRequest"];
            };
        };
        responses: {
            /** @description Configuración resultante */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchDeliverySettings"];
                };
            };
            /** @description Forma inválida, sin campos o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `branches.manage_delivery_zones` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    checkDeliveryCoverage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeliveryCoverageCheckRequest"];
            };
        };
        responses: {
            /** @description Cobertura por proveedor y resumen de elegibilidad */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliveryCoverageCheckResponse"];
                };
            };
            /** @description Forma inválida (UUID, `zone` demasiado larga, propiedades desconocidas como `fee`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_AVAILABLE` o `MUNICIPALITY_NOT_FOUND` (ver `code` y `violations`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (30 por minuto en esta ruta). `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    quoteCheckout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CheckoutQuoteRequest"];
            };
        };
        responses: {
            /** @description Cotización calculada (puede traer `blockers`; `canProceed=false` NO es un error HTTP) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutQuote"];
                };
            };
            /** @description Forma inválida (UUID, cantidades, propiedades desconocidas como `price`, `fee` o `total`, combinación incoherente de `fulfillment`) o topes superados (`QUOTE_LIMITS_EXCEEDED`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token presente e inválido, o `customerAddressId` sin sesión */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Dirección guardada inexistente o ajena (misma respuesta; sin enumeración) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_AVAILABLE` (sucursal inexistente o inactiva) o `MUNICIPALITY_NOT_FOUND` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (y por cliente si hay sesión) más estricto con `couponCode`. `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CHECKOUT_BUSY`: el semáforo de lecturas se agotó o no hubo conexión; reintentable. `Cache-Control: no-store`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description Clave de idempotencia del intento (UUID v4 recomendado). Se conserva y se reutiliza ante reintentos del MISMO envío; un envío distinto usa otra. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrderCreateRequest"];
            };
        };
        responses: {
            /** @description Repetición idempotente (misma clave y mismo cuerpo): el MISMO pedido ya creado. Cabecera `Idempotent-Replayed`. */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    /** @description true */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCreated"];
                };
            };
            /** @description Pedido creado (persistido) en estado `pending` */
            201: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    /** @description `/v1/orders/{id}` */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCreated"];
                };
            };
            /** @description Forma inválida, `Idempotency-Key` ausente o malformada (`IDEMPOTENCY_KEY_INVALID`), campos de importe, contacto/teléfono/correo inválido, notas > 280, topes de F19 (`QUOTE_LIMITS_EXCEEDED`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token presente e inválido, o `customerAddressId` sin sesión */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Dirección guardada inexistente o ajena (misma respuesta; sin enumeración) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description `QUOTE_CHANGED` (cuerpo `OrderQuoteConflict`: cambios y cotización nueva), `QUOTE_EXPIRED` (cuerpo `OrderQuoteConflict` con cotización nueva),
             *     `IDEMPOTENCY_KEY_REUSED` (misma clave, cuerpo distinto) o `IDEMPOTENCY_IN_PROGRESS` (reintentar con `Retry-After`).
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderQuoteConflict"] | components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description `QUOTE_INVALID`, `CHECKOUT_BLOCKED` (cuerpo `OrderBlocked` con `blockers`), `DELIVERY_PROVIDER_NOT_SELECTABLE`, `CONTACT_INCOMPLETE`
             *     (autenticado sin teléfono en el perfil y sin `contact`), `BRANCH_NOT_AVAILABLE`, `MUNICIPALITY_NOT_FOUND`.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderBlocked"] | components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP/actor; `Retry-After`) o `PENDING_ORDERS_LIMIT` (demasiados pedidos `pending` del mismo cliente autenticado; los invitados no se bloquean por teléfono, P51/P55). `Cache-Control: no-store`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY` (semáforo de BD saturado; reintentable con la MISMA clave) u `ORDERS_UNAVAILABLE` (servidor sin secreto de cotización). `Cache-Control: no-store`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: {
                /** @description Token opaco de invitado (`smo_…`). Sin él se exige sesión del cliente dueño. */
                "X-Order-Token"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedido */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description `id` o `X-Order-Token` con formato inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token JWT presente e inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Pedido inexistente, ajeno o token inválido/vencido/revocado (respuesta idéntica) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP y actor). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`, reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getOrderTracking: {
        parameters: {
            query?: never;
            header?: {
                /** @description Token opaco de invitado (`smo_…`). Sin él se exige sesión del cliente dueño. */
                "X-Order-Token"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Seguimiento del pedido */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderTracking"];
                };
            };
            /** @description `id` o `X-Order-Token` con formato inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token JWT presente e inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Pedido inexistente, ajeno o token inválido/vencido/revocado (respuesta idéntica a `getOrder`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP y actor; contador propio de esta ruta). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`, reintentable (`Retry-After`) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getOrderReceipt: {
        parameters: {
            query?: never;
            header?: {
                /** @description Token opaco de invitado (`smo_…`). Sin él se exige sesión del cliente dueño. */
                "X-Order-Token"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Datos del recibo */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderReceipt"];
                };
            };
            /** @description `id` o `X-Order-Token` con formato inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token JWT presente e inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Pedido inexistente, ajeno o token inválido/vencido/revocado (respuesta idéntica a `getOrder`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP y actor; contador propio de esta ruta). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`, reintentable (`Retry-After`) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    previewOrderReorder: {
        parameters: {
            query?: never;
            header?: {
                /** @description Token opaco de invitado (`smo_…`). Sin él se exige sesión del cliente dueño. */
                "X-Order-Token"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["OrderReorderRequest"];
            };
        };
        responses: {
            /** @description Diagnóstico por línea y resumen (puede no haber ninguna línea agregable) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderReorderPreview"];
                };
            };
            /** @description `id`, `X-Order-Token` o cuerpo inválidos (campos desconocidos, `branchId` que no es UUID) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token JWT presente e inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Pedido inexistente, ajeno o token inválido (idéntico a `getOrder`, sin `code`) o `BRANCH_NOT_FOUND` (sucursal pedida inexistente) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (IP y actor; contador propio de esta ruta). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`, reintentable (`Retry-After`) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listStoreCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Árbol de categorías visibles */
            200: {
                headers: {
                    /** @description public, max-age=60, stale-while-revalidate=300 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicCategoryTree"];
                };
            };
        };
    };
    listAdminOrders: {
        parameters: {
            query?: {
                branchId?: string;
                /** @description Uno o varios estados separados por comas (p. ej. `pending,accepted`). */
                status?: components["schemas"]["OrderLifecycleStatus"][];
                fulfillmentType?: "PICKUP" | "DELIVERY";
                q?: string;
                /** @description Instante ISO 8601 con zona. Sin zona => 400. */
                from?: string;
                /** @description Instante ISO 8601 con zona; mayor que `from` y a lo sumo 92 días después (si no, 400). */
                to?: string;
                /** @description Cursor opaco devuelto por la página anterior (`nextCursor`). */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de pedidos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderPage"];
                };
            };
            /** @description Parámetros inválidos, rango excesivo o `ORDER_CURSOR_INVALID` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (filtro `branchId` inexistente o fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminOrderBoard: {
        parameters: {
            query?: {
                /** @description Una sucursal concreta; sin él, todas las del alcance de `orders.read`. */
                branchId?: string;
                /** @description Tarjetas por columna ACTIVA. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tablero */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderBoard"];
                };
            };
            /** @description Parámetros inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (filtro `branchId` inexistente o fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Detalle del pedido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderDetail"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: no existe o está fuera del alcance (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    acceptAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderCommandRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.accept` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rejectAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderReasonRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos; `ORDER_REASON_REQUIRED` si falta el motivo */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.reject` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    startPreparingAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderCommandRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.prepare` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    markReadyAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderCommandRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.prepare` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    completeAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderCommandRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.complete` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    cancelAdminOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOrderReasonRequest"];
            };
        };
        responses: {
            /** @description Transición aplicada (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderTransitionResult"];
                };
            };
            /** @description Identificador no UUID, cuerpo inválido o campos desconocidos; `ORDER_REASON_REQUIRED` si falta el motivo */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `orders.cancel` o la sesión no es aal2 (`MFA_REQUIRED`); `ORDER_ACTION_FORBIDDEN` si tiene el permiso pero no en la sucursal del pedido */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `orders.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT`: el estado actual ya no es `expectedStatus` (otra persona lo cambió); el cuerpo trae `current`. F28: `ORDER_HAS_ACTIVE_DELIVERY` si el pedido tiene una entrega propia `pending|assigned|picked_up` (cancela antes la entrega con `cancelAdminDelivery`; el cuerpo trae `current` del pedido) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID`: transición no permitida para el estado o la modalidad (ver `violations[].code`); el cuerpo trae `current` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminOrderPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pago del pedido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderPayment"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `payments.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: no existe o está fuera del alcance (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    registerAdminOrderCashPayment: {
        parameters: {
            query?: never;
            header: {
                /** @description Clave de idempotencia del intento (UUID v4 recomendado). Se reutiliza ante reintentos del MISMO envío (modal abierto con el mismo importe); un intento nuevo usa otra. Solo se guarda su hash. */
                "Idempotency-Key": string;
            };
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminCashPaymentRequest"];
            };
        };
        responses: {
            /** @description Repetición idempotente (misma clave y mismo cuerpo): la recepción original. Cabecera `Idempotent-Replayed`. */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    /** @description true */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCashPaymentResult"];
                };
            };
            /** @description Recepción registrada y persistida; el pago pasó a `PAID` */
            201: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCashPaymentResult"];
                };
            };
            /** @description Identificador o cuerpo inválido, campos desconocidos, `Idempotency-Key` ausente o malformada (`IDEMPOTENCY_KEY_INVALID`), `PAYMENT_AMOUNT_INVALID` (formato, > 2 decimales, cero o negativo) o `PAYMENT_CONFIRMATION_REQUIRED` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `payments.confirm` o la sesión no es aal2 (`MFA_REQUIRED`); `PAYMENT_ACTION_FORBIDDEN` si ve el pedido pero no tiene el permiso en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o está fuera del alcance (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PAYMENT_ALREADY_REGISTERED` y `ORDER_NOT_PAYABLE` (cuerpo `AdminPaymentConflict` con `current`) o `IDEMPOTENCY_KEY_REUSED` (misma clave, cuerpo distinto; `ErrorResponse`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPaymentConflict"] | components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CASH_AMOUNT_INSUFFICIENT` (efectivo menor al total), `CASH_TENDERED_TOO_LARGE` o `PAYMENT_NOT_COLLECTABLE` (`violations[].code`: `PROVIDER_BLOCKED_EXTERNAL`, `LEGACY_PAYMENT_METHOD`, `AMOUNT_ZERO`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable con la MISMA clave (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminOrderPaymentHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del pedido (`orders.id`). */
                id: components["parameters"]["AdminOrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Historial del pago */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPaymentHistory"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `payments.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: no existe o está fuera del alcance (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminRiders: {
        parameters: {
            query?: {
                /** @description Busca por nombre (contiene; sin distinguir mayúsculas ni acentos). Máx. 80 caracteres. NO busca por teléfono ni placa. */
                q?: string;
                /** @description Sucursal exacta. Fuera de alcance o inexistente => página vacía (no se distingue). */
                branchId?: string;
                /** @description Estado administrativo. Sin valor = todos. */
                active?: boolean;
                /** @description Estado operativo derivado. `AVAILABLE` = activo + disponible + sin entrega activa; `UNAVAILABLE` = marcado no disponible; `BUSY` = activo con entrega activa real (F28; mientras `busyKnown=false` no hay ocupados). Sin valor = todos. */
                availability?: components["schemas"]["RiderAvailabilityFilter"];
                /** @description Campo de orden (desempate por `id`). */
                sort?: "fullName" | "createdAt" | "updatedAt";
                /** @description Sentido. */
                order?: "asc" | "desc";
                /** @description Página. */
                page?: number;
                /** @description Tamaño de página. */
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de motoristas */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRiderPage"];
                };
            };
            /** @description Forma o parámetros inválidos (`details` por campo) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `riders.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminRider: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRiderRequest"];
            };
        };
        responses: {
            /** @description Motorista creado */
            201: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRider"];
                };
            };
            /** @description Forma o parámetros inválidos (`details` por campo) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `riders.create` en esa sucursal (`RIDER_ACTION_FORBIDDEN`), no es personal activo o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_PHONE_TAKEN`: ya existe un motorista (activo o no) con ese teléfono */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_AVAILABLE`: la sucursal no existe o está inactiva */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminRider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del motorista (`riders.id`). */
                id: components["parameters"]["RiderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Motorista */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRider"];
                };
            };
            /** @description El identificador no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `riders.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_NOT_FOUND`: no existe o está fuera del alcance de `riders.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminRider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del motorista (`riders.id`). */
                id: components["parameters"]["RiderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRiderRequest"];
            };
        };
        responses: {
            /** @description Motorista actualizado */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRider"];
                };
            };
            /** @description Forma inválida, `expectedVersion` ausente, cuerpo sin campos o campos no permitidos (`active`, `availability`, desconocidos) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `riders.update` (en origen o destino: `RIDER_ACTION_FORBIDDEN`), no es personal activo o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_NOT_FOUND`: no existe o está fuera del alcance de `riders.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_VERSION_CONFLICT`, `RIDER_PHONE_TAKEN` o `RIDER_HAS_ACTIVE_DELIVERY` (traslado con entrega activa) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_AVAILABLE`: la sucursal destino no existe o está inactiva */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminRiderStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del motorista (`riders.id`). */
                id: components["parameters"]["RiderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRiderStatusRequest"];
            };
        };
        responses: {
            /** @description Motorista con su estado actual */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRider"];
                };
            };
            /** @description Forma o parámetros inválidos (`details` por campo) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `riders.update` (`RIDER_ACTION_FORBIDDEN`), no es personal activo o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_NOT_FOUND`: no existe o está fuera del alcance de `riders.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_HAS_ACTIVE_DELIVERY`: tiene una entrega activa (F28) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminRiderAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del motorista (`riders.id`). */
                id: components["parameters"]["RiderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRiderAvailabilityRequest"];
            };
        };
        responses: {
            /** @description Motorista con su disponibilidad actual */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminRider"];
                };
            };
            /** @description Forma inválida (p. ej. `BUSY` o valor desconocido) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `riders.update` (`RIDER_ACTION_FORBIDDEN`), no es personal activo o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_NOT_FOUND`: no existe o está fuera del alcance de `riders.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDER_INACTIVE` (marcar disponible a un inactivo) o `RIDER_HAS_ACTIVE_DELIVERY` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RIDERS_BUSY`: base de datos saturada; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminCategories: {
        parameters: {
            query?: {
                /** @description Sin valor = todas. */
                active?: boolean;
                /** @description Solo hijos directos de esa categoría. Inexistente => lista vacía. */
                parentId?: string;
                /** @description Busca por nombre o slug (contiene; sin distinguir mayúsculas ni acentos). Máx. 80 caracteres. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Categorías */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCategoryList"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminCategory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCategoryRequest"];
            };
        };
        responses: {
            /** @description Categoría creada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCategory"];
                };
            };
            /** @description Forma inválida (nombre vacío/largo, slug no kebab, UUID, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `catalog.create` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORY_SLUG_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORY_PARENT_INVALID`, `CATEGORY_DEPTH_EXCEEDED` o `CATEGORY_LIMIT_REACHED` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORIES_BUSY`: otra modificación de categorías está en curso o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reorderAdminCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderCategoriesRequest"];
            };
        };
        responses: {
            /** @description Hermanos con su nuevo orden */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCategoryList"];
                };
            };
            /** @description Forma inválida (UUID mal formado, más de 500 elementos, propiedades desconocidas). Los duplicados o ajenos son 422 `CATEGORY_REORDER_MISMATCH` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `parentId` inexistente */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORY_REORDER_MISMATCH` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORIES_BUSY`: otra modificación de categorías está en curso o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la categoría (`categories.id`). */
                id: components["parameters"]["CategoryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCategoryRequest"];
            };
        };
        responses: {
            /** @description Categoría actualizada (o sin cambios) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCategory"];
                };
            };
            /** @description Forma inválida, cuerpo vacío o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description La categoría no existe */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORY_SLUG_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORY_CYCLE`, `CATEGORY_DEPTH_EXCEEDED` o `CATEGORY_PARENT_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `CATEGORIES_BUSY`: otra modificación de categorías está en curso o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listStoreProducts: {
        parameters: {
            query?: {
                /** @description Slug de una categoría visible (incluye sus descendientes visibles). */
                categorySlug?: string;
                /** @description Texto a buscar en nombre o descripción (no en SKU). Máx. 80 caracteres. */
                q?: string;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de productos visibles */
            200: {
                headers: {
                    /** @description public, max-age=60, stale-while-revalidate=300 */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProductPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getStoreProduct: {
        parameters: {
            query?: {
                /** @description UUID de una sucursal ACTIVA. Añade `offer`, `promotions`, `generatedAt` y `nextChangeAt`. */
                branchId?: string;
            };
            header?: never;
            path: {
                /** @description Slug público del producto (`products.slug`). */
                slug: components["parameters"]["ProductSlug"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ficha del producto */
            200: {
                headers: {
                    /** @description Sin `branchId`: public, max-age=60, stale-while-revalidate=300. Con `branchId`: public, max-age=min(N,5), s-maxage=N con 1 <= N <= 15 (o no-store) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProductDetail"];
                };
            };
            /** @description Slug o `branchId` con forma inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND`: inexistente, inactivo o con categoría no visible; `BRANCH_NOT_FOUND`: se envió `branchId` y no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminProducts: {
        parameters: {
            query?: {
                q?: string;
                /** @description Inexistente => lista vacía. */
                categoryId?: string;
                /** @description Sin valor = todos. */
                active?: boolean;
                sort?: "name" | "basePrice" | "createdAt";
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de productos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProductRequest"];
            };
        };
        responses: {
            /** @description Producto creado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProduct"];
                };
            };
            /** @description Forma inválida (nombre, precio, slug, sku, UUID, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `catalog.create` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_SLUG_TAKEN` o `PRODUCT_SKU_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_CATEGORY_INVALID` o `PRODUCT_MEDIA_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Producto */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProduct"];
                };
            };
            /** @description UUID inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProductRequest"];
            };
        };
        responses: {
            /** @description Producto actualizado (o sin cambios) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProduct"];
                };
            };
            /** @description Forma inválida, cuerpo vacío o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_SLUG_TAKEN` o `PRODUCT_SKU_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_CATEGORY_INVALID` o `PRODUCT_MEDIA_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminModifierGroups: {
        parameters: {
            query?: {
                q?: string;
                /** @description Sin valor = todos. */
                active?: boolean;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de grupos (resumen) */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifierGroupPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminModifierGroup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateModifierGroupRequest"];
            };
        };
        responses: {
            /** @description Grupo creado (con opciones) */
            201: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifierGroup"];
                };
            };
            /** @description Forma inválida (nombre, tipos, UUID, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.create` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NAME_TAKEN` o `MODIFIER_NAME_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_LIMITS_INVALID` o `MODIFIER_LIMIT_REACHED` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminModifierGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del grupo de modificadores (`modifier_groups.id`). */
                id: components["parameters"]["ModifierGroupId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grupo con opciones */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifierGroup"];
                };
            };
            /** @description UUID inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminModifierGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del grupo de modificadores (`modifier_groups.id`). */
                id: components["parameters"]["ModifierGroupId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateModifierGroupRequest"];
            };
        };
        responses: {
            /** @description Grupo actualizado (o sin cambios) */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifierGroup"];
                };
            };
            /** @description Forma inválida, cuerpo vacío o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NAME_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_LIMITS_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminModifier: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del grupo de modificadores (`modifier_groups.id`). */
                id: components["parameters"]["ModifierGroupId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateModifierRequest"];
            };
        };
        responses: {
            /** @description Opción creada */
            201: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifier"];
                };
            };
            /** @description Forma inválida (nombre, precio, UUID, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.create` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_NAME_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_LIMIT_REACHED` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reorderAdminModifiers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del grupo de modificadores (`modifier_groups.id`). */
                id: components["parameters"]["ModifierGroupId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderModifiersRequest"];
            };
        };
        responses: {
            /** @description Opciones con su nuevo orden */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifierList"];
                };
            };
            /** @description Forma inválida (UUID mal formado, más de 30 elementos, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_REORDER_MISMATCH` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminModifier: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la opción (`modifiers.id`). */
                id: components["parameters"]["ModifierId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateModifierRequest"];
            };
        };
        responses: {
            /** @description Opción actualizada (o sin cambios) */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminModifier"];
                };
            };
            /** @description Forma inválida, cuerpo vacío o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_NAME_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_UNSATISFIABLE` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminProductModifiers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grupos del producto */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductModifiers"];
                };
            };
            /** @description UUID inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replaceAdminProductModifierGroups: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceProductModifierGroupsRequest"];
            };
        };
        responses: {
            /** @description Grupos del producto tras el reemplazo */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductModifiers"];
                };
            };
            /** @description Forma inválida (UUID mal formado, más de 50 elementos, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` con alcance global o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIER_GROUP_INVALID` o `MODIFIER_LIMIT_REACHED` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MODIFIERS_BUSY`: bloqueo no disponible o la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getStoreBootstrap: {
        parameters: {
            query?: {
                /** @description UUID de una sucursal ACTIVA. Sin él, agregado sin sucursal. */
                branchId?: string;
                locale?: components["schemas"]["BannerLocale"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Agregado del Inicio */
            200: {
                headers: {
                    /** @description public, max-age=min(N,5), s-maxage=N con 1 <= N <= 15 (o no-store; con `degraded`: public, max-age=0, s-maxage=3) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreBootstrap"];
                };
            };
            /** @description `branchId` mal formado o `locale` fuera de `es|en` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: se envió `branchId` y no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (60 por minuto). `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `STORE_BUSY`: una lectura crítica agotó su tiempo o no hubo conexión; reintentable. `Cache-Control: no-store`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    searchStoreProducts: {
        parameters: {
            query: {
                /** @description Texto a buscar. 2 a 80 caracteres tras recortar; si queda < 2 => 400. */
                q: string;
                /** @description UUID de una sucursal ACTIVA. Fija el precio efectivo, la disponibilidad y las promociones. */
                branchId?: string;
                /** @description Slug de una categoría visible (incluye descendientes visibles). */
                categorySlug?: string;
                /** @description `true` = solo disponibles en la sucursal (exige `branchId`). Sin valor = todos. */
                available?: boolean;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de resultados (puede estar vacía) */
            200: {
                headers: {
                    /** @description public, max-age=min(N,5), s-maxage=N con 1 <= N <= 15 (o no-store) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreSearchPage"];
                };
            };
            /** @description `q` ausente o de longitud inválida, `branchId` mal formado, `available=true` sin `branchId` o paginación fuera de rango */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: se envió `branchId` y no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (30 por minuto en esta ruta). `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `STORE_BUSY`: la lectura agotó su tiempo o no hubo conexión; reintentable. `Cache-Control: no-store`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getStoreBranchMenu: {
        parameters: {
            query?: {
                /** @description UUID de una sucursal activa. Sin él, precios base y `available=null`. */
                branchId?: string;
                /** @description Slug de una categoría visible (incluye descendientes visibles). */
                categorySlug?: string;
                /** @description `true` = solo disponibles en la sucursal (exige `branchId`; sin él => 400). Sin valor = todos. */
                available?: boolean;
                /** @description `menu` (por defecto) = orden del árbol de categorías, luego `name`, `id`; `name`; `price` (precio efectivo). `id` desempata siempre. */
                sort?: "menu" | "name" | "price";
                /** @description Dirección para `name` y `price`; se ignora con `sort=menu`. */
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de tarjetas del menú */
            200: {
                headers: {
                    /** @description public, max-age=min(N,5), s-maxage=N con 1 <= N <= 15 (o no-store) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreBranchMenu"];
                };
            };
            /** @description `branchId` mal formado, `available=true` sin `branchId`, `sort`/`order`/paginación fuera de rango */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: se envió `branchId` y no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (60 por minuto). `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `STORE_BUSY`: la lectura agotó su tiempo o no hubo conexión; reintentable. `Cache-Control: no-store`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminBranchProducts: {
        parameters: {
            query?: {
                q?: string;
                /** @description Inexistente => lista vacía. */
                categoryId?: string;
                /** @description Sin valor = todos. */
                available?: boolean;
                /** @description `true` = solo con precio de sucursal; `false` = solo sin override. Sin valor = todos. */
                hasOverride?: boolean;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de la matriz */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranchProductPage"];
                };
            };
            /** @description Parámetros de consulta o UUID inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: no existe o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminProductBranches: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucursales del alcance con su estado */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductBranches"];
                };
            };
            /** @description UUID inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    setAdminBranchProductPricing: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la sucursal. */
                id: components["parameters"]["BranchId"];
                /** @description UUID del producto (`products.id`) cuyo precio de sucursal se gestiona (F13). */
                productId: components["parameters"]["BranchProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetBranchProductPricingRequest"];
            };
        };
        responses: {
            /** @description Estado del producto en la sucursal tras la operación */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranchProductState"];
                };
            };
            /** @description Forma inválida (UUID mal formado, precio no cadena o fuera de forma/rango de formato, propiedades desconocidas, falta `priceOverride`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (inexistente o fuera de alcance) o `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_PRICE_INVALID`: cadena bien formada pero <= 0 (con `violations[0].path = priceOverride`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_PRODUCTS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    setAdminProductAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetProductAvailabilityRequest"];
            };
        };
        responses: {
            /** @description Estado del producto en la sucursal tras la operación */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBranchProductState"];
                };
            };
            /** @description Forma inválida (UUID mal formado, `available` no booleano, propiedades desconocidas o faltantes) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.manage_availability` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (inexistente o fuera de alcance) o `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_PRODUCTS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminMediaUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMediaUploadIntentRequest"];
            };
        };
        responses: {
            /** @description Deduplicado: ya existe un asset READY con el mismo contenido; no hay URL de subida */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaUploadIntent"];
                };
            };
            /** @description Intent creado; el asset queda PENDING */
            201: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaUploadIntent"];
                };
            };
            /** @description Forma inválida (`kind` fuera del enum, `sizeBytes` no entero o < 1, `checksumSha256` fuera de forma, propiedades desconocidas o faltantes) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE` o `MEDIA_PENDING_LIMIT_REACHED` (con `violations`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_STORAGE_UNAVAILABLE` (R2 sin configurar o inaccesible) o `MEDIA_BUSY` (la transacción agotó su tiempo; reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    completeAdminMediaUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteMediaUploadRequest"];
            };
        };
        responses: {
            /** @description Asset READY con su URL pública */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaAsset"];
                };
            };
            /** @description Forma inválida (`assetId` no es UUID, propiedades desconocidas o faltantes) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_UPLOAD_EXPIRED`: el intent PENDING caducó */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_OBJECT_MISSING` o `MEDIA_CONTENT_MISMATCH` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_STORAGE_UNAVAILABLE` o `MEDIA_BUSY` (reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminMedia: {
        parameters: {
            query?: {
                kind?: components["schemas"]["MediaKind"];
                status?: components["schemas"]["MediaStatus"];
                /** @description `true` = solo assets que ningún producto NI banner usa (candidatos a borrar); `false` = solo los usados por algún producto o banner; sin valor = todos. */
                unreferenced?: boolean;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de assets */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaAssetPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del asset de medios (`media_assets.id`, F14). */
                id: components["parameters"]["MediaAssetId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Asset con sus usos */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminMediaAssetDetail"];
                };
            };
            /** @description `id` no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.read` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteAdminMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del asset de medios (`media_assets.id`, F14). */
                id: components["parameters"]["MediaAssetId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Asset eliminado. Sin cuerpo. */
            204: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `id` no es un UUID */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_IN_USE`: algún producto lo referencia */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_STORAGE_UNAVAILABLE` o `MEDIA_BUSY` (reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    attachAdminProductMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttachProductMediaRequest"];
            };
        };
        responses: {
            /** @description Imagen adjuntada */
            201: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductMedia"];
                };
            };
            /** @description Forma inválida (UUID mal formado, propiedades desconocidas o `assetId` ausente) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` o `MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_ALREADY_ATTACHED` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_ASSET_NOT_READY` o `PRODUCT_MEDIA_INVALID` (más de 8 imágenes o `altText` inválido) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reorderAdminProductMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderProductMediaRequest"];
            };
        };
        responses: {
            /** @description Imágenes con su nuevo orden */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductMediaList"];
                };
            };
            /** @description Forma inválida (UUID mal formado, más de 8 elementos, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `MEDIA_REORDER_MISMATCH` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY` (reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    detachAdminProductMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
                /** @description UUID de la fila de imagen del producto (`product_media.id`, F14). */
                mediaId: components["parameters"]["ProductMediaId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Imagen desvinculada. Sin cuerpo. */
            204: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description UUID mal formado */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` o `PRODUCT_MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY` (reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminProductMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del producto (`products.id`). */
                id: components["parameters"]["ProductId"];
                /** @description UUID de la fila de imagen del producto (`product_media.id`, F14). */
                mediaId: components["parameters"]["ProductMediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProductMediaRequest"];
            };
        };
        responses: {
            /** @description Imagen actualizada */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProductMedia"];
                };
            };
            /** @description Forma inválida (UUID mal formado, propiedades desconocidas o `altText` ausente) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `catalog.update` (con alcance global si es escritura) o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_NOT_FOUND` o `PRODUCT_MEDIA_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCT_MEDIA_INVALID` (`altText` > 200) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PRODUCTS_BUSY` (reintentable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listStorePromotions: {
        parameters: {
            query: {
                /** @description UUID de una sucursal activa. */
                branchId: string;
                /** @description `live` (por defecto) o `upcoming`. */
                state?: "live" | "upcoming";
                /** @description F17 (aditivo). `true` = sin `items` ni `productIds` (no lee productos): para banners como el de Happy Hour del menú. Sin valor o `false` = respuesta completa de F15. */
                compact?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Promociones de la sucursal */
            200: {
                headers: {
                    /** @description public, max-age=min(N,5), s-maxage=N con 1 <= N <= 30 (o no-store) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorePromotionList"];
                };
            };
            /** @description `branchId` ausente o mal formado, o `state` desconocido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED`: límite por IP (60 por minuto). `Cache-Control: no-store` y `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminPromotions: {
        parameters: {
            query?: {
                branchId?: string;
                status?: "active" | "inactive" | "scheduled" | "running" | "expired";
                kind?: components["schemas"]["PromotionKind"];
                /** @description Instante ISO 8601 con zona (`Z` u offset). Sin zona => 400. */
                from?: string;
                /** @description Instante ISO 8601 con zona; debe ser mayor que `from` (si no, 400). */
                to?: string;
                q?: string;
                sort?: "startsAt" | "endsAt" | "name" | "createdAt";
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de promociones */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPromotionPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `promotions.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (filtro `branchId` inexistente o fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminPromotion: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePromotionRequest"];
            };
        };
        responses: {
            /** @description Promoción creada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPromotion"];
                };
            };
            /** @description Forma inválida, campos desconocidos o faltantes */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `promotions.create`, la sesión no es aal2 o `PROMOTION_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (alguna sucursal no existe o está fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_CODE_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_VALUE_INVALID`, `PROMOTION_PERIOD_INVALID`, `PROMOTION_SCHEDULE_INVALID` o `PROMOTION_SCOPE_INVALID` (ver `code` y `violations`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTIONS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminPromotion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la promoción (`promotions.id`). */
                id: components["parameters"]["PromotionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Promoción */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPromotion"];
                };
            };
            /** @description UUID inválido */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `promotions.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminPromotion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la promoción (`promotions.id`). */
                id: components["parameters"]["PromotionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePromotionRequest"];
            };
        };
        responses: {
            /** @description Promoción actualizada (o sin cambios) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPromotion"];
                };
            };
            /** @description Forma inválida, `expectedVersion` ausente, cuerpo sin campos o campos no permitidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `promotions.update`, la sesión no es aal2 o `PROMOTION_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_NOT_FOUND` o `BRANCH_NOT_FOUND` (sucursal nueva inexistente o fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_VERSION_CONFLICT` o `PROMOTION_CODE_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_VALUE_INVALID`, `PROMOTION_PERIOD_INVALID`, `PROMOTION_SCHEDULE_INVALID` o `PROMOTION_SCOPE_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTIONS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminPromotionStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la promoción (`promotions.id`). */
                id: components["parameters"]["PromotionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePromotionStatusRequest"];
            };
        };
        responses: {
            /** @description Promoción con su estado actual */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminPromotion"];
                };
            };
            /** @description Forma inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `promotions.update`, la sesión no es aal2 o `PROMOTION_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTION_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `PROMOTIONS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listStoreBanners: {
        parameters: {
            query?: {
                /** @description UUID de una sucursal ACTIVA. Sin él, solo banners de todas las sucursales. */
                branchId?: string;
                locale?: components["schemas"]["BannerLocale"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Banners publicados (puede ser una lista vacía) */
            200: {
                headers: {
                    /** @description public, max-age=min(N,5), s-maxage=N con 1 <= N <= 30 (o no-store) */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreBannerList"];
                };
            };
            /** @description `branchId` mal formado o `locale` fuera de `es|en` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: se envió `branchId` y no existe o está inactiva */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (por actor en escrituras; por IP en la ruta pública). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNERS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminBanners: {
        parameters: {
            query?: {
                branchId?: string;
                lifecycle?: components["schemas"]["BannerLifecycle"];
                q?: string;
                sort?: "priority" | "startsAt" | "endsAt" | "createdAt";
                /** @description Por defecto `asc`, también con `sort=startsAt|endsAt|createdAt` (los nulos van al final). */
                order?: "asc" | "desc";
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de banners */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBannerPage"];
                };
            };
            /** @description Parámetros de consulta inválidos */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `banners.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (filtro `branchId` inexistente o fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminBanner: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBannerRequest"];
            };
        };
        responses: {
            /** @description Banner creado */
            201: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBanner"];
                };
            };
            /** @description Forma inválida, campos desconocidos o faltantes (incluye `ALL` con `branchIds` mal formados) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `banners.create`, la sesión no es aal2 o `BANNER_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND` (alguna sucursal no existe o está fuera de alcance) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_CODE_TAKEN` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_IMAGE_INVALID`, `BANNER_TRANSLATION_INVALID`, `BANNER_CTA_INVALID`, `BANNER_PERIOD_INVALID`, `BANNER_SCOPE_INVALID`, `BANNER_PROMOTION_INVALID` o `BANNER_LIMIT_REACHED` (ver `code` y `violations`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (por actor en escrituras; por IP en la ruta pública). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNERS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reorderAdminBanners: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderBannersRequest"];
            };
        };
        responses: {
            /** @description Orden resultante de los banners reordenados */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBannerOrder"];
                };
            };
            /** @description Forma inválida (UUID mal formado, más de 100 elementos, propiedades desconocidas) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `banners.update` con alcance global, la sesión no es aal2 o `BANNER_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_REORDER_MISMATCH` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (por actor en escrituras; por IP en la ruta pública). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNERS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminBanner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del banner (`banners.id`). */
                id: components["parameters"]["BannerId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Banner */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBanner"];
                };
            };
            /** @description UUID mal formado */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `banners.read` o la sesión no es aal2 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBanner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del banner (`banners.id`). */
                id: components["parameters"]["BannerId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBannerRequest"];
            };
        };
        responses: {
            /** @description Banner actualizado (o sin cambios) */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBanner"];
                };
            };
            /** @description Forma inválida, campos desconocidos (`code`, `active`) o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `banners.update`, la sesión no es aal2 o `BANNER_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_NOT_FOUND` o `BRANCH_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_VERSION_CONFLICT` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_IMAGE_INVALID`, `BANNER_TRANSLATION_INVALID`, `BANNER_CTA_INVALID`, `BANNER_PERIOD_INVALID`, `BANNER_SCOPE_INVALID` o `BANNER_PROMOTION_INVALID` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (por actor en escrituras; por IP en la ruta pública). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNERS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAdminBannerStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID del banner (`banners.id`). */
                id: components["parameters"]["BannerId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBannerStatusRequest"];
            };
        };
        responses: {
            /** @description Banner con su estado */
            200: {
                headers: {
                    /** @description no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminBanner"];
                };
            };
            /** @description Forma inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Falta `banners.update`, la sesión no es aal2 o `BANNER_SCOPE_FORBIDDEN` */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNER_NOT_FOUND` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` (por actor en escrituras; por IP en la ruta pública). `Retry-After`. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BANNERS_BUSY`: la transacción agotó su tiempo; reintentable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAdminDeliveries: {
        parameters: {
            query?: {
                branchId?: string;
                /** @description Uno o varios estados separados por comas (p. ej. `assigned,picked_up`). Por defecto los abiertos. */
                status?: components["schemas"]["AdminDeliveryStatus"][];
                /** @description UUID del motorista. Inexistente o fuera de alcance => lista vacía (no distingue). */
                riderId?: string;
                /** @description Instante ISO 8601 con zona. Sin zona => 400. */
                from?: string;
                /** @description Instante ISO 8601 con zona; mayor que `from` y a lo sumo 92 días después (si no, 400). */
                to?: string;
                /** @description Cursor opaco devuelto por la página anterior (`nextCursor`). */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página de entregas */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryPage"];
                };
            };
            /** @description Parámetros inválidos, rango excesivo o `DELIVERY_CURSOR_INVALID` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `deliveries.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `BRANCH_NOT_FOUND`: filtro `branchId` inexistente o fuera de alcance */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createAdminDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAdminDeliveryRequest"];
            };
        };
        responses: {
            /** @description Entrega creada o reabierta (`200` con `transition.replayed=true` si ya existía abierta) */
            201: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `deliveries.assign` o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve el pedido pero no tiene el permiso en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_NOT_FOUND`: el pedido no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `ORDER_STATE_CONFLICT` (el pedido cambió entre la lectura y la escritura) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `DELIVERY_ORDER_NOT_ELIGIBLE`: el pedido no es DELIVERY `OWN` en `accepted|preparing|ready` (ver `violations[].code`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAdminDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Entrega */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDelivery"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta `deliveries.read` o la sesión no es aal2 (`MFA_REQUIRED`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    assignOwnRiderToAdminDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignOwnRiderRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND` (entrega inexistente o fuera de alcance) o `RIDER_NOT_FOUND` (motorista inexistente o fuera del alcance de `riders.read`); respuestas uniformes (anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `RIDER_NOT_ELIGIBLE` (motorista no elegible; ver `violations[].code`) o `DELIVERY_ORDER_NOT_ELIGIBLE` (el pedido ya no es despachable) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    unassignRiderFromAdminDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UnassignRiderRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    markAdminDeliveryPickedUp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDeliveryCommandRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID` (modalidad o proveedor del pedido incompatibles; ver `violations[].code`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    markAdminDeliveryDelivered: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDeliveryCommandRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `ORDER_TRANSITION_INVALID` (modalidad o proveedor del pedido incompatibles; ver `violations[].code`) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrderStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    returnAdminDeliveryToBranch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDeliveryCommandRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos o `expectedVersion` ausente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    cancelAdminDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description UUID de la entrega (`deliveries.id`). */
                id: components["parameters"]["DeliveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CancelAdminDeliveryRequest"];
            };
        };
        responses: {
            /** @description Entrega con su estado actual (o repetición idempotente: `transition.replayed=true`) */
            200: {
                headers: {
                    /** @description private, no-store */
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryCommandResult"];
                };
            };
            /** @description Forma inválida, identificador no UUID, campos desconocidos, `expectedVersion` ausente o `DELIVERY_REASON_REQUIRED` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Token ausente, inválido o expirado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description No es personal activo, falta el permiso o la sesión no es aal2 (`MFA_REQUIRED`); `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no tiene el permiso del comando en su sucursal */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_NOT_FOUND`: la entrega no existe o su sucursal está fuera del alcance de `deliveries.read` (misma respuesta; anti-IDOR) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERY_STATE_CONFLICT`: la entrega cambió (`expectedVersion` no coincide) o su estado no admite el comando; el cuerpo trae `current` (`status`, `version`). `ORDER_STATE_CONFLICT`: el pedido ya no está en el estado requerido (`ready` para recoger, `on_the_way` para entregar). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminDeliveryStateError"];
                };
            };
            /** @description `RATE_LIMITED` */
            429: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description `DELIVERIES_BUSY`: base de datos saturada o bloqueo agotado; reintentable (`Retry-After`) */
            503: {
                headers: {
                    /** @description Segundos sugeridos de espera. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}

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
            pendingSections: ("addresses" | "favorites" | "orders")[];
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
             *     `SCHEDULE_INVALID`, `BRANCH_SCHEDULE_BUSY`, `CLOSURE_LIMIT_REACHED`). Los clientes deben ramificar por `code`, nunca por `message`.
             */
            code?: string;
            /** @description Violaciones estructuradas de reglas de negocio (422/409 de F08). */
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
        Municipality: {
            name: string;
            /** @description Número de zonas (0 = el municipio no usa zonas). */
            zones: number;
        };
        Department: {
            department: string;
            municipalities: components["schemas"]["Municipality"][];
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
            departments: components["schemas"]["Department"][];
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
        HappyHourItem: {
            id: string;
            name: string;
            nameEn?: string;
            priceLabel: string;
            group: string;
            illustration: string;
        };
        Promotion: {
            id: string;
            name: string;
            description: string;
            /** @enum {string} */
            kind: "2x1" | "percent" | "fixed_price";
            /** @description 0 para 2x1; porcentaje; o precio especial en GTQ. */
            value: number;
            /** @description Días ISO (1 = lunes … 7 = domingo). */
            daysOfWeek: number[];
            /** @example 15:00 */
            startTime: string;
            /** @example 18:00 */
            endTime: string;
            /** Format: date */
            validFrom: string;
            /** Format: date */
            validTo: string;
            active: boolean;
            /**
             * @description Calculado con la fecha del servidor.
             * @enum {string}
             */
            status: "current" | "scheduled" | "expired" | "inactive";
            dineInOnly: boolean;
            subtitle?: components["schemas"]["LocalizedText"];
            conditions?: components["schemas"]["LocalizedText"];
            items: components["schemas"]["HappyHourItem"][];
        };
        PromotionInput: {
            name: string;
            description?: string;
            /** @enum {string} */
            kind: "2x1" | "percent" | "fixed_price";
            value: number;
            daysOfWeek: number[];
            startTime: string;
            endTime: string;
            /** Format: date */
            validFrom: string;
            /** Format: date */
            validTo: string;
            active?: boolean;
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
        Address: {
            id: string;
            /** @enum {string} */
            label: "home" | "work" | "other";
            customLabel: string;
            department: string;
            municipality: string;
            zone: string;
            line: string;
            references: string;
            /** Format: date-time */
            createdAt: string;
        };
        AddressInput: {
            /** @enum {string} */
            label: "home" | "work" | "other";
            customLabel?: string;
            department: string;
            municipality: string;
            zone: string;
            line: string;
            references?: string;
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
    };
    responses: never;
    parameters: {
        /** @description UUID del empleado (`staff_users.id`). */
        StaffId: string;
        /** @description UUID del rol. */
        RoleId: string;
        /** @description UUID de la sucursal. */
        BranchId: string;
        /** @description UUID del cierre extraordinario (`branch_closures.id`). */
        ClosureId: string;
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
}

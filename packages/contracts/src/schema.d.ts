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
         * @description F07. Exige JWT → personal activo con el permiso `branches` → `aal2`. Solo devuelve las sucursales dentro
         *     del alcance del empleado (todas, o las de sus asignaciones). Respuesta `Cache-Control: no-store`.
         */
        get: operations["listAdminBranches"];
        put?: never;
        /**
         * Crea una sucursal
         * @description F07. Alta global: solo personal con asignación a TODAS las sucursales (`allBranches`) y permiso `branches`.
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
         * @description 404 si no existe o está fuera del alcance del empleado (no se distingue). Respuesta con `Cache-Control: no-store`.
         */
        get: operations["getAdminBranch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Actualiza datos básicos de una sucursal
         * @description Campos permitidos: nombre, teléfono, dirección y coordenadas. `code`, `active` y `createdAt` NO se aceptan
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
         * @description Cambia `active`. Desactivar exige `reason`. Idempotente: si ya tiene ese estado devuelve la sucursal sin
         *     escribir ni auditar. NO cancela ni reasigna pedidos en curso, ni borra empleados, productos o repartidores
         *     (política de pedidos en curso: pendiente con F20/F22).
         */
        patch: operations["updateAdminBranchStatus"];
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
            /** @description true si alguna asignación activa no está limitada a una sucursal. */
            allBranches: boolean;
            branchIds: string[];
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
            email: string | null;
            customer: components["schemas"]["CustomerProfile"];
            isStaff: boolean;
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
        };
        LocalizedText: {
            es: string;
            en?: string;
        };
        /** @description Horario de un día (0 = domingo … 6 = sábado), hora local de Guatemala. */
        BranchHours: {
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
            weeklyHours: components["schemas"]["BranchHours"][];
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
            hours: components["schemas"]["BranchHours"][];
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
        BranchAvailability: {
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
            availability: components["schemas"]["BranchAvailability"][];
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
        StaffRole: "admin" | "manager" | "kitchen";
        /** @enum {string} */
        StaffPermission: "dashboard" | "orders.accept" | "orders.status" | "orders.dispatch" | "products.edit" | "products.availability" | "promotions" | "branches" | "users" | "reports";
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
        /** @description UUID de la sucursal. */
        BranchId: string;
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
            /** @description No es personal activo, falta el permiso `branches` o la sesión no es aal2 */
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
            /** @description No es personal activo, falta el permiso `branches` o la sesión no es aal2 */
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
}

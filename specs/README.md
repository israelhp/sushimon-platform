# Especificaciones (Spec Kit)

Cada funcionalidad importante vive en `specs/NNN-nombre/` (`spec.md`, `plan.md`, `tasks.md`) creada con `/speckit-specify`
y compañía. Las ramas de trabajo siguen Git Flow (`feature/*`), no la numeración de Spec Kit. Constitución: `.specify/memory/constitution.md`.
Cada spec debe declarar su **estado de integración** (`MOCK_ONLY … VERIFIED | BLOCKED_EXTERNAL`).

## Índice

La numeración de Spec Kit (`NNN`) **no** coincide con el identificador de feature (`FXX`) del backlog oficial (`docs/BACKLOG.md`). El estado de cada
feature lo fija el backlog tras la auditoría F00–F09 (`docs/AUDITORIA_F00_F09.md`); la columna «Spec» solo indica lo que declara su propio `spec.md`.

| Spec                              | Feature (backlog)                        | Spec (lo que declara; sin auditar)                                                                                        |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `001-ui-first-mock-platform`      | Etapa 1 UI First (transversal)           | `MOCK_ONLY`                                                                                                               |
| `002-api-foundations`             | F00 Fundamentos de API                   | ver `spec.md`                                                                                                             |
| `003-auth-supabase`               | F01 Google OAuth                         | ver `spec.md`                                                                                                             |
| `004-backoffice-mfa`              | F02 MFA TOTP                             | ver `spec.md`                                                                                                             |
| `005-branches-management`         | F07 Sucursales                           | ver `spec.md`                                                                                                             |
| `006-staff-rbac-management`       | F03 Empleados, roles y permisos          | ver `spec.md`                                                                                                             |
| `007-branch-hours-closures`       | F08 Horarios, cierres y disponibilidad   | `API_IMPLEMENTED`, fusionada en `develop` (PR #10)                                                                        |
| `008-delivery-zones-coverage`     | F09 Geografía, cobertura y zonas propias | fusionada en `develop` (PR #13); PedidosYa real: `BLOCKED_EXTERNAL`                                                       |
| `010-customer-favorites`          | F06 Favoritos de clientes                | `API_IMPLEMENTED` (web `MOCK_ONLY`; catálogo real: `BLOCKED` por F11)                                                     |
| `011-categories-menu-hierarchy`   | F10 Categorías y jerarquía del menú      | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`)                                                                               |
| `012-products-catalog`            | F11 Productos y fichas de catálogo       | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`)                                                                               |
| `013-product-modifiers`           | F12 Grupos y opciones modificadoras      | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`)                                                                               |
| `014-branch-pricing-availability` | F13 Precio y disponibilidad por sucursal | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`)                                                                               |
| `015-cloudflare-r2-media`         | F14 Imágenes y medios en Cloudflare R2   | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`; R2 real `BLOCKED_EXTERNAL`)                                                   |
| `016-promotions-happy-hour`       | F15 Promociones, cupones y Happy Hour    | `IN_PROGRESS` (contrato `CONTRACT_DEFINED`; API `API_IMPLEMENTED` con BD simulada en pruebas; migración 0016 sin aplicar) |

Sin carpeta de spec en este índice: **F04** (perfil de cliente; ver ADR-0012) y **F05** (direcciones; el código cita `specs/009-customer-addresses`, que
no existe en `develop`; ver ADR-0014). El número `009` quedó libre; la siguiente spec nueva usa `017`.

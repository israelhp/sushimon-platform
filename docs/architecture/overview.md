# Arquitectura — visión general

**Estado**: Etapa 1 (UI First) completada con datos simulados; API con `GET /v1/health` y `/v1/health/ready` (F00). Leyenda: ✅ implementado · 📐 planificado · 🎭 simulado (mock) · ⏳ pendiente de proveedor · ❓ pendiente de decisión

```text
            ┌────────────────────────────── sushimon-web (Next.js) ───────────────┐
 Cliente ──▶│ (public) tienda      (backoffice) panel interno                      │
            │  UI → features/hooks → services → lib/data-access ─┬─ mock 🎭        │
            └────────────────────────────────────────────────────┴─ http ─────────┘
                                                                        │ OpenAPI (packages/contracts)
            ┌────────────────────────────── sushimon-api (NestJS) ─────▼──────────┐
            │ módulos por dominio: auth · catalog · branches · orders · payments · │
            │ delivery · incidents · notifications · audit        (📐 solo health ✅) │
            │ adaptadores: DeliveryProvider{Own, PedidosYa⏳}  PaymentGateway{Neonet⏳}│
            └───────────────┬──────────────────────────────────────────────────────┘
                            ▼
                 Supabase: PostgreSQL (esquema `app`) + Auth (Google OAuth) 📐
```

## Componentes

| Pieza                | Estado | Notas                                                                                                        |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Monorepo pnpm        | ✅     | `sushimon-api`, `sushimon-web`, `packages/contracts`                                                         |
| API `GET /v1/health` | ✅     | único endpoint real; OpenAPI + filtro de errores + env validado                                              |
| Web: tienda pública  | 🎭     | 15 vistas + 6 overlays fieles al prototipo (es/en, claro/oscuro); datos simulados                            |
| Web: backoffice      | 🎭     | login de demostración por rol, panel, pedidos, entregas, catálogo, admin y reportes                          |
| `lib/data-access`    | ✅     | puerto único mock/http, `ApiError`, sin fallback silencioso; adaptador mock ✅ (ADR-0008)                    |
| Contratos            | ✅     | OpenAPI canónico + tipos generados + verificación contra la API                                              |
| Auth Google/RBAC     | 📐     | slice `feature/google-oauth` (Etapa 3)                                                                       |
| Base de datos        | 📐     | DBML como línea base; Prisma 7 configurado (ADR-0003); solo migración `0001` (esquema `app`); sin tablas aún |
| PedidosYa / Neonet   | ⏳     | simulados en la web (rotulados "Simulación"); integración real pendiente de documentación                    |

## Decisiones de diseño

- **Una app web** con route groups; sin segundo proyecto de backoffice.
- **Monolito modular**; sin microservicios, colas ni Redis (ver `technology-decisions.md`).
- **La API es la única autoridad** de reglas de negocio, precios, permisos y escritura.
- Entorno: variables en `.env.example` de cada app (sin secretos).

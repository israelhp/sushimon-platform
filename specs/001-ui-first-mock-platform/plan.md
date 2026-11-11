# Implementation Plan: Demo funcional UI First (tienda + backoffice)

**Branch**: `feature/ui-first-mock-platform` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-ui-first-mock-platform/spec.md`

## Summary

Reimplementar en `sushimon-web` (Next.js 16, App Router) las dos zonas de los prototipos con fidelidad visual, sobre
una capa de datos intercambiable (mock/http) con datos deterministas. Decisiones: ADR-0004 (sin `cacheComponents`),
ADR-0005 (next-intl), ADR-0007 (se reutiliza contenido, no código), ADR-0008 (puerto único + mock en el navegador).

## Technical Context

**Language/Version**: TypeScript 6.0, React 19, Node ≥ 22.12
**Primary Dependencies**: Next.js 16.4 (React Compiler), Tailwind 4, TanStack Query 5, next-intl, lucide-react, clsx, @fontsource (Archivo Black, DM Sans variable, Dela Gothic One)
**Storage**: N/A (MockStore en memoria del navegador + `sessionStorage`; preferencias en `localStorage`/cookie)
**Testing**: Vitest 4 (+ Testing Library, jsdom), Playwright (E2E, axe, comparación visual con pixelmatch)
**Target Platform**: navegadores modernos, móvil (≥ 320 px) y escritorio
**Project Type**: web (monorepo: `sushimon-web` + `packages/contracts`)
**Performance Goals**: interacción fluida; carrusel y transiciones a 60 fps; sin red externa
**Constraints**: fidelidad ≤ 3 % de píxeles distintos por pantalla; sin secretos en `NEXT_PUBLIC_*`; sin fallback silencioso
**Scale/Scope**: 15 vistas + 6 overlays en la tienda; 11 vistas + 8 overlays en el backoffice

## Constitution Check

| Principio           | Cumplimiento                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| I Seguridad         | Sesiones de demostración rotuladas; sin datos de tarjeta persistidos; `localStorage` solo preferencias; la UI no decide permisos reales |
| II Contract First   | Esquemas _draft_ en `openapi.yaml` (`components/schemas`), tipos generados; rutas previstas en `docs/contracts/planned-endpoints.md`    |
| III Integridad      | Totales calculados solo para mostrar; ciclos de vida de pedido/pago/entrega separados                                                   |
| IV Simplicidad      | Dependencias nuevas justificadas (tabla en el plan de la etapa); sin librería de gráficos ni de estado global                           |
| V UI First honesto  | Adaptador mock determinista; `resolveDataSource` intacto; insignias "Simulación"/"Demostración"                                         |
| VII Pruebas         | Unitarias, componentes, paridad de adaptadores, E2E, axe y visual                                                                       |
| VIII A11y/fidelidad | Comparación visual automatizada; teclado, foco, contraste, reduced motion                                                               |
| X Git Flow          | Rama `feature/ui-first-mock-platform` desde `develop`; Conventional Commits; PR a `develop` sin push automático                         |

Sin violaciones; no se requiere Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-ui-first-mock-platform/
├── spec.md
├── plan.md            # este archivo
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/contracts/openapi/openapi.yaml      # + components/schemas draft
sushimon-web/
├── e2e/                                     # Playwright: flujos, axe, visual/
├── public/brand/                            # logos extraídos
└── src/
    ├── app/
    │   ├── layout.tsx                       # html, fuentes, tema, NextIntlClientProvider, AppProviders
    │   ├── globals.css                      # tokens por zona + @theme
    │   ├── (public)/                        # data-zone="store"
    │   │   ├── layout.tsx                   # StoreShell (header, nav móvil, footer, overlays)
    │   │   ├── page.tsx · menu/ · promociones/ · checkout/ · mas/ · consultar/ · incidencias/
    │   │   ├── trabaja-con-nosotros/ · pedidos/[id]/ · cuenta/{,datos,direcciones,favoritos,pedidos}/
    │   │   └── not-found.tsx
    │   └── (backoffice)/backoffice/         # data-zone="bo"
    │       ├── login/page.tsx
    │       └── (app)/layout.tsx + panel/ pedidos/ entregas/ productos/ categorias/ promociones/
    │           sucursales/ usuarios/ reportes/
    ├── components/{ui,art,icons}/           # base compartida, ilustraciones, íconos del backoffice
    ├── features/<dominio>/                  # hooks (TanStack Query) + componentes de feature
    ├── services/<dominio>.ts                # casos de uso sobre DataClient
    ├── lib/
    │   ├── data-access/                     # types, errors, paths, config, http-client, mock-client, provider
    │   ├── format.ts                        # dinero/fechas (Intl)
    │   └── cn.ts
    ├── mocks/{fixtures,factories,handlers,scenarios}/ + store.ts + clock.ts
    └── i18n/{request.ts,messages/{es,en}.json}
```

**Structure Decision**: una sola app con route groups (ya decidido en la Etapa 0); los estilos de la tienda se
re-expresan con utilidades Tailwind sobre tokens idénticos; los del backoffice con hojas por componente (prefijo `bo-`)
sobre los tokens del repo.

## Fases

0. Rama, spec, ADR (hecho). 1. Extracción (`scripts/prototype-extract.mjs`, `scripts/prototype-i18n.mjs`).
1. Fundaciones UI ∥ 3. Capa de datos (archivos disjuntos). 4. Tienda (6 bloques). 5. Backoffice (5 bloques).
2. Pruebas E2E/axe/visual, revisiones (ui-ux, security, performance), docs, PR.

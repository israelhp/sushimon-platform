# Decisiones tecnológicas y versiones

Verificadas el 2026-11-11 contra npm/GitHub; las versiones exactas quedan fijadas en `pnpm-lock.yaml`.

| Área        | Elección                                          | Notas                                                                                     |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Runtime     | Node ≥ 22.12 (CI: 24), pnpm 10                    | `packageManager` fijado en la raíz                                                        |
| API         | NestJS 12 + Express, ESM                          | Scaffold basado en el CLI oficial 12.0.12                                                 |
| Web         | Next.js 16.4.6, React 19, Tailwind 4              | `reactCompiler` activo; sin `cacheComponents` hasta decidir (ADR-0004)                    |
| TypeScript  | **6.0.x**                                         | `typescript-eslint` soporta `<6.1`; TS 7 queda fuera por compatibilidad                   |
| Lint/format | ESLint 9 + typescript-eslint, Prettier 3          | ESLint 9 por compatibilidad con `eslint-config-next`                                      |
| Pruebas     | Vitest 4 (API, web), `node:test` (hooks, scripts) | Nest 12 usa Vitest por defecto; Playwright al haber pantallas                             |
| Contratos   | OpenAPI 3.0.3 + `openapi-typescript` 7            | Peer `typescript@^5` relajado en `pnpm-workspace.yaml` (verificado por `contracts:check`) |
| Validación  | `class-validator` (DTOs), `zod` (entorno)         |                                                                                           |
| Commits     | commitlint + Husky + lint-staged                  |                                                                                           |
| Spec-driven | Spec Kit 1.4.0 (venv aislado)                     | `uv` no estaba instalado; no se instaló nada global                                       |

## Pendientes de decisión

| ADR  | Tema                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0003 | ORM: **Prisma 7.10.1** + `@prisma/adapter-pg` (aceptada en F00; ver `docs/adr/0003-orm-prisma.md`) |
| 0004 | Modelo de caché de Next (`cacheComponents`)                                                        |
| 0005 | Librería i18n (es/en)                                                                              |
| 0006 | Host de la API (por evaluar contra límites y modelo de ejecución oficiales vigentes; no asumido)   |

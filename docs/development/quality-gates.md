# Quality gates

| Control           | Comando                                                         | Dónde                 |
| ----------------- | --------------------------------------------------------------- | --------------------- |
| Formato           | `pnpm format:check`                                             | local, CI             |
| Lint (ESLint)     | `pnpm lint`                                                     | local, CI             |
| Tipos (TS strict) | `pnpm typecheck`                                                | local, CI             |
| Pruebas unitarias | `pnpm test` (incluye `test:hooks`)                              | local, CI             |
| Pruebas e2e API   | `pnpm --filter sushimon-api test:e2e`                           | CI                    |
| Contrato          | `pnpm contracts:check` (tipos al día + API conforme al OpenAPI) | local, CI             |
| Secretos          | `pnpm secrets:scan`                                             | local, CI             |
| Build             | `pnpm build`                                                    | local, CI             |
| Dependencias      | `pnpm audit --prod --audit-level high`                          | CI                    |
| Commits           | commitlint                                                      | `commit-msg`, CI (PR) |
| Ramas             | workflow `Git Flow`                                             | CI (PR)               |

`pnpm check` agrupa los controles locales. Husky: `pre-commit` (lint-staged/prettier), `commit-msg` (commitlint),
`pre-push` (`pnpm check`). CI es la fuente de verdad. **Playwright (E2E web)**: se incorpora con las primeras
pantallas (Etapa 1); aún no instalado. Cobertura mínima: sin umbral todavía (definir en Etapa 1).

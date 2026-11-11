# ADR-0001 Monorepo con pnpm workspaces

**Estado**: aceptada · 2026-11-11

**Contexto**: dos apps y un contrato compartido, equipo pequeño.
**Decisión**: pnpm workspaces (`sushimon-api`, `sushimon-web`, `packages/contracts`). Sin Nx/Turborepo.
**Consecuencias**: scripts coherentes en la raíz; revisar herramientas de orquestación si los tiempos de CI crecen.

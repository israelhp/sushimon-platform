---
name: nextjs-web
description: 'Convenciones Next.js 16 / React / Tailwind del proyecto. Úsala al escribir código en sushimon-web.'
---

# Next.js Web

Reglas base: `.claude/rules/frontend.md` y `sushimon-web/CLAUDE.md`. Lee `node_modules/next/dist/docs/`
para APIs de esta versión (no confíes en memoria).

- Route groups `(public)` y `(backoffice)/backoffice`; layouts propios; componentes compartidos.
- Server Components por defecto; formularios con estado local; datos remotos con TanStack Query
  solo donde haya interacción/refresco.
- Acceso a datos únicamente vía `services` → `lib/data-access`.
- Tailwind con tokens; claro/oscuro; responsive mobile-first; foco visible.

## Criterios

`pnpm --filter sushimon-web lint typecheck test build` verde · sin hex sueltos · sin `fetch` en
componentes · estados vacío/carga/error presentes.

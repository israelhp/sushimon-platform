# sushimon-web — reglas Next.js

Contexto global en `../CLAUDE.md`. **Esta versión de Next (16) difiere de lo que sabes**: consulta la
documentación incluida en `node_modules/next/dist/docs/` antes de usar APIs de routing/caché.

- **Una app, dos zonas**: `src/app/(public)/…` tienda; `src/app/(backoffice)/backoffice/…` backoffice.
  Layouts separados, componentes y lógica compartidos en `components/`, `features/`, `lib/`.
- **Server Components por defecto**; `'use client'` solo donde haya interactividad. Datos estáticos
  no necesitan TanStack Query; datos de servidor interactivos sí.
- **Estado**: local (`useState`), formularios (por feature) y remoto (TanStack Query) separados.
- **Datos**: las pantallas nunca llaman `fetch` directamente. Flujo:
  `UI → feature hooks → services → lib/data-access (DataClient) → mock | http`.
  Selección por `NEXT_PUBLIC_DATA_SOURCE`; sin fallback silencioso en producción (`config.ts` lo impide).
- **Mock Data**: `src/mocks/{fixtures,factories,scenarios}`; deterministas (sin `Date.now()`/`Math.random()`
  sin semilla), tipados con `@sushimon/contracts`. Escenarios: ver `mocks/scenarios/index.ts`.
  Las acciones simuladas (PedidosYa, Neonet) muestran una insignia visible “Simulación”.
- **Tipos de API**: importar de `@sushimon/contracts`; no redefinir a mano.
- **Estilo**: Tailwind 4 con tokens en `globals.css` (`bg-bg`, `text-fg`, `text-muted`, `border-line`,
  `bg-primary`, `bg-accent`); claro/oscuro; sin colores hex sueltos. Fidelidad a los prototipos
  (`docs/ui/design-system.md`), sin copiar su código.
- **Accesibilidad**: HTML semántico, foco visible, etiquetas en controles, contraste AA, teclado completo.
- **i18n**: `next-intl` sin prefijo en la URL (cookie `NEXT_LOCALE`, ADR-0005). Mensajes en
  `src/i18n/messages/{es,en}.json`; el backoffice vive en el espacio `backoffice` y se muestra solo en español.
- **Auth** (F01): `NEXT_PUBLIC_AUTH_SOURCE=mock|supabase`. Real = Google + PKCE (`@supabase/ssr`), `proxy.ts` refresca
  la sesión, `/auth/callback` canjea el código, la API recibe `Authorization: Bearer`. La UI solo muestra/oculta;
  `GET /v1/auth/context` decide `access` (`GRANTED` = personal activo + aal2). MFA TOTP (F02): `lib/auth/mfa.ts`,
  `features/session/backoffice-access.ts`; pantallas en `/backoffice/mfa/{setup,verify}` y `/backoffice/access-denied`. Destinos post-login solo con `safeNextPath`.
- **Seguridad**: nada de secretos en `NEXT_PUBLIC_*`; `localStorage` solo para preferencias (tema/idioma),
  nunca autenticación/autorización; el backoffice oculta UI por permiso pero **la API decide**.
- **Pruebas**: Vitest (`*.test.ts` en node, `*.test.tsx` en jsdom); Playwright en `e2e/` (flujos, axe) y
  `e2e/visual/` (comparación contra los prototipos con `harness.ts`, red bloqueada; es un reporte, no un gate).

Comandos: `pnpm --filter sushimon-web {dev|build|test|lint|typecheck|test:e2e|test:visual|capture:prototypes}`.

# Conventional Commits

Formato: `tipo(scope): descripción` (≤ 100 caracteres en la cabecera). Validado por commitlint (Husky `commit-msg` y CI en PRs).

Tipos: `feat fix docs style refactor perf test build ci chore revert`.

Scopes recomendados (opcionales): `web`, `api`, `contracts`, `db`, `auth`, `catalog`, `checkout`, `orders`, `delivery`,
`payments`, `ui`, `claude`, `deps`. Ejemplos: `feat(web): implement public store mock` · `feat(api): add branches endpoints` ·
`fix(auth): validate branch permissions` · `perf(api): optimize catalog queries` · `test(checkout): cover idempotency` ·
`docs(database): document delivery provider gaps` · `ci: add gitflow validation`.

No se fuerza un scope ni se modifica código solo para cumplirlo.

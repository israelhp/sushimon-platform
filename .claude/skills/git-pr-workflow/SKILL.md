---
name: git-pr-workflow
description: 'Flujo diario de ramas, commits y Pull Requests con Git Flow. Úsala al crear ramas, commitear o preparar PRs.'
---

# Git + PR

1. `git switch develop && git pull` (si hay remoto) → `git switch -c feature/<nombre>`.
2. Commits Conventional (`feat(web): …`, `fix(api): …`); hooks Husky validan formato y mensaje.
3. `pnpm check` antes del PR. PR hacia `develop` con la plantilla `.github/pull_request_template.md`.
4. Merge solo con revisión y CI verde; eliminar la rama después.

## Prohibido sin autorización humana

`git push`, force push, merge a `main`/`develop`, tags, releases, `--no-verify`, reescribir historial.
Ver `docs/development/gitflow.md`.

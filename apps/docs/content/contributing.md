# Contributing

Contributions are welcome. The repository root has the full guide in
`CONTRIBUTING.md`; this page is the short version.

## The CLA

Every contributor agrees to the Aulora CLA (`CLA.md`) before a change is
merged. Aulora is dual-licensed — noncommercial for everyone and commercial for
businesses — so the project must hold enough rights in each contribution to
keep selling commercial licenses. You keep your copyright.

## Workflow

```sh
bun install
bun run typecheck
bun run lint
bun run test
```

- Branch from `main`; keep commits small and single-purpose.
- Use Conventional Commits (`feat(scope): …`, `fix(scope): …`, `docs(phase-6): …`).
- Keep the tree green before opening a pull request.
- Never commit secrets or real `.env` values.
- Do not force-push shared branches.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Vite + React SPA |
| `apps/mobile`, `apps/desktop` | Expo and Tauri clients |
| `packages/convex` | schema, queries, mutations, actions, HTTP routes, crons, server-side encryption |
| `packages/core` | shared hooks, permissions, well-known parsing |
| `infra/docker` | Compose stack, setup and the backup runner |
| `apps/docs` | this site |

Keep pure view logic in `apps/web/src/lib` with unit tests, and re-check all
authority server-side in `packages/convex`.

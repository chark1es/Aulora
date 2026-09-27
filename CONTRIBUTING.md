# Contributing to Aulora

Thanks for helping build Aulora. This guide covers the workflow and the one
legal requirement: a Contributor License Agreement.

## Contributor License Agreement (CLA)

Aulora is dual-licensed: the [PolyForm Noncommercial License 1.0.0](LICENSE)
for personal and noncommercial use, and a paid [commercial license](COMMERCIAL.md)
for businesses. To keep selling commercial licenses, the project must hold
sufficient rights in every contribution.

**Every contributor must agree to the [Aulora CLA](CLA.md) before their first
change is merged.** The CLA keeps you the author of your contribution and grants
the project the right to license it under both the noncommercial and the
commercial terms. Sign by adding your name to the contributor list in a pull
request comment when a maintainer asks, or by following the CLA bot's prompt
once the automated check lands. The CLA text is a stub until the commercial
license is finalized; ask a maintainer if anything is unclear.

This is not legal advice; ask a lawyer if you need counsel.

## Setup

You need [Bun](https://bun.sh) 1.4.0 (pinned by `packageManager`), Node.js
22.18.0, and Git. Docker is only needed to run the self-hosted stack.

```sh
bun install        # writes the single root bun.lock
bun run typecheck  # tsc --noEmit across every package
bun run lint       # Biome across every package
bun run test       # Vitest suites across every package
bun run build      # Turborepo build (dist/** where a package builds)
```

## Workflow

- Branch from `main`; use small, single-purpose commits.
- Follow Conventional Commits (`feat(scope): …`, `fix(scope): …`,
  `docs(phase-6): …`), matching the existing history.
- Keep the tree green: `bun run lint`, `bun run typecheck` and `bun run test`
  must all pass before you open a pull request.
- Never commit secrets or real `.env` values. Use `.env.example` as the template.
- Do not force-push shared branches.

## Where things live

| Path | What |
| --- | --- |
| `apps/web` | Vite + React SPA (web admin, chat, connect screens) |
| `apps/mobile`, `apps/desktop` | Expo and Tauri clients |
| `packages/convex` | Schema, queries, mutations, actions, HTTP routes, crons |
| `packages/core` | Shared hooks, permission resolution, well-known parsing |
| `packages/ui-web`, `packages/ui-native` | Design-system components |
| `infra/docker` | Compose stack, first-run setup, backup runner |
| `infra/push-relay` | Content-free APNs/FCM/UnifiedPush relay |
| `apps/docs` | Static docs site |
| `docs` | Phase gate reports |

## Adding an admin surface

Workspace admin lives in `apps/web/src/components/admin` and is gated by the
permission bitfield; the server re-checks every mutation. Instance admin
(operator-only) lives in `apps/web/src/components/admin/instance` and is gated
on the workspace owner. Keep pure view logic in `apps/web/src/lib` with unit
tests, and re-check all authority server-side in `packages/convex`.

## Security

Report vulnerabilities privately to the maintainers rather than in a public
issue. Never include real credentials, message content, or any key material —
including the EKM master key (KEK) or a per-scope data key (DEK) — in an issue,
pull request or test fixture.

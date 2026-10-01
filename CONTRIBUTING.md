# Contributing to Aulora

Read the [development guide](docs/development.md) for a working local frontend and backend. Use GitHub Issues to discuss substantial changes before implementing them. Small fixes and documentation corrections can go directly into a pull request.

## Contributor agreement

Read [CLA.md](CLA.md), then follow the CLA bot's comment on your pull request. It checks the author and commit co-authors, records acceptance, and publishes the `CLA` status. Previous acceptance is reused while the agreement text is unchanged. The [bot guide](docs/cla-bot.md) covers missing identities and rechecks.

## Setup and checks

Use Bun 1.4.0, Node.js 22.18.0, and Git. Docker is needed for a live local backend. Native clients also need platform SDKs.

```sh
bun install --frozen-lockfile
bun run check
```

The aggregate check includes lint, types, workspace tests, web/docs builds, infrastructure tests, release-script tests, and public documentation checks. It does not compile native clients. CI separately compiles desktop, Android, and iOS; see [GitHub Actions](docs/github-actions.md).

## Pull requests

- Branch from `main` and keep each pull request focused on one change.
- Use Conventional Commits, such as `fix(auth): preserve sessions` or `docs: explain setup`.
- Explain the problem, resulting behavior, and how you verified it. Include screenshots for UI changes and migration steps for schema or deployment changes.
- Update user-facing docs when behavior changes. Release notes live in GitHub Releases.
- Add tests for meaningful behavior changes. Keep permissions and validation on the server even when the UI also checks them.
- Run the relevant checks and resolve failures before requesting review.
- Commit dependency changes with `bun.lock`. Do not introduce another workspace lockfile.
- Never commit real `.env` files, credentials, user data, or private messages. Native debug keystores are public testing material and must never sign releases.
- Do not force-push shared branches.

Keep shared client logic in `packages/core`, backend behavior in `packages/convex`, and reusable UI in `packages/ui-web` or `packages/ui-native`. The [repository map](README.md#repository-map) explains the rest.

## Documentation

Public pages live in `apps/docs/content`. Register new pages in `apps/docs/scripts/build.mjs`. Run `bun run docs:dev` and read the generated page; the renderer supports a defined Markdown subset rather than arbitrary HTML. `bun run docs:check` checks local links in the public guides and generated site.

Historical phase reports in `docs/` record past findings. Current setup and release instructions take precedence over them.

## Security and conduct

Report vulnerabilities privately using [SECURITY.md](SECURITY.md). Discuss ideas respectfully, give specific feedback, and avoid harassment or sharing another person's private information. Report conduct concerns to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev); maintainers may remove content or restrict participation.

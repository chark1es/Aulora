# Contributing

The [repository contribution guide](https://github.com/chark1es/Aulora/blob/main/CONTRIBUTING.md) describes pull requests, tests, and documentation changes. Follow the [development guide](https://github.com/chark1es/Aulora/blob/main/docs/development.md) to run a working local backend and client.

Use Bun 1.4.0 and Node.js 22.18.0, then run from the repository root:

```sh
bun install --frozen-lockfile
bun run check
```

Native builds require additional SDKs and are checked separately in CI. `bun run dev` does not install or provision a server.

## Contributor agreement

Read the [Aulora contributor agreement](legal/CLA.md), then follow the CLA bot's comment on your pull request. It records acceptance from each contributor and publishes the `CLA` status. See the [bot guide](https://github.com/chark1es/Aulora/blob/main/docs/cla-bot.md) for tracking and troubleshooting.

## Workflow

- Branch from `main` and keep each change focused.
- Describe the resulting behavior and how you tested it.
- Update public docs when behavior changes.
- Run the relevant checks before requesting review.
- Keep real credentials, encryption keys, and user data out of Git.

Report vulnerabilities privately to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev), following the [security policy](https://github.com/chark1es/Aulora/blob/main/SECURITY.md).

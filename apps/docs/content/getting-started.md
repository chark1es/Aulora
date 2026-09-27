# Getting started

There are two paths: run the whole stack from a checkout, or build and test the
monorepo.

## Self-host in one command

From a clone of the repository:

```sh
# macOS / Linux
./install.sh

# Windows
pwsh ./install.ps1
```

The installer checks Docker, writes `infra/docker/.env` from the template (or
uses `AULORA_*` environment variables), prompts for the workspace name, owner
email and owner password, then runs `docker compose up -d --build` and the
one-shot `setup` service. It prints the URL to open when it finishes. See
[Self-hosting](self-hosting.md) for every option.

Server-side encryption is on by default: `setup` generates a local master key
(`AULORA_ENCRYPTION_KEY`), so the default stack needs no extra services. An
external key manager (Vault, AWS KMS, GCP KMS or an HTTP proxy) is an optional,
advanced alternative. See [Self-hosting → Encryption](self-hosting.md).

## Work on the monorepo

```sh
bun install        # install all workspaces, writes the single root bun.lock
bun run typecheck  # strict tsc --noEmit across every package
bun run lint       # Biome across every package
bun run test       # Vitest suites across every package
bun run build      # Turborepo build
bun run dev        # run the dev servers
```

The docs site builds with `bun run --cwd apps/docs build` and lands in
`apps/docs/dist`.

## Where to go next

- Gave it a server URL and a login? Open the [admin panel](admin.md).
- Want off-machine copies of your data? Set up [backups](backups.md).
- Running it for a company? Read [Licensing](licensing.md).

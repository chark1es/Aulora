# Updates

Back up the database, uploaded files, and encryption key before updating a server. Read the release notes for migrations. Server restarts briefly interrupt active clients and calls.

## Desktop app

Open Your settings, Updates, or Check for updates in the app menu. Download the update and restart when ready. The desktop updater verifies its signature using the embedded public key.

Linux AppImage supports the updater. Debian packages require manual installation of a newer package. Mobile clients update through their store or other installation channel.

## Docker server from a Git clone

The host updater checks the release feed, refuses dirty checkouts, and redeploys a published release while keeping `.env` and volumes:

```sh
cd infra/docker
./update.sh --check
./update.sh --download
./update.sh --restart
```

`--check` returns exit code 10 when a newer release is available. A wrapper using `set -e` must handle that expected code. `--apply` downloads and applies an update directly.

Run `./update.sh --watch` under a host service manager to enable owner-only download/restart controls in Workspace settings, Instance. The watcher needs Bun and installed checkout dependencies. `AULORA_AUTO_UPDATE=true` allows the watcher to prepare downloads automatically; the owner still chooses Restart. The default automatic mode without `--watch` can apply an update, so choose the invocation intentionally.

On macOS with Docker Desktop, run `./update.sh --install-service` from the checkout that owns the running stack. This installs a user LaunchAgent, starts the watcher immediately, and starts it again at login. It keeps your current PATH so the watcher can find Docker and Bun. Logs are in `~/Library/Logs/Aulora/update-*.log`. Use `./update.sh --remove-service` to stop and remove it. A gray Download or Restart button means the watcher is offline; Check for updates still works without it.

Restart the watcher and re-run setup after changing its environment settings. Without it, update checks can still show version information, but installation uses host or hosting-provider controls.

## Coolify

Configure the Coolify API integration described in [Deploy on Coolify](coolify.md#upgrade) to enable **Install update** in the instance settings. Coolify builds and deploys the release in one step, so there is no separate Download button and no host watcher. The owner starts installation explicitly; automatic host updates do not trigger Coolify deployments.

You can also deploy a chosen release tag or commit through Coolify manually. Preserve the existing named volumes, especially `setup-state`, which holds generated secrets. Do not switch to fresh volumes or regenerate the master key during an upgrade.

## Updating a checkout manually

After reviewing the intended commit and confirming your backup, update the checkout without discarding local changes. Then:

```sh
cd infra/docker
./deploy.sh
# Include --profile backups if you use the backup runner.
```

Running setup alone reuses its current image and can deploy old code. `deploy.sh` rebuilds the source-containing images before redeploying.

## Verify and recover

Check service health, discovery, sign-in, old messages, uploads, and permissions after every update. Verify from another client's network too.

Do not assume that checking out an older version reverses a schema migration. Recover using the previous deployment configuration and a compatible backup in an isolated stack. See [backups and restore](backups.md).

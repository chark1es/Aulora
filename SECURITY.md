# Security policy

## Report a vulnerability privately

Email [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev). If GitHub private vulnerability reporting is enabled, you can also use [Report a vulnerability](https://github.com/chark1es/Aulora/security/advisories/new).

Include the affected version or commit, the impact, reproduction steps, and a minimal proof of concept using test data. Remove credentials, tokens, private messages, user information, and encryption keys. Ask by email for a secure transfer method before sending sensitive material.

We will investigate and coordinate a fix and disclosure with you. There is no guaranteed response time or paid bug bounty. Please give maintainers time to address the issue before publishing exploit details.

## Supported versions

Security fixes target the latest stable release. Until v1 is published, reports against the current release candidate are welcome. Upgrade older versions to the latest patch release; experimental code in `spikes/` is not supported for production.

## Trust model

Aulora encrypts message content and uploads on the server. Authorized clients receive decrypted content. This is not end-to-end encryption, and a server operator with access to the application and its key can read content. HTTPS protects network traffic. Account information, membership, timestamps, and other metadata may remain readable in the database. Backups must be treated as sensitive even when message bodies are encrypted.

The default master key lives in `infra/docker/.env` as `AULORA_ENCRYPTION_KEY`. Back it up separately from data and restrict access to the file. Setup also configures the key in the backend deployment environment; protect backend state and raw database dumps as potentially secret-bearing. External key managers are optional. Losing the key makes encrypted content unreadable. Changing a key or key-version setting without a migration and the old keys is not a safe rotation procedure.

Keep Postgres, MinIO administration, the Convex dashboard, signing credentials, and deployment admin keys private. The default Compose stack publishes service ports for local development; review bindings and firewall rules before exposing a host. Use a persistent external Vault for production; the optional bundled Vault runs in development mode.

Mobile push is optional. APNs, FCM, and UnifiedPush transport wakeups through the configured relay. Provider tokens and routing metadata still require protection. See the [privacy guide](apps/docs/content/privacy.md) for data flows.

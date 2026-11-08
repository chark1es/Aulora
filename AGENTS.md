# Repository instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing or submitting work.

Read [Convex performance and upgrades](docs/convex/README.md) before changing
backend queries or mutations, client subscriptions, schemas or indexes, data
migrations, Convex dependencies or engine images, or deployment and update
scripts. Apply the relevant performance and upgrade checks before submitting.

## Boundaries

- Never commit credentials, encryption keys, or private user data.
- Do not bypass backend authorization or disable schema validation to make a
  change pass.

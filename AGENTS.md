# Repository instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing or submitting work.

Read [Convex performance and upgrades](docs/convex/README.md) before changing
backend queries or mutations, client subscriptions, schemas or indexes, data
migrations, Convex dependencies or engine images, or deployment and update
scripts. Apply the relevant performance and upgrade checks before submitting.

## Boundaries

- Keep real credentials, encryption keys, and private user data out of Git. Use
  synthetic fixtures or documented public test credentials instead.
- Do not bypass backend authorization or disable schema validation to make a
  change pass.

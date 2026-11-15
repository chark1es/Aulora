## Aulora 1.6.1

### Fixes

- Fix the “Something went wrong” screen immediately after signing in on web
  and desktop, with either a password or a provider. Successful channel
  subscriptions now clear the error state instead of raising `Error: null`.
- Desktop provider sign-in now opens the default browser and returns through
  the existing secure deep link. The internal-browser sign-in option is removed.

### Upgrade notes

- No database migration, API change, minimum-client increase or operator
  configuration change is required. Discovery API version remains **1**.
- Update the desktop app to 1.6.1. Web users receive the fix after their workspace
  server deploys this release and they reload the page.
- Desktop updater rollout remains at 100%. No kill switch is changed. This is
  a client-only fix; a rollback can use the previous compatible client or web
  image without changing stored data.

### Validation and limitations

- Regression coverage reproduces the reported `Error: null` stack with a warm
  channel subscription on web and desktop, and checks that real subscription
  failures are still reported.
- Automated source checks and release builds gate publication. Live macOS
  installer and sign-in testing against a deployed workspace were not performed
  locally; native signing and builds run in the release pipeline.
- Windows installers remain unsigned. Mobile store availability depends on
  separate signing and store approval processes.

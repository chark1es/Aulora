# Licensing

Aulora is free for the personal and noncommercial purposes defined in [LICENSE](legal/LICENSE). For business deployments, read the [commercial terms](legal/COMMERCIAL.md) for pricing, billing, and permitted use. This guide covers operating a licensed server.

## Activate and view usage

The licensor shares an AULORA2 key after a paid recurring invoice. The instance administrator pastes it into **Instance administration → License**. The server verifies it over HTTPS with `https://aulora-licenses.spwnd.dev` and refreshes every 30 minutes. Signed results are bound to the key and installation and last at most one hour. The panel shows monthly active users and report delivery. Billing is initially disabled until Stripe is configured; contact [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev) to arrange a subscription.

Activity records are created only for an activated activity-billed license. The panel displays provisional counts during the month and final reports after it ends. See [validation and privacy](legal/COMMERCIAL.md#validation-and-privacy) for the data sent to the authority and [privacy](privacy.md) for other server data flows.

## Expiration and outages

An outage does not extend a signed validation lease. Revocation denies new validations, but an existing signed lease can remain valid for up to one hour. Expiration does not delete company data or shut down access to existing messages; it ends authorization for commercial operation.

Queued reports and protected reporting credentials survive expiry and local key removal so final usage can still be delivered. Historical AULORA1 checksum keys do not establish subscription payment or authorize commercial operation.

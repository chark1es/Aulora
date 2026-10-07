# Commercial use of Aulora

Personal and eligible noncommercial use is free under [LICENSE](LICENSE). Commercial operation, including internal business chat and enterprise forks, requires a paid recurring monthly subscription. This document sets out Aulora's standard commercial subscription terms. The licensor is Charles Nguyen, contacted at [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev).

## Monthly active-user pricing

Company subscriptions cost **$1 USD per monthly active user**. Verified nonprofits may choose an optional subscription at **$0.50 per monthly active user**. Annual plans, lifetime licenses, and one-time purchases are unavailable. There is no ongoing minimum activity charge. Taxes are additional where applicable.

An active user is a distinct authenticated workspace member who logs in, has an authenticated presence heartbeat, or successfully sends a message at least once during a UTC calendar month while the license is activated. Administrators count when active. Repeated events, devices, and workspaces do not count the same account again in that installation during that month. Registered members with no activity in the month cost $0. Activity before activation is excluded.

Each active user is charged for the full calendar month, regardless of which day they first become active. Only partial license months are prorated. For example, 10 active users with coverage for the full month cost $10. If the license is activated halfway through a 30-day month and covers the remaining 15 days, the same users cost $5, even if their first activity is on the last day. Coverage starts with successful server activation and ends at expiration, suspension, or revocation. Re-activation gaps are excluded. Proration uses elapsed UTC time and the actual length of the month, including leap years.

## Payments, reports, and adjustments

The initial monthly checkout collects an upfront estimate of active users, with at least one estimated user for the initial purchase. Paid recurring invoices issue or renew an AULORA2 key. The monthly activity report determines the final charge. The authority compares that charge with the prepaid amount allocated to the same calendar month and automatically adds a charge or credit to an upcoming recurring Stripe invoice. The next upfront quantity uses the latest final monthly report and may be zero.

Reports remain provisional during the month and final after it ends. Settlement waits three days for delivery. Missing or incomplete reports remain pending and cannot generate an inactivity credit. Reports must be complete and accurate; blocking reporting does not waive payment obligations. Network failures retry the saved report. Currency rounding carries forward across adjustments to avoid repeated rounding drift. Calendar reporting months and Stripe renewal dates may differ, so an adjustment can appear on a later invoice after the reporting month closes. Credits offset future invoices; they are not automatically refunded in cash.

Cancellation at period end preserves the paid term. Failed renewals do not extend expiration. A canceled subscription's final charge or credit, or an uncertain Stripe operation outside its safe retry window, requires licensor reconciliation and remains visible in the licensing dashboard. The licensor must resolve that balance rather than discard it.

Stripe billing is initially disabled pending configuration. Contact the licensor to arrange a subscription. The Stripe portal supports payment details, invoices, and cancellation; changing quantities or plans there is disabled because activity reports determine billing.

## Commercial grant and enterprise forks

An active paid subscription grants the subscribing company permission to operate one self-hosted Aulora installation for its own business, subject to these terms. The company supplies hosting and infrastructure. The grant includes internal modifications and internal forks used by that company. Managed hosting, a support SLA, resale, sublicensing, redistribution of commercial builds, white labeling, and hosting for other organizations are excluded and require separate permission.

Forking, renaming, modifying, building from source, or contributing to Aulora does not remove the purchase requirement. Enterprise customers must keep a paid subscription while commercially operating an upstream or forked version. They must preserve and operate the license-key interface, server validation, activation and expiration handling, active-user instrumentation, reports, and billing integration. They must retain license and copyright notices. They must not remove, bypass, disable, stub out, hard-code success for, falsify, or redirect these features to avoid validation, reporting, or payment.

License and reporting credentials must remain confidential. The company is responsible for accurate reports and sufficient connectivity to deliver them. Expired, suspended, or revoked keys do not authorize continued commercial operation. Ending a subscription does not erase outstanding usage charges or the duty to deliver final reports. A displayed key or status does not grant rights beyond the commercial agreement. The contributor agreement does not grant rights to operate Aulora commercially.

## Noncommercial use and contributors

The permitted personal and noncommercial uses and organizations in [LICENSE](LICENSE) remain available without purchase. A nonprofit tag does not itself verify discount eligibility. Contributors use the separate [Contributor License Agreement](CLA.md), retain ownership of their original contributions, and grant the rights needed for project distribution. Submitting a contribution does not require purchasing a commercial subscription. Operating a company deployment still does, including deployments run by a contributor's employer.

## Validation and privacy

The instance validates its key over HTTPS with `https://aulora-licenses.spwnd.dev`. The signed response is bound to the key and installation and lasts at most one hour; refresh runs every 30 minutes. Validation transmits the key, installation ID, member count, and a nonce. Activity reports send the license ID, installation ID, UTC month, aggregate active-user count, and final/provisional status. They send no user IDs, names, emails, message contents, or individual activity events. Member identifiers used for local deduplication stay in the company's database and are removed after the authority acknowledges the final report.

Activity tracking starts only after successful activation of an activity-billed license. A validation outage cannot extend the signed lease. Pending reports and their protected credentials are retained so final reports can still be delivered after expiration or local key removal. Revocation denies new validations; a previously signed lease can last up to one hour. The license status does not delete company data or shut down access to existing messages. Continuing commercial operation still requires the rights granted here.

Third-party software retains its own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Historical AULORA1 checksum keys do not establish subscription payment or authorize commercial operation.

## Pricing comparison

Aulora's monthly price is below the published paid Slack Pro and Zulip self-hosted Basic rates researched on September 30, 2026. Free alternatives exist, and quote-based enterprise plans cannot be compared without a quote. See the [pricing research](docs/archive/commercial-pricing-research.md). Aulora offers monthly subscriptions only.

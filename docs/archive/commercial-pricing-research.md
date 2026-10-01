> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

# Commercial pricing research

Checked September 30, 2026. All vendor prices below come from official sources. USD prices exclude tax. Annual figures are monthly equivalents unless the table says otherwise. Promotional introductory prices are excluded.

## Published competitor prices

| Product and plan | Monthly billing | Annual billing | Scope and source |
| --- | --- | --- | --- |
| Slack Pro | $8.75 per user/month | $7.25 per user/month | Hosted service. [Official pricing update](https://slack.com/intl/en-us/help/articles/39264531104275-Updates-to-feature-availability-and-pricing-for-Slack-plans) |
| Slack Business+ | $18 per user/month | $15 per user/month | Hosted service with SAML SSO and additional administration. [Official plan page](https://slack.com/pricing/businessplus) |
| Zulip self-hosted Basic | $3.50 per user/month | No annual price listed | Complete software and unlimited mobile notifications. [Official plans](https://zulip.com/plans/) |
| Zulip self-hosted Business | $8 per user/month | $6.67 per user/month | Minimum 25 users; includes support for specified administration features. [Official plans](https://zulip.com/plans/) |
| Mattermost Professional and Enterprise | Quote required | Quote required | The current page publishes no numeric list price. Licenses are prepaid annual subscriptions per activated user. [Official pricing](https://mattermost.com/pricing/) |
| Rocket.Chat Commercial | Quote required | Quote required | The current commercial plan routes buyers to sales. [Official plans](https://www.rocket.chat/plans) |

Rocket.Chat's former Pro plan became legacy on April 29, 2026 and is unavailable for new purchases. Historical Pro prices should not appear in current comparisons. [Rocket.Chat plan documentation](https://docs.rocket.chat/our-plans)

Free alternatives matter. Zulip permits self-hosting its full software without a paid plan; its notification service is free for organizations with up to 10 users and qualifying communities. [Zulip self-hosted billing](https://web.zulip.com/help/self-hosted-billing) Rocket.Chat Starter is free for up to 50 users, subject to its plan limitations. [Rocket.Chat Starter](https://www.rocket.chat/get-started)

## Aulora monthly offer

Company subscriptions cost $1 per monthly active user. There are no annual, lifetime, or one-time plans. For 25 users active during a full UTC calendar month, the charge is $25. Verified nonprofits may choose an optional $0.50 per monthly active user subscription.

Count each user once per UTC calendar month when they log in, appear online, or successfully send a message after license activation. Inactive users cost $0. First activity date does not reduce the charge; only partial license months are prorated. The initial active-user estimate is paid upfront, and final reports automatically add charges or credits to subsequent recurring invoices. Missing reports never imply zero usage. See [commercial terms](../COMMERCIAL.md) for the full calculation and fork requirements.

This launch price is not a measured profitability result. The company pays for and operates its own Aulora infrastructure. Hosting, storage, backups, email, and third-party service charges remain the company's costs. The standard subscription does not include unlimited deployment consulting or guaranteed round-the-clock support. Review support time, billing costs, and license-service costs after the first paid cohort before making long-term margin claims.

At 25 active users, twelve full licensed months would cost $300, charged monthly. Slack Pro's listed monthly rate gives $218.75 per month for 25 users; Zulip self-hosted Basic gives $87.50. These are license and subscription comparisons, not equivalent total operating costs or feature comparisons. Prices, promotions, support commitments, and negotiated contracts can change.

Use the claim "Company licenses at $1 per monthly active user, with your data on your own server." Free editions exist, enterprise quotes are unpublished, and hosted services include infrastructure Aulora customers must provide, so a claim of being cheaper than every competitor would be unsupported.

## Nonprofits and tags

The existing [Aulora LICENSE](../LICENSE) already permits use by the noncommercial organizations it defines. Preserve that free base-use permission. Do not make a `nonprofit` tag turn those existing rights into a mandatory paid subscription.

Offer verified nonprofits an optional recurring paid subscription at 50% off if they want commercial subscription benefits. That gives $0.50 per monthly active user; annual plans are unavailable. The discount is a recommendation, not a published competitor fact. A free nonprofit grant can also have an administrative review date; that date must not override permissions already granted by the repository's license.

Slack's nonprofit program offers eligible workspaces of up to 250 members free Pro upgrades and an 85% discount above that size; Business+ discounts are 85%. Aulora cannot claim that its optional nonprofit subscription beats every nonprofit offer. [Slack nonprofit program](https://slack.com/help/articles/204368833-Apply-for-the-Slack-for-Nonprofits-discount)

Store tags such as `nonprofit`, `education`, or `partner` as administrative labels. Apply billing discounts explicitly through approved subscription configuration. Editing a tag alone must not silently change a price, authorize access, or extend expiration.

## Subscription and license behavior

Create or extend a company license only after Stripe confirms a successful subscription payment. A successful checkout redirect is insufficient. Bind the license to the company and licensed server, monthly activity billing model, and paid-through date. Renewals extend the paid-through date; cancellation at period end preserves access through the paid period. A license is not a permanent entitlement.

Use server-side validation against the maintainer's license service. Stripe webhook signatures, event deduplication, and payment reconciliation should drive the license state. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)

Keep revocation, expiration, subscription cancellation, and temporary validation outages as separate states. Companies should see which state applies and how to resolve it. Any temporary outage allowance needs a bounded duration and cannot turn an expired subscription into perpetual access.

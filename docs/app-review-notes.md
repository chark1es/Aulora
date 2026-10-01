# App Review notes

Draft for App Store Connect's Notes for Review. Replace the server placeholder before submission and enter working test credentials in the App Review Information sign-in fields. Keep credentials out of this repository.

## Suggested note

> Aulora is a self-hosted team communication app intended primarily for organizations and business teams. Users connect to their team's Aulora server and authenticate using a method configured by that server's administrator. Channels, direct messages, shared files, and calls depend on workspace membership and access permissions. Authentication is therefore essential to the app's core functionality and protects private workspace content.
>
> For review, connect to [REVIEW SERVER URL], tap Connect, then Continue, and sign in using the test credentials provided in App Review Information. This account provides access to a test workspace for evaluating the app.

Confirm the button labels and test-account access in the submitted build before using these instructions.

## If the concern is Sign in with Apple

Use this additional paragraph only when the submitted app's actual account flow requires existing organization-managed enterprise accounts:

> We request consideration under Guideline 4.8's exception for business apps that require existing enterprise accounts. Users authenticate to their organization's workspace using administrator-configured credentials or enterprise identity providers. A separate Apple account would not establish membership or access permissions in that workspace.

The code supports server-configured local accounts, optional account creation, and OAuth/OIDC providers. The project also supports personal and noncommercial deployments. Do not describe every deployment as enterprise-only or claim that account creation is unavailable. Enterprise focus alone does not establish eligibility for the exception.

## Policy basis

Verified against Apple's guidelines on September 30, 2026:

- [Guideline 5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage) requires login-free use when an app lacks significant account-based features. Aulora's workspace communication and access controls provide the rationale for required login.
- [Guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services) exempts qualifying business apps requiring existing enterprise accounts from offering an additional equivalent login service. This concerns login providers, not anonymous access.
- [Guideline 2.1(a)](https://developer.apple.com/app-store/review/guidelines/#app-completeness) requires working demo credentials and a live backend for apps with login. Using a full-featured built-in demo instead because of legal or security obligations requires Apple's prior approval.

Notes alone cannot create anonymous functionality, replace reviewer access, or guarantee approval.

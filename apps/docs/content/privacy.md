# Privacy and data handling

This page describes Aulora's data flows. Each server operator is responsible for the privacy policy, retention rules, and notices for their own deployment. It is not a promise about a particular server's practices.

## Data on your server

The server stores accounts, workspace membership, messages, attachments, reactions, permissions, and activity metadata needed to run chat. The default deployment stores data in Postgres and object storage on the operator's infrastructure.

Message content and uploads use server-side encryption. Authorized clients receive decrypted content. The operator's server has access to the key, so administrators with control of the application can read content. Account information and other metadata may remain readable. This is not end-to-end encryption.

Clients store server profiles and session information on the device so you can return to your workspaces. Sign out on shared devices. OS backups and local device security can affect that information.

## Optional external services

The configured identity provider receives sign-in traffic when OAuth or SSO is enabled. An email provider receives recipient addresses and email content when the server sends account or invitation emails.

Mobile notifications send device tokens and routing information through the configured push relay and APNs, FCM, or UnifiedPush. The relay is designed to send generic wakeups/alerts rather than chat message bodies. Providers can still observe transport metadata.

Voice/video uses WebRTC. Media travels between participants or through TURN when required by network conditions. STUN/TURN servers receive network information; peers may learn each other's public IP addresses. Operators can configure their own ICE servers.

Desktop and server update checks contact the configured release feed, normally GitHub. External key managers and external object storage receive requests when the operator enables them.

## Retention, deletion, and backups

Ask your server operator about retention, account deletion, access requests, and exported data. Deleted data can remain in older backups until the operator's backup retention expires. Backups include sensitive metadata even when content is encrypted.

The default backup bucket is on the same MinIO deployment. Operators should keep protected off-machine copies and a separately secured encryption-key backup. See [backups](backups.md).

## Release publisher responsibilities

Before distributing official mobile apps, the publisher must publish a reachable privacy-policy URL, complete store data disclosures accurately, and provide any required account-deletion process. A page in this repository alone does not establish a hosted policy or store compliance.

For project questions, email [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev). Contact your server operator for requests about data on their deployment.

## Licensed monthly activity

After an activity-billed license activates, the instance counts distinct authenticated members once per UTC month using successful logins/session refreshes, presence heartbeats, and messages. Local user IDs are used only to deduplicate and are removed after the final monthly report is acknowledged. Unlicensed instances do not create these billing activity records. The licensing authority receives aggregate counts, month, license ID, installation ID, and final/provisional status. It receives no member identities or message contents. Saved encrypted reporting credentials allow final reports after expiry or key removal. Reports support monthly billing; missing reports are not interpreted as zero users.

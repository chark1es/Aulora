# Webhooks

A webhook is a secret URL that posts messages into one channel. Anything that can send an HTTP request can use it: a CI job, a monitoring alert, a cron script. Webhooks are for sending only. To react to messages, use a [bot](bots.md).

Webhooks are managed in **Workspace settings → Webhooks**, which needs the **Manage webhooks** permission. Because a channel can override permissions, you also need that permission in the channel you create the webhook for. Bots can never hold it.

## Create a webhook

1. Open **Workspace settings → Webhooks** and choose **New webhook**.
2. Give it a name and pick a text or announcement channel. The name is shown as the author of every message it posts, with a WEBHOOK badge.
3. Copy the URL. It is shown once; Aulora keeps only a hash of the secret in it.

A channel can have up to 10 webhooks. **Edit** renames a webhook or moves it to another channel. **New URL** replaces the secret and stops the old URL working at once. **Delete** destroys the secret; messages it already posted stay, still under its name.

## Send a message

POST JSON to the URL:

```bash
curl -X POST "https://chat.example.com/api/webhooks/WEBHOOK_ID/awh_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"content": "Deploy finished :tada:"}'
```

| Field | Notes |
| --- | --- |
| `content` | The message text, 1 to 4000 characters after trimming. |
| `text` | Accepted instead of `content`, so tools that speak Slack's incoming-webhook format work unchanged. `content` wins if both are present. |

Other fields are ignored. Requests larger than 64 KiB are refused.

A successful request answers `200` with `{"id": "<message id>"}`. Errors answer with `{"error": "<code>"}`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_payload`, `content_too_long` | The body could not be used. |
| 404 | `unknown_webhook` | Wrong URL, replaced secret or deleted webhook. Deliberately the same answer for all three. |
| 409 | `channel_unavailable` | The channel was archived. |
| 413 | `payload_too_large` | Body over 64 KiB. |
| 429 | `rate_limited` | More than 30 messages in 10 seconds from this webhook. Retry after the `Retry-After` header. |

## Things to know

- **The URL is a password.** Anyone who has it can post to the channel as the webhook, whatever their own permissions. Keep it out of public repositories and logs. If it leaks, use **New URL**.
- **Mentions do not notify.** Text such as `@everyone` is posted as plain text and pings no one. People still get the channel's normal notifications for the new message.
- **Plain text only.** There are no attachments or embeds.
- **Moderation works as usual.** Anyone with Manage messages can delete a webhook's message.
- **Changes are audited.** Creating, editing, replacing the URL of and deleting a webhook are recorded in the audit log; messages are not.

## Reaching the endpoint

The URL starts with your workspace address, and the path is `/api/webhooks/…`. The bundled `web` container already forwards that path to the server. If you put your own proxy in front and send all of `/api/*` to the Convex API port, add a route for `/api/webhooks/*` to the HTTP-actions port, the same as for `/api/auth/*`. The [proxy guide](https://github.com/chark1es/Aulora/blob/main/infra/docker/proxy/README.md) has Caddy and Traefik examples.

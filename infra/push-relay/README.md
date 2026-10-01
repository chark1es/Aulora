# Aulora push relay

A small, dependency-free Node service that forwards **content-free wakeups** to
APNs, FCM and UnifiedPush. It exists so people who install the official store
builds of Aulora get mobile push, like Mattermost's HPNS.

Status: **implemented for Phase 5**. The HTTP contract, validation, auth, APNs
JWT signing, FCM and UnifiedPush adapters and the Convex routing action are all
in the repo and unit-tested. Contacting real Apple/Google endpoints needs
credentials and a real device, so live delivery still needs device testing.

## Why it has to exist

iOS and stock Android only deliver push through APNs and FCM, whose credentials
belong to the **app builder**, not the self-hoster. The relay holds those
credentials and forwards only opaque `{ serverId, channelId, messageId, kind }` metadata.
That wakeup carries no message content: Aulora encrypts server-side and the app
fetches and decrypts authorized content from its own server, so the relay cannot
read anything it carries. Self-hosters building their own apps can point
`PUSH_RELAY_URL` at their own relay, or disable mobile push entirely.

## Contract

`POST /v1/wake`

```http
Authorization: Bearer <PUSH_RELAY_TOKEN>
Content-Type: application/json

{
  "v": 1,
  "serverId": "<opaque>",
  "channelId": "<opaque>",
  "messageId": "<opaque>",
  "kind": "message" | "call",
  "platform": "ios" | "android" | "unifiedpush",
  "token": "<APNs/FCM token, or a UnifiedPush endpoint URL>"
}
```

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 202 | `{"accepted":true,"provider":"apns"}` | Provider accepted the wake |
| 400 | `{"error":"bad-request", …}` | Malformed body / unknown platform / extra fields |
| 401 | `{"error":"unauthorized"}` | Missing or wrong bearer token |
| 404/405 | `{"error":"not-found"}` / `method-not-allowed` | Wrong path or method |
| 413 | `{"error":"payload-too-large"}` | Body exceeded 8 KiB |
| 502 | `{"error":"delivery-failed","status":…}` | Provider rejected the wake |
| 503 | `{"error":"provider-unavailable"}` | No provider configured for that platform |

Only the six fields above (plus `v`) are accepted; unknown fields are
rejected, so a caller cannot smuggle a payload through the relay. The
downstream body is rebuilt from the allowlist, never forwarded verbatim.

## Configuration (environment)

The relay itself needs `PUSH_RELAY_TOKEN`; every provider is optional and only
enables when its settings are complete.

| Variable | Purpose |
| --- | --- |
| `PUSH_RELAY_TOKEN` | Shared bearer secret (required) |
| `PUSH_RELAY_PORT` | Listen port (default `8790`) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_KEY_P8` \| `APNS_KEY_PATH`, `APNS_ENVIRONMENT` | iOS via APNs token auth |
| `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_PATH` | Android via FCM HTTP v1 with automatic OAuth token renewal |
| `FCM_ACCESS_TOKEN` | Short-lived Android token for testing |
| `UNIFIEDPUSH_ENABLED=1` | Accept UnifiedPush endpoints (no Google/Apple) |

No credential has a default and none is committed. A service-account path must
exist inside the relay container; inline JSON works without a volume mount.
`PUSH_RELAY_URL` and
`PUSH_RELAY_TOKEN` are also read by the Convex action that routes wakeups.

## Compose profile

The service is **off by default** behind a Compose profile:

```powershell
docker compose --profile push-relay up -d --build
```

Without `PUSH_RELAY_URL`/`PUSH_RELAY_TOKEN` set for the backend, the Convex
`notifications.dispatchMobileForMessage` action no-ops, so ordinary sends never
fail on a deployment without mobile push.

## Development

```powershell
node --test "test/**/*.test.mjs"   # 8 tests, no credentials needed
node src/server.mjs                # start (requires PUSH_RELAY_TOKEN)
```

## Not verifiable without devices

- Real APNs/FCM/UnifiedPush delivery, and APNs token-auth against Apple.
- Background notifications currently use generic call/message labels. An iOS
  Notification Service Extension would be needed to fetch and display sender or
  message details before the user opens the app.

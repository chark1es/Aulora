# Aulora push relay (stub)

Status: **not implemented.** This directory is a placeholder for the optional
service described in `plan.md` ("Realtime and notifications" → project push
relay), targeted at **Phase 5**. Nothing here runs yet.

## What it will be

iOS and stock Android only deliver push through APNs and FCM. The relay exists
so users do not have to build and sign their own apps just to get mobile push:

- Holds the **project's** APNs key and FCM credentials for official store
  builds, like Mattermost's HPNS.
- Forwards **content-free wakeups only**: an opaque server id, channel id and
  message id. No message text — Aulora is end-to-end encrypted and the server
  never sees plaintext.
- Self-hosters building their own apps point them at their own relay.

## Compose profile

`docker-compose.yml` ships a `push-relay` service behind the `push-relay`
profile, **off by default**:

```powershell
docker compose --profile push-relay up -d   # starts the inert stub
```

Today that service just prints a notice and idles. When the real image exists,
swap its `image:`/`build:` and keep the profile gate.

## Deliberately not done yet

- No APNs/FCM client, no token storage, no HTTP API.
- No key material in this repo.

See `../docker/README.md` for how the rest of the stack is run.

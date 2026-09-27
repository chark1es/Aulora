# Deploying the new backend to the test server

The web/desktop UI now uses backend functions that the running test server does
not have yet:

- `channels.create` gained a `private` argument
- `channels.addMember` / `channels.removeMember` (private-channel membership)
- `channels.list` / `channels.get` return `isPrivate` and hide private channels
  from non-members
- the `channels` table gained an optional `private` field

Until the server is redeployed, the client degrades gracefully: creating a
private channel falls back to a public one, and add/remove member are no-ops.
Everything else (roles, settings, context menus, modals, animations) works
already.

## On the Windows host (where the Convex backend runs)

```powershell
# 1. Mint the admin key from the backend container (a new key per call; the
#    latest is the one to use).
cd <aulora repo>
docker compose exec -T backend ./generate_admin_key.sh

# 2. Point the CLI at the self-hosted backend and deploy.
cd packages\convex
$env:CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
$env:CONVEX_SELF_HOSTED_ADMIN_KEY='<instance>|<key from step 1>'
bunx convex deploy --yes
```

## Or, if SSH to the Windows host is opened

From the Mac:

```bash
ssh charl@daphokingpc
# then run the two-step block above on Windows, or from the Mac with the key:
cd packages/convex
CONVEX_SELF_HOSTED_URL='http://localhost:3210' \
CONVEX_SELF_HOSTED_ADMIN_KEY='<instance>|<key>' \
  bunx convex deploy --yes
```

## Verify

```bash
curl -s -X POST http://localhost:3210/api/mutation \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <owner JWT>" \
  -d '{"path":"channels:create","args":{"kind":"text","nameCiphertext":"dGVzdA==","private":true},"format":"json"}'
```

A success (not `extra field`) means the new backend is live.

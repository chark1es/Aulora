# PR-Agent evaluation sample

This standalone sample exercises PR review quality. Application code never
imports it. The draft evaluation PR must not merge or deploy.

The helpers implement these policies:

- Channel reads require a member of the same workspace. Public channels are
  visible to all workspace members. Private channels are visible only to the
  member IDs listed on that channel.
- `UPLOAD_MAX_BYTES` specifies bytes. A valid positive value sets the upload
  limit to that exact number. Invalid values use 25 MiB.
- Notifications include message text only when the member enables previews.
  When previews are disabled, the notification says `New message`.

The sample deliberately contains defects. Expected findings are recorded
outside this PR so the reviewer must identify the failure conditions itself.

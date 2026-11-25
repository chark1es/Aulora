## Aulora 1.8.0

### Calls

- Workspace administrators can join a scheduled call before it opens. The call
  stays scheduled for everyone else and opens at the normal time, and a room
  is no longer closed by the solo-call timeout before its scheduled end.
- Scheduled calls can be invite-only. Administrators, the creator, invitees
  and members a host admits can join; guest links still work.
- A waiting room for early arrivals: invited members wait and are moved in
  when the call opens, and uninvited members can ask to join. Hosts admit or
  decline them from the call or the Scheduled tab.
- The title, time, duration, invitees and invite-only setting can be edited
  after a scheduled call has started.
- Starting a call in a voice channel no longer bypasses a live scheduled
  call's open time or invite list.

### Transcription

- Parakeet TDT 0.6B v3 replaces faster-whisper. It runs on CPU without
  PyTorch, supports 25 European languages with punctuation, and catches short
  replies the old filters dropped. Audio is now cut at natural pauses instead
  of every 2 seconds.
- A live transcript panel can be opened during a transcribed call.
- Summaries now include an AI-written title. The session starter or a
  transcription manager can rename the call, edit the summary and correct
  transcript lines.
- A "Transcription ended" notice links straight to the transcript.

### Bots

- AI assistants such as Claude Code or Cursor can manage bot code through an
  MCP server at `/api/mcp`, using scoped, expiring tokens created in Workspace
  settings → Bots → MCP access. A token never has more access than its creator.
- Bot accounts are no longer offered as people in the call, DM, channel and
  kanban pickers. The server rejects bots as scheduled-call invitees.

### Fixes

- Choosing the OpenAI-compatible summaries provider in Admin → Transcription no
  longer shifts the app layout.

### Upgrade notes

- No data migration, discovery API change or minimum-client increase is
  required. Discovery API version remains **1**. Schema changes are additive
  (`botMcpTokens`, `scheduledCallWaiting`, optional fields).
- Transcription: a saved Whisper model shows as **not installed** after the
  upgrade. The owner downloads Parakeet (about 650 MB, roughly 1–1.5 GB of RAM)
  once from Workspace settings → Addons → Transcription. The old
  `faster-whisper-*` model folders are deleted on startup. `WHISPER_DEVICE` and
  `WHISPER_COMPUTE_TYPE` are removed; the optional `TRANSCRIBER_THREADS` sets
  the engine's CPU threads.
- Reverse proxies must route `/api/mcp` to the Convex HTTP-actions port
  (`3211`). The bundled nginx template, Traefik labels and Caddy example are
  updated; operators with their own proxy need to add the route.
- Older clients that try to invite a bot to a scheduled call now get an error.
- Coolify deployments set their Branch field to `v1.8.0`.

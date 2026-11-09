# Transcription

Aulora can transcribe calls with per-speaker attribution and build an optional
LLM summary. The addon is **off by default** and needs a separate, optional
`transcriber` container. Calls themselves work without it.

Transcription is not a recording. The server never receives call audio as a
stream to store: each participant's own client captures its microphone,
converts it to 16 kHz mono PCM16, and sends it over a WebSocket to the
transcriber. The transcriber turns it into text and posts finished segments back
to Convex. Audio is processed in memory and is not written to disk.

## What it does and does not protect

Be clear about the trust model before enabling it:

- The **transcriber container sees the call audio** of every participant who has
  not opted out. It is self-hosted, but it is a separate service with its own
  process and logs.
- The **summary endpoint** (OpenRouter or any OpenAI-compatible API) receives
  the transcript text. It does not receive audio.
- **Transcript text and summaries are sealed at rest** with the workspace
  encryption key, like messages and notes. They are readable only through
  Convex functions that check `View transcripts`.
- A person who shares one physical microphone with someone else cannot be
  separated; both voices arrive as one stream.
- A muted participant sends nothing. A participant may opt out of sending their
  own audio; their speech is then simply absent from the transcript.
- Guests see the transcription indicator and opt-out notice, but guests never
  get read access to a transcript.

## Permissions

| Permission | Allows |
| --- | --- |
| Start transcription | Start and stop transcription in a call the member is in. |
| View transcripts | Read transcripts and summaries, and request a (re)summary. |
| Manage transcription | Configure the addon, choose/download the model, set the LLM endpoint and key, change retention, delete transcripts. |

Owners and administrators hold all three implicitly. No role gets them by
default. Starting a call never grants read access, and channel visibility is not
enough: a participant without **View transcripts** sees no content even for a
call they attended.

## Enable it

1. Start the optional container on the server:

   ```sh
   cd infra/docker
   docker compose --profile transcription up -d --build transcriber
   ```

   `setup` generates `TRANSCRIBER_TOKEN` and persists it in `.env`. The
   transcriber is non-root, read-only, and joins only a dedicated network shared
   with Convex.

2. In **Workspace settings → Addons**, turn on **Transcription**.
3. Choose a model (`tiny`, `base`, `small`, `medium`, `large-v3-turbo`) and
   click **Download**. The model is fetched into the `transcriber-models`
   volume; no model is baked into the image. The addon stays unusable until the
   status is **Ready**.
4. Optionally configure a summary endpoint: base URL, API key and model. Use
   **Test connection** to validate them. The key is sealed and never returned to
   any client. OpenRouter defaults to `https://openrouter.ai/api/v1`.
5. Grant **Start transcription** to the roles that should be able to start it,
   and **View transcripts** to the roles that should read it.

If the profile is not running, the addon reports **Transcription service not
installed** and stays unusable. Nothing else is affected. The installer always
generates `TRANSCRIBER_TOKEN`, so the status reflects a live service, not just
that secret: the container reports in at startup and about once a minute, and
the addon shows installed only while those reports are recent. On a fresh
server, run `setup` (or otherwise set `TRANSCRIBER_TOKEN`) before starting the
`transcription` profile, or the container cannot authenticate its calls.

A dropped audio connection reconnects on its own; a quick reconnect replaces
the previous socket for that participant instead of being refused as a second
stream. Treat a "too many streams" close as retryable, but a close with code
`4411` as final: the server rejected this audio permanently (the call ended or
your seat was removed) and the client stops instead of reconnecting.
**Start transcription** also stays unavailable until the service has reported
in, even when a model is already marked ready.

Restarting the transcriber reloads the last model that reached **Ready**; if no
choice has been saved yet it tries the smallest cached model first, so a small
host does not run out of memory on a larger one. The addon updates itself from
the next heartbeat and keeps the model you configured. A failed download of a
different size leaves the current model running and shows a quiet notice. A
mute or a network drop appears as a pause in the transcript timeline instead of
compressing later speech: a partial fragment before the pause is transcribed
with its own start time. When a participant ends, times out or drops, the
remaining buffered speech is transcribed and saved once instead of being lost;
a quick reconnect continues the same speaker sequence, and the old connection's
final audio is always posted in order behind the replacement's batches (or
accepted as a bounded late arrival), so a reconnect does not drop a segment.

## During a call

A member with **Start transcription** starts it from the call. Every participant
— including guests — sees an indicator and a notice, and can opt out of sending
their own audio. The server rejects audio tokens for anyone who is not in the
call or whose session has ended. A call ends the session automatically when it
ends or its last participant leaves.

Segments are capped per session, and an empty or hallucinated filler result is
dropped by voice-activity detection and a no-speech threshold.

## Summaries and SSRF

After a session ends, the backend builds a summary through an internal action.
The transcript is treated as **untrusted data**: it goes inside a delimited data
block, the model is told never to follow instructions found in it, and the
returned JSON is validated and length-limited before it is shown. Long
transcripts are map-reduced in chunks.

The summary endpoint must use `https` by default. Loopback (`localhost`,
`127.x`, `::1`), link-local and cloud-metadata addresses (including
`169.254.169.254`) are **always refused**, whatever the settings say. Private LAN
addresses (`192.168.x.x`, `10.x.x.x`, `172.16.x.x` to `172.31.x.x`) and names
such as `host.docker.internal` are refused unless the owner ticks **Allow
private network endpoint** (for an Ollama on another machine or an intranet
gateway); that option never makes `localhost` work. Plain `http` is accepted
only for those private/intranet endpoints when the option is on; a public host
must always use `https`, so the API key and transcript are never sent in
cleartext across the public internet. Redirects to another host are refused,
responses have a size cap and a timeout, and upstream error bodies are never
echoed.

Residual limit: the action cannot resolve a hostname before fetching, so a
public name that points at a private address is not pre-screened. An owner with
**Manage transcription** is the only person who can set the endpoint, so this is
an owner-controlled setting, not an anonymous one.

## Retention

The default retention is 30 days; `0` keeps transcripts until someone deletes
them. A daily cron purges expired transcripts and their segments. Deleting a
transcript deletes its segments and summary. Limit values are in the Addons
card and enforced by the server.

## Operator reference

| Variable | Purpose |
| --- | --- |
| `TRANSCRIBER_TOKEN` | Shared secret generated by `setup`; also derives the audio-token HMAC key. Never sent to clients. |
| `TRANSCRIBER_URL` | Internal origin Convex calls to request a model download (default `http://transcriber:8787`). |
| `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE` | Engine device and precision; CPU int8 by default. |
| `TRANSCRIBER_MAX_STREAMS` | Concurrent streams per session. One live stream per participant is a fixed rule: a reconnect replaces the old socket. |
| `TRANSCRIBER_PREAUTH_MAX_CONNECTIONS` | Sockets that may sit unauthenticated at once. |
| `TRANSCRIBER_MEMORY_LIMIT` / `TRANSCRIBER_CPUS` | Container resource ceiling. |

The web container proxies `wss://<SITE_URL>/transcribe/ws` to the transcriber.
Long-lived WebSockets are allowed to idle; an edge proxy must not enforce a
short idle timeout.

See the [API handoff](https://github.com/chark1es/Aulora/blob/main/docs/call-addons-api.md)
in the repository for the exact WebSocket frame format and close codes.

## Using it in the app

### Set it up (Workspace settings → Addons)

Turn on **Transcription** under **Calls**, then open the Transcription card that
appears. People with **Manage transcription** (not only **Manage workspace**) can
see and change that card.

1. **Speech model.** Pick a size and choose **Download**. The row shows *Not
   downloaded*, a progress bar while it downloads (a moving bar with no percentage
   when the service cannot report one), *Ready*, or *Download failed* with the
   reason and **Try again**. If a later download of a different model fails while
   the current model stays ready, a quiet notice says so and nothing else changes. If the container restarts
   mid-download, the card clears the stuck progress and reports **The download
   was interrupted**, with **Try again** enabled. If the card says **Transcription service
   not installed**, the optional `transcriber` container is not running: start it
   with the `transcription` compose profile first. Download stays disabled until
   then.
2. **Summaries.** Choose **OpenRouter** or **OpenAI-compatible**, set the base
   URL, the API key and the model. The key field is write-only: once saved, the
   card only says *A key is saved* and offers **Replace** and **Remove**. The
   server never sends the key back, so it cannot be shown or copied from the
   browser. **Test connection** checks the address, key and model currently in
   the form, even before you save, and reports the outcome without echoing the key.
3. **Allow private network endpoint.** Off by default. Turning it on asks for
   confirmation and leaves a warning on the card, because your server can then
   send transcript text and the API key to private addresses inside your network,
   such as `192.168.x.x`, `10.x.x.x` or `host.docker.internal`. Use it only for a
   service you run. Loopback (`localhost`), link-local and cloud-metadata
   addresses are always refused, with or without this option, and the form says
   so before you save.
4. **Retention.** Days before transcripts are deleted automatically; `0` keeps
   them until someone deletes them.

Press **Save changes** at the bottom of the page. **Discard** puts the form back
to what is stored.

### In a call

Members with **Start transcription** see a **Start transcription** control
beside the microphone and camera. It only appears when the addon is on, the
transcriber service is installed and running with its engine loaded, and a
model is ready. The running container must report a loaded engine: a downloaded
model alone is not enough after a restart or a lost models volume. Starting it
turns the control into the live orb; pressing it again
stops transcription. While a session is running, **Stop** stays available to
anyone with **Start transcription** even if the addon was switched off or the
model removed in the meantime (switching the addon off also ends running
sessions). After **Stop**, or after the last person leaves, audio already
buffered is still transcribed for up to about 30 seconds so the final words are
not lost; no summary is written until that window closes. Switching the addon
off is immediate and does not grant that window. The call header shows a
**Transcribing** badge, and the call dock shows the orb.

Everyone in the call, **including guests**, sees a notice while transcription
runs:

- *This call is being transcribed*, with what that means for your own audio;
- **Opt out**, which keeps your own audio out of the transcript for this
  session. The notice then says your speech is not sent or transcribed, and
  **Include my audio** undoes it.

When transcription starts, the notice appears first and your audio is sent only
after a few seconds, so you can opt out before anything leaves your device. Audio
is sent only while your microphone is live: muting, deafening, releasing a
push-to-talk key, leaving the call, opting out or the session ending all stop it
at once. If the connection to the transcriber drops, the client reconnects with
increasing delays and tells you; your speech is not captured while it is
reconnecting. If the same person is already streaming from another device or
tab, the newest connection takes over and the older one is told it was replaced:
it pauses (it does not reconnect on its own) and says so, and unmuting, pressing
push-to-talk or choosing **Resume** takes the stream back, which pauses the other
one in turn. If the server says the session is over (it ended, or this person was removed), the client stops sending and does not reconnect; no error is shown. A client that keeps being disconnected without a reason also pauses
after a few quick reconnects instead of looping. A participant who is opted out is never captured at all.

The orb is an animated indicator with the label *Transcription is on* and a
tooltip. With **reduced motion** turned on in your system settings it is frozen
instead of animated.

### Transcripts

People with **View transcripts** get a **Transcripts** entry in the sidebar.
Choose a call to read it:

- the **summary** (overview, key points, decisions, action items with owners and
  speaker highlights), with **Generate summary** or **Regenerate** once the call
  has ended. Without a summary service (no API key) it says *No summary service
  configured* instead, with a pointer to Workspace settings > Addons >
  Transcription for people who can change it; that is not an error. While it is
  being written it says *Writing the summary…*, and after about ten minutes it
  offers **Regenerate**. **Generate summary** is unavailable while the call is
  still being transcribed or while its final audio window is closing. Asking
  again while a summary is already being written
  is ignored, and an older attempt that finishes late never overwrites a newer
  finished summary. Summaries are model output derived from what people said:
  they are shown as plain text and can be wrong;
- the **transcript**, labelled by speaker with a time offset, with a **Guest**
  badge for guests, loaded a page at a time with **Load more**;
- **Delete**, for people with **Manage transcription**. A live transcript cannot
  be deleted until it has stopped.

Starting a call, attending it, or being able to see its channel does not give
access to its transcript.

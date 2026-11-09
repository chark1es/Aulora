# Transcriber (optional)

Speech-to-text for the optional transcription addon. It is **not started by
default**; use the compose profile:

```sh
cd infra/docker
docker compose --profile transcription up -d --build transcriber
```

It receives each participant's own microphone as 16 kHz mono PCM16 over
`/transcribe/ws`, verifies a Convex-minted audio token, runs faster-whisper on
CPU with int8 and VAD, and posts finished segments to Convex over the
shared-secret `/transcription/ingest` route. Audio is processed in memory and is
never written to disk.

Models are downloaded on demand into the `transcriber-models` volume by
allowlisted id (`tiny`, `base`, `small`, `medium`, `large-v3-turbo`); no model is
baked into the image. Convex asks for a download when the owner clicks
**Download** in Workspace settings → Addons.

Environment (all set by compose; `setup` generates the token):

| Variable | Default |
| --- | --- |
| `TRANSCRIBER_TOKEN` | required, shared with Convex |
| `CONVEX_INGEST_URL` | `http://convex-backend:3211/transcription/ingest` |
| `CONVEX_MODEL_STATUS_URL` | `http://convex-backend:3211/transcription/model` |
| `MODELS_DIR` | `/models` |
| `WHISPER_DEVICE` | `cpu` |
| `WHISPER_COMPUTE_TYPE` | `int8` |
| `TRANSCRIBER_MAX_STREAMS` | `32` |

The container is non-root, read-only, drops all capabilities, and joins only a
network shared with `convex-backend`. Run its tests with:

```sh
cd infra/transcriber
python3 -m unittest discover -s test -p 'test_*.py'
```

The exact WebSocket frame format and close codes are in
[`docs/call-addons-api.md`](../../docs/call-addons-api.md).

# Transcriber (optional)

Speech-to-text for the optional transcription addon. The container starts with
the stack; models are downloaded only when requested in Workspace settings.
To start it separately after updating an existing installation:

```sh
cd infra/docker
docker compose up -d --build transcriber
```

It receives each participant's own microphone as 16 kHz mono PCM16 over
`/transcribe/ws`, verifies a Convex-minted audio token, runs NVIDIA Parakeet TDT
0.6B v3 (multilingual, 25 European languages, punctuation and capitalization
built in) through `onnx-asr` on CPU with int8 weights, and posts finished
sentence segments to Convex over the shared-secret `/transcription/ingest`
route. Audio is processed in memory and is never written to disk.

The model is downloaded on demand into the `transcriber-models` volume by its
allowlisted id (`parakeet-tdt-0.6b-v3`, files pinned to one upstream revision);
nothing is baked into the image. Convex asks for a download when the owner
clicks **Download** in Workspace settings → Addons. Plan for about 650 MB of disk
and 1-1.5 GB of RAM once loaded (the compose default limit is 2g). At startup the
service also deletes the faster-whisper caches earlier releases left in the
volume and ignores a legacy Whisper id in `.selected`.

Audio is not cut on a fixed timer. Each stream is buffered and sent to the
engine at a pause: at least 1.8 s of audio ending in 0.5 s of silence (measured
relative to the speaker's own level, above an absolute floor). A window is forced
at 20 s, at the quietest 100 ms in the last 1.5 s, and the remainder starts the
next window. A window that is entirely near-silent is skipped. No phrase
blacklist or no-speech filter is applied, so short real utterances are kept.
Tunables are the constants at the top of `app/segments.py` and `app/engine.py`.

Environment (all set by compose; `setup` generates the token):

| Variable | Default |
| --- | --- |
| `TRANSCRIBER_TOKEN` | required, shared with Convex |
| `CONVEX_INGEST_URL` | `http://convex-backend:3211/transcription/ingest` |
| `CONVEX_MODEL_STATUS_URL` | `http://convex-backend:3211/transcription/model` |
| `MODELS_DIR` | `/models` |
| `TRANSCRIBER_THREADS` | unset (onnxruntime default); intra-op threads per session |
| `TRANSCRIBER_MAX_STREAMS` | `32` |

The container is non-root, read-only, drops all capabilities, and joins only a
network shared with `convex-backend`. Run its tests with:

```sh
cd infra/transcriber
python3 -m unittest discover -s test -p 'test_*.py'
```

The exact WebSocket frame format and close codes are in
[`docs/call-addons-api.md`](../../docs/call-addons-api.md).

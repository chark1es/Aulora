## Aulora 1.7.1

### Fixes

- Fix transcription model downloads, which failed every time with "Could not
  download or load the model". The transcriber image had picked up
  `huggingface_hub` 2.x, which no longer installs `requests`, a package
  `faster-whisper` imports. The model-loading dependencies are now pinned, the
  image build fails if they cannot be imported, and the transcriber logs the
  underlying cause when a download fails.
- Correct the "Transcription service not installed" notice. It no longer
  refers to a `transcription` Compose profile (the transcriber has started
  with the stack since 1.6.2) and explains how to reconnect the service.

### Upgrade notes

- No schema migration, discovery API change or minimum-client increase is
  required. Discovery API version remains **1**. Existing clients remain supported.
- Update the server to pick up the new `aulora-transcriber` image, then retry
  the model download in Workspace settings. Coolify deployments set their
  Branch field to `v1.7.1`.

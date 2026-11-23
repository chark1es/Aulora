# syntax=docker/dockerfile:1.7
#
# Transcription service (starts by default, models download on demand).
#
# It receives 16 kHz mono PCM16 frames over a WebSocket from each participant's
# own client, runs NVIDIA Parakeet TDT 0.6B v3 (ONNX int8, via onnx-asr) on CPU
# over utterance-aware windows, and posts finished speaker-labelled segments to
# Convex over the shared-secret ingest route. The image holds no model: the
# owner downloads the allowlisted model (about 650 MB, 1-1.5 GB RAM when
# loaded) into the `transcriber-models` volume from Workspace settings. At run
# time the service writes only to that volume (model files, `.selected`).
FROM python:3.12-slim


ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MODELS_DIR=/models \
    HF_HOME=/models/hf-cache \
    XDG_CACHE_HOME=/models/hf-cache

# No system packages are needed: the onnxruntime CPU wheel brings its own
# thread pool (it does not link libgomp), and numpy wheels are self-contained.
RUN groupadd --system --gid 10002 transcriber \
  && useradd --system --uid 10002 --gid transcriber \
    --home-dir /home/transcriber --create-home transcriber \
  && mkdir -p /app /models/hf-cache \
  && chown -R transcriber:transcriber /app /models /home/transcriber

WORKDIR /app
COPY infra/transcriber/requirements.txt ./requirements.txt
# Fail the build, not the first model download, when the model-loading stack
# cannot import (for example a dependency dropped by an upstream release).
RUN pip install --no-cache-dir -r requirements.txt \
  && python -c "import onnx_asr, huggingface_hub, numpy"

COPY --chown=transcriber:transcriber infra/transcriber/app ./app

USER transcriber
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

# OCI metadata. The release workflow passes the version and commit; local
# builds keep the defaults. Declared last so a new commit
# does not invalidate the cached layers above.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="aulora-transcriber" \
      org.opencontainers.image.source="https://github.com/chark1es/Aulora" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

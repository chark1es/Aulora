# syntax=docker/dockerfile:1.7
#
# Optional transcription engine (compose profile `transcription`).
#
# It receives 16 kHz mono PCM16 frames over a WebSocket from each participant's
# own client, runs faster-whisper on CPU with int8 and its built-in VAD, and
# posts finished speaker-labelled segments to Convex over the shared-secret
# ingest route. The image holds no model: the owner downloads one allowlisted
# model into the `transcriber-models` volume from Workspace settings.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MODELS_DIR=/models \
    HF_HOME=/models/hf-cache \
    XDG_CACHE_HOME=/models/hf-cache \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8

# ctranslate2 (faster-whisper's backend) needs the GNU OpenMP runtime, which
# python:3.12-slim does not ship.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10002 transcriber \
  && useradd --system --uid 10002 --gid transcriber \
    --home-dir /home/transcriber --create-home transcriber \
  && mkdir -p /app /models/hf-cache \
  && chown -R transcriber:transcriber /app /models /home/transcriber

WORKDIR /app
COPY infra/transcriber/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=transcriber:transcriber infra/transcriber/app ./app

USER transcriber
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

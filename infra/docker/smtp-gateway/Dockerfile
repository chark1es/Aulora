FROM python:3.13-alpine
WORKDIR /app
COPY infra/docker/smtp-gateway/server.py /app/server.py
USER 65532:65532
EXPOSE 8787
CMD ["python", "/app/server.py"]

# OCI metadata. The release workflow passes the version and commit; local
# builds keep the defaults. Declared last so a new commit
# does not invalidate the cached layers above.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="aulora-smtp-gateway" \
      org.opencontainers.image.source="https://github.com/chark1es/Aulora" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

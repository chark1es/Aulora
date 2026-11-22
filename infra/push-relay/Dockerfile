# Aulora push relay. Dependency-free Node service; no build step needed.
FROM node:22.23.4-alpine


WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PUSH_RELAY_PORT=8790
EXPOSE 8790

# The relay needs no writable filesystem and no root.
USER node

CMD ["node", "src/server.mjs"]

# OCI metadata. The release workflow passes the version and commit; local
# builds keep the defaults. Declared last so a new commit
# does not invalidate the cached layers above.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="aulora-push-relay" \
      org.opencontainers.image.source="https://github.com/chark1es/Aulora" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

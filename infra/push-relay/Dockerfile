# Aulora push relay. Dependency-free Node service; no build step needed.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PUSH_RELAY_PORT=8790
EXPOSE 8790

# The relay needs no writable filesystem and no root.
USER node

CMD ["node", "src/server.mjs"]

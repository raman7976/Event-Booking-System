# ─── Backend image: Express API, Socket.io server, and BullMQ workers ───
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source + SQL migrations (so `npm run migrate` works inside the image)
COPY src ./src
COPY migrations ./migrations
# Bus knowledge-base docs (so `npm run ingest:bus` works inside the image)
COPY docs ./docs

ENV NODE_ENV=production
# Default port; overridden per-instance via compose (3000 / 3001)
ENV PORT=3000
EXPOSE 3000

# wget (busybox) is used by the compose healthchecks; present in node:alpine.
# Entrypoint branches on SERVICE_ROLE (web|worker); defaults to web (migrate+serve).
CMD ["node", "src/start.js"]

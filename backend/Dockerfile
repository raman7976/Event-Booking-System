# ─── Backend image: Express API, Socket.io server, and BullMQ workers ───
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source
COPY src ./src

ENV NODE_ENV=production
# Default port; overridden per-instance via compose (3000 / 3001)
ENV PORT=3000
EXPOSE 3000

# wget (busybox) is used by the compose healthchecks; present in node:alpine.
CMD ["node", "src/server.js"]

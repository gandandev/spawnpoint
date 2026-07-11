FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    MC_MEMORY_MB=768 \
    MC_IDLE_MINUTES=15
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-runtime ./server-runtime
RUN mkdir -p /data && chown -R node:node /app /data
EXPOSE 3000
CMD ["sh", "-c", "chown -R node:node /data && exec gosu node node dist/server/index.js"]

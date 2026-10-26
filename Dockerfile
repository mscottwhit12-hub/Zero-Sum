# Zero-Sum — single container: Fastify + Socket.IO server serving the built Svelte client.
# Build needs internet (npm); runtime needs none (LAN only, every asset is bundled).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain for better-sqlite3 in case no prebuilt binary matches this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/sim/package.json packages/sim/
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && rm -rf packages/*/test packages/sim/reports

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    MEDIA_DIR=/media
COPY --from=build /app /app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data /media && chown node:node /data /media
EXPOSE 8080
VOLUME ["/data", "/media"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "packages/server/src/main.ts"]

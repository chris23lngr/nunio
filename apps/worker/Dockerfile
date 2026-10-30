# Temporal worker image (ADR-0004). Shape from turborepo examples/with-docker, adapted to Bun.
# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM runtime AS tools
COPY --from=oven/bun:1.3.14-debian /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Only the worker and the workspace packages it depends on.
FROM tools AS pruner
COPY . .
RUN bunx turbo@2.11.10 prune @nunio/worker --docker

# Compiles the worker and prebuilds its workflow bundle.
FROM tools AS builder
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bunx turbo run build --filter=@nunio/worker

# Runtime dependencies only.
FROM tools AS deps
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile --production --filter @nunio/worker
# Temporal's core bridge ships prebuilt binaries for every platform; a Linux image needs only Linux.
RUN rm -rf node_modules/.bun/@temporalio+core-bridge@*/node_modules/@temporalio/core-bridge/releases/*-apple-darwin \
  node_modules/.bun/@temporalio+core-bridge@*/node_modules/@temporalio/core-bridge/releases/*-windows-msvc

FROM runtime
COPY --from=deps --chown=node:node /app .
COPY --from=builder --chown=node:node /app/apps/worker/dist ./apps/worker/dist
USER node
# node directly, so SIGTERM reaches the worker, which drains for SHUTDOWN_GRACE_SECONDS.
CMD ["node", "apps/worker/dist/index.js"]

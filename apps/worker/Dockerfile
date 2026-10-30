# Temporal worker image (ADR-0004). Shape from turborepo examples/with-docker, adapted to Bun.
# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.3.14-debian /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app

# Only the worker and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN bunx turbo@2.11.10 prune @nunio/worker --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bunx turbo run build --filter=@nunio/worker

FROM base AS runner
COPY --from=builder --chown=node:node /app .
USER node
# node directly, so SIGTERM reaches the worker, which drains for SHUTDOWN_GRACE_SECONDS.
CMD ["node", "apps/worker/dist/index.js"]

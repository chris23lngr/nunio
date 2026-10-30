# Parser image (ADR-0009). Shape from turborepo examples/with-docker, adapted to Bun.
# Build from the repo root: docker build -f apps/parser/Dockerfile .
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM runtime AS tools
COPY --from=oven/bun:1.3.14-debian /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Only the parser and the workspace packages it depends on.
FROM tools AS pruner
COPY . .
RUN bunx turbo@2.11.10 prune @nunio/parser --docker

# Compiles the parser.
FROM tools AS builder
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bunx turbo run build --filter=@nunio/parser

# Runtime dependencies only.
FROM tools AS deps
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile --production --filter @nunio/parser

FROM runtime
COPY --from=deps --chown=node:node /app .
COPY --from=builder --chown=node:node /app/apps/parser/dist ./apps/parser/dist
USER node
# node directly, so SIGTERM reaches the server.
CMD ["node", "apps/parser/dist/index.js"]

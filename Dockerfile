# syntax=docker/dockerfile:1
# One image, two entry points: `worker` and `gateway` (BLUEPRINT M00, PROPOSAL §10).
# Build: docker build -t ads-agent:local .    Run: see docker-compose.yml.
ARG NODE_IMAGE=node:24.21.0-trixie-slim

# ---- base: Node + pnpm (versions pinned; see docs/memory/GOTCHAS.md) ----
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.34.5 && npm cache clean --force

# ---- build: install, compile, and prune each app to its production files ----
FROM base AS build
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@ads/app-worker... --filter=@ads/app-gateway...
RUN pnpm deploy --legacy --filter=@ads/app-worker --prod /out/worker \
 && pnpm deploy --legacy --filter=@ads/app-gateway --prod /out/gateway

# ---- doppler: the secrets CLI, checksum-verified ----
FROM ${NODE_IMAGE} AS doppler
ARG DOPPLER_VERSION=3.76.6
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    file="doppler_${DOPPLER_VERSION}_linux_${TARGETARCH:-amd64}.tar.gz"; \
    base="https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}"; \
    cd /tmp; \
    curl -fsSLO --retry 3 "${base}/${file}"; \
    curl -fsSL --retry 3 "${base}/checksums.txt" | grep " ${file}\$" | sha256sum -c -; \
    tar -xzf "${file}" doppler; \
    install -m 0755 doppler /usr/local/bin/doppler; \
    doppler --version

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DOPPLER_ENABLE_VERSION_CHECK=false \
    DOPPLER_CONFIG_DIR=/tmp/doppler
COPY --from=doppler /usr/local/bin/doppler /usr/local/bin/doppler
COPY --from=build --chown=node:node /out/worker /app/worker
COPY --from=build --chown=node:node /out/gateway /app/gateway
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/ads-entrypoint
USER node
WORKDIR /app
ENTRYPOINT ["ads-entrypoint"]
CMD ["worker"]

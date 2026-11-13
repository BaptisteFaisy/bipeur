# Beeper — Central + pager in one container (BIP-N-09: one process, one
# SQLite file, one URL; image target < 200 MB).
#
# Build:  docker build -t bipeur-central .
# Run:    docker run -d -p 8787:8787 -v bipeur-data:/data bipeur-central
# Or use docker-compose.yml (recommended): docker compose up -d --build

# --- build stage ------------------------------------------------------------
FROM node:24-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

RUN corepack enable

# The context is filtered by .dockerignore (no .git, no node_modules, no dist).
COPY . .

# Frozen lockfile, workspace build (pager dist included), then a self-contained
# production bundle of the Central: `pnpm deploy --legacy --prod` resolves the
# workspace links (including @bipeur/core) into one directory with production
# dependencies only — no dev tooling ever reaches the runtime stage.
RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && pnpm --filter @bipeur/central --prod deploy --legacy /deploy \
    && find /deploy /app/packages/pager/dist \
        \( -name '*.map' -o -name '*.d.ts' -o -name '*.tsbuildinfo' \) -delete

# --- runtime stage ----------------------------------------------------------
# The production tree is pure JavaScript (node:sqlite, no native build — the
# BIP-N-09 dependency policy), so the runtime only needs a Node binary on a
# bare Alpine: no npm, no corepack, no headers. `nodebase` supplies the musl
# Node binary built for the very same Alpine release, which keeps the image
# under the 200 MB target (BIP-N-09).
FROM node:24-alpine AS nodebase

# Debug symbols are useless in production: stripping keeps the final image
# under the 200 MB target. `node --version` proves the binary still runs.
RUN apk add --no-cache binutils \
    && strip --strip-all /usr/local/bin/node \
    && node --version

FROM alpine:3.24 AS runtime

ENV NODE_ENV=production \
    BIPEUR_HOST=0.0.0.0 \
    BIPEUR_PORT=8787 \
    BIPEUR_DB=/data/bipeur.sqlite \
    BIPEUR_RULES=/app/.bipeur/rules.yaml
WORKDIR /app

# libstdc++ for V8, ca-certificates for Web Push over TLS; unprivileged user;
# /data holds the single SQLite file.
RUN apk add --no-cache libstdc++ ca-certificates \
    && addgroup -S node && adduser -S node -G node \
    && mkdir -p /data && chown node:node /data

COPY --from=nodebase /usr/local/bin/node /usr/local/bin/node
# The deployed Central: dist + production node_modules, self-contained.
COPY --from=build --chown=node:node /deploy ./packages/central
# static.ts resolves the pager at ../../pager/dist relative to central/dist.
COPY --from=build --chown=node:node /app/packages/pager/dist ./packages/pager/dist
COPY --from=build --chown=node:node /app/.bipeur ./.bipeur
COPY --from=build --chown=node:node /app/deploy/healthcheck.mjs ./deploy/healthcheck.mjs

USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "/app/deploy/healthcheck.mjs"]

CMD ["node", "packages/central/dist/bin.js"]

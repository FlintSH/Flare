# Node.js 25 and later no longer bundle Corepack, which installs pnpm below.
# Stay on Node.js 24 LTS, the version CI uses, rather than the moving node:lts.
# The slim image has no compilers: every native dependency ships a prebuilt
# binary for linux/amd64 and linux/arm64.
FROM node:24-bookworm-slim AS base
WORKDIR /app

# Corepack provisions the exact pnpm version pinned in package.json's
# "packageManager" field, into a cache every user can read. HUSKY=0 stops the
# prepare script from trying to install git hooks, since .git isn't part of
# the build context.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_HOME=/usr/local/corepack
ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1

# Prisma picks its engine by the OpenSSL it finds, when installing and when
# running. The certificates are for TLS to a database, to S3 and from curl.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable pnpm

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

# The postinstall script generates the Prisma client from prisma/. Installing
# also downloads pnpm, which the runtime image copies from here.
RUN pnpm install --frozen-lockfile && chmod -R a+rX /usr/local/corepack

# The same tree without devDependencies, for the runtime image. Pruning the
# finished install keeps the generated Prisma client and downloaded engines.
FROM deps AS prod-deps
RUN pnpm prune --prod --ignore-scripts

FROM deps AS builder

COPY . .

ENV NODE_ENV=production

# Flare's CI checks types in a job of its own and sets this to 1, so its image
# builds don't check them a second time. Leave it unset anywhere else.
ARG FLARE_SKIP_BUILD_TYPECHECK=
# The compiler's cache is no use to a later build, which starts from this
# stage's parent, so it stays out of the layer.
RUN FLARE_SKIP_BUILD_TYPECHECK=$FLARE_SKIP_BUILD_TYPECHECK pnpm build && \
    rm -rf .next/cache

FROM base AS runner

ENV NODE_ENV=production

# start.sh shells out to pnpm as the unprivileged nextjs user. node_modules is
# baked into the image, so pnpm's staleness check is disabled to keep those
# commands from attempting an install at runtime. pnpm 11 no longer reads this
# setting from npm_config_ variables.
ENV pnpm_config_verify_deps_before_run=false

# Layers run from the least to the most often changed, so a build that only
# changes application code reuses everything above the copies below.

# curl for the health check and ffmpeg for the frames that video thumbnails
# and link previews show.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs && \
    mkdir -p /app/uploads && \
    chown nextjs:nodejs /app /app/uploads && \
    chmod 775 /app/uploads

RUN echo '#!/bin/bash' > /entrypoint.sh && \
    echo 'mkdir -p /app/uploads' >> /entrypoint.sh && \
    echo 'chown -R nextjs:nodejs /app/uploads' >> /entrypoint.sh && \
    echo 'chmod 775 /app/uploads' >> /entrypoint.sh && \
    echo 'exec su nextjs -s /bin/bash -c "$*"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# pnpm, downloaded while installing, so the container needs no network access
# to start.
COPY --from=deps /usr/local/corepack /usr/local/corepack

# Each copy sets its owner. A chown over /app afterwards would store every
# file a second time.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start.sh ./start.sh
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# The build's server output without its traced copy of node_modules, which
# the full tree above already holds.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN chmod +x /app/start.sh

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Failed checks don't count for the first 150 seconds: start.sh tries the
# database up to 30 times, and each failed try takes about 2 seconds before
# its 2-second pause, so the wait alone can last 2 minutes before migrations.
HEALTHCHECK --interval=10s --timeout=3s --start-period=150s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Keep release identity available to server-side settings and update checks.
# These come last because a rolling build changes them on every commit.
ARG FLARE_RELEASE_CHANNEL=stable
ARG FLARE_COMMIT_SHA=
ENV FLARE_RELEASE_CHANNEL=$FLARE_RELEASE_CHANNEL
ENV FLARE_COMMIT_SHA=$FLARE_COMMIT_SHA

# The entrypoint script runs as root but switches to nextjs user
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/start.sh"]

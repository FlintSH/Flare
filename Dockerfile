# Stage 1: Dependencies  
FROM node:lts AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Corepack provisions the exact pnpm version pinned in package.json's
# "packageManager" field. HUSKY=0 stops the prepare script from trying to
# install git hooks, since .git isn't part of the build context.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV HUSKY=0
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

RUN pnpm prisma generate

# Stage 2: Builder
FROM node:lts AS builder
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV HUSKY=0
RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Set up environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the application
RUN pnpm build

# Stage 3: Runner
FROM node:lts AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# start.sh shells out to pnpm as the unprivileged nextjs user, so Corepack's
# cache is placed somewhere world-readable and warmed at build time. Otherwise
# pnpm would land in root's cache and the container would need network access on
# every boot. node_modules is baked into the image, so pnpm's staleness check is
# disabled to keep `pnpm start` from attempting an install at runtime.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_HOME=/usr/local/corepack
ENV npm_config_verify_deps_before_run=false
ENV HUSKY=0
RUN corepack enable pnpm

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

# Install curl for healthcheck and OpenSSL for Prisma
RUN apt-get update && apt-get install -y curl openssl && rm -rf /var/lib/apt/lists/*

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads && \
    chown nextjs:nodejs /app/uploads && \
    chmod 775 /app/uploads

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts/start.sh ./start.sh

# Pre-download pnpm into the shared Corepack cache and make it readable by the
# unprivileged runtime user.
RUN corepack install && chmod -R a+rX /usr/local/corepack

# Set correct permissions
RUN chown -R nextjs:nodejs /app
RUN chmod +x /app/start.sh

# Create the entrypoint script that will run as root
RUN echo '#!/bin/bash' > /entrypoint.sh && \
    echo 'mkdir -p /app/uploads' >> /entrypoint.sh && \
    echo 'chown -R nextjs:nodejs /app/uploads' >> /entrypoint.sh && \
    echo 'chmod 775 /app/uploads' >> /entrypoint.sh && \
    echo 'exec su nextjs -s /bin/bash -c "$*"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Add healthcheck
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# The entrypoint script runs as root but switches to nextjs user
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/start.sh"]

# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

# Install dependencies and generate Prisma Client
RUN npm ci
RUN npx prisma generate

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Set up environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install curl for healthcheck and OpenSSL for Prisma
RUN apk add --no-cache curl openssl

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads && \
    chown nextjs:nodejs /app/uploads && \
    chmod 775 /app/uploads

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts/start.sh ./start.sh

# Set correct permissions
RUN chown -R nextjs:nodejs /app
RUN chmod +x /app/start.sh

# Create the entrypoint script that will run as root
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'mkdir -p /app/uploads' >> /entrypoint.sh && \
    echo 'chown -R nextjs:nodejs /app/uploads' >> /entrypoint.sh && \
    echo 'chmod 775 /app/uploads' >> /entrypoint.sh && \
    echo 'exec su-exec nextjs "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Install su-exec for dropping privileges
RUN apk add --no-cache su-exec

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Add healthcheck
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# The entrypoint script runs as root but switches to nextjs user
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/start.sh"] 
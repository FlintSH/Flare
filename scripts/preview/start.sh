#!/bin/sh
set -eu

# Preview startup defaults. PR code can alter these; they are not a security
# boundary for the external gateway or deployment controller.
cd /app
node /preview/seed.cjs --check-environment

# Dependencies and Prisma engines are baked into the image. Never install or
# generate here; startup must also work with runtime egress denied.
export COREPACK_ENABLE_NETWORK=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export pnpm_config_verify_deps_before_run=false
export PRISMA_HIDE_UPDATE_MESSAGE=1
export CHECKPOINT_DISABLE=1
export NEXT_TELEMETRY_DISABLED=1
export METICULOUS_RECORDING_ENABLED=false
unset METICULOUS_BACKEND_RECORDER_MODE NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN

attempt=0
until pnpm prisma migrate deploy; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo 'Preview database initialization failed; refusing to start.' >&2
    exit 1
  fi
  sleep 2
done

node /app/scripts/migrate-config.js
node /app/scripts/hash-file-passwords.js

# Ordinary Flare migrations leave a fresh database ready for first-run setup.
# The deployment controller owns lifetime and deletes app and PostgreSQL state.
exec node /app/server.js

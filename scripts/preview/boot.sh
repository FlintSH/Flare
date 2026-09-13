#!/bin/bash
set -Eeuo pipefail
umask 077

# A trusted external gateway also enforces this deadline. The timer here handles
# ordinary shutdown, startup failures and orphaned deployments without relying on
# a later CI run. PR code inside the container is not trusted to enforce its TTL.
if [[ "${1:-}" != '--supervised' ]]; then
  if [[ ! "${PREVIEW_EXPIRES_AT:-}" =~ ^[0-9]{10}$ ]]; then
    echo 'PREVIEW_EXPIRES_AT must be a Unix timestamp in seconds.' >&2
    exit 1
  fi
  remaining=$((10#$PREVIEW_EXPIRES_AT - $(date +%s)))
  if (( remaining <= 0 )); then
    echo 'Preview has expired; refusing to start.' >&2
    exit 1
  fi
  exec timeout --signal=TERM --kill-after=10s "${remaining}s" "$0" --supervised
fi

cd /app
for pg_bin in /usr/lib/postgresql/*/bin; do
  if [[ -x "$pg_bin/postgres" ]]; then
    export PATH="$pg_bin:$PATH"
    break
  fi
done

# No external DATABASE_URL, session secret or persistent database is accepted.
# Every boot creates a fresh, authenticated database on loopback only.
export PGDATA
PGDATA=$(mktemp -d /tmp/flare-preview-pg.XXXXXX)
password_file=$(mktemp /tmp/flare-preview-password.XXXXXX)
app_pid=''
cleanup() {
  trap - EXIT TERM INT
  if [[ -n "$app_pid" ]]; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  pg_ctl -D "$PGDATA" -m immediate -t 5 -w stop >/dev/null 2>&1 || true
  rm -rf -- "$PGDATA"
  rm -f -- "$password_file"
  if [[ -n "$app_pid" ]]; then
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$password_file"
database_password=$(cat "$password_file")
export DATABASE_URL="postgresql://flare_preview:${database_password}@127.0.0.1:5432/flare_preview?schema=public"
export NEXTAUTH_SECRET
NEXTAUTH_SECRET=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("hex"))')
export FLARE_PR_PREVIEW=true
export FLARE_EMAIL_ENABLED=false
export FLARE_EMAIL_RECOVERY_ENABLED=false
export FLARE_EMAIL_VERIFICATION_MODE=off
export FLARE_EMAIL_CHANGES_ENABLED=false
export FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK=false

# Validate the public URL and disposable environment before database work.
node /preview/seed.cjs --check-environment
initdb -D "$PGDATA" -U flare_preview --pwfile="$password_file" \
  --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C
rm -f -- "$password_file"
pg_ctl -D "$PGDATA" -o '-h 127.0.0.1 -k /tmp -p 5432' \
  -l "$PGDATA/server.log" -w start
PGPASSWORD="$database_password" createdb -h 127.0.0.1 -U flare_preview flare_preview
unset database_password

/bin/sh /preview/start.sh &
app_pid=$!
wait "$app_pid"

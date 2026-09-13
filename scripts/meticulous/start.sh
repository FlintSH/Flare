#!/bin/bash
set -Eeuo pipefail

cd /app
for pg_bin in /usr/lib/postgresql/*/bin; do
  if [[ -x "$pg_bin/postgres" ]]; then
    export PATH="$pg_bin:$PATH"
    break
  fi
done

# Always create fresh state; never consume a production/external DATABASE_URL.
export PGDATA
PGDATA=$(mktemp -d /tmp/flare-meticulous-pg.XXXXXX)
export DATABASE_URL='postgresql://flare@127.0.0.1:5432/flare?schema=public'
app_pid=''
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill -TERM "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

initdb -D "$PGDATA" -U flare --auth=trust --encoding=UTF8 --locale=C
pg_ctl -D "$PGDATA" -o '-h 127.0.0.1 -k /tmp -p 5432' -l "$PGDATA/server.log" -w start
createdb -h 127.0.0.1 -U flare flare
pnpm prisma migrate deploy
node scripts/migrate-config.js
node scripts/meticulous/seed.cjs

/app/start.sh &
app_pid=$!
wait "$app_pid"

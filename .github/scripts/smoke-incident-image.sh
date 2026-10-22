#!/usr/bin/env bash
set -euo pipefail

# This script creates only isolated fixtures. Never supply production settings.
candidate_image=${1:?Pass the local candidate image}
fixture_network=flare-incident-fixture
fixture_db=flare-incident-fixture-db
fixture_app=flare-incident-fixture-app

cleanup() {
  docker rm -fv "$fixture_app" "$fixture_db" >/dev/null 2>&1 || true
  docker network rm "$fixture_network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 24)
export NEXTAUTH_SECRET
NEXTAUTH_SECRET=$(openssl rand -hex 32)
if [[ -n ${GITHUB_ACTIONS:-} ]]; then
  echo "::add-mask::$POSTGRES_PASSWORD"
  echo "::add-mask::$NEXTAUTH_SECRET"
fi
export DATABASE_URL="postgresql://flare_fixture:${POSTGRES_PASSWORD}@${fixture_db}:5432/flare_fixture?schema=public"

docker network create --internal "$fixture_network" >/dev/null
docker run -d --name "$fixture_db" --network "$fixture_network" \
  -e POSTGRES_USER=flare_fixture -e POSTGRES_DB=flare_fixture -e POSTGRES_PASSWORD \
  postgres@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27 >/dev/null

for attempt in {1..30}; do
  if docker exec "$fixture_db" pg_isready -U flare_fixture -d flare_fixture >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec "$fixture_db" pg_isready -U flare_fixture -d flare_fixture

# Use the inherited entrypoint and command, including every startup migration.
docker run -d --name "$fixture_app" --network "$fixture_network" \
  -e DATABASE_URL -e NEXTAUTH_SECRET -e NEXTAUTH_URL=http://127.0.0.1:3000 \
  "$candidate_image" >/dev/null

wait_for_app() {
  for attempt in {1..90}; do
    if docker exec "$fixture_app" curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      return 0
    fi
    if [[ $(docker inspect -f '{{.State.Running}}' "$fixture_app") != true ]]; then
      break
    fi
    sleep 2
  done
  docker logs --tail 100 "$fixture_app"
  return 1
}
wait_for_app

docker exec -i "$fixture_app" node <<'NODE'
const assert = require('node:assert/strict')
;(async () => {
  const health = await fetch('http://127.0.0.1:3000/api/health')
  assert.equal(health.status, 200)
  const body = await health.json()
  assert.equal(body.data.status, 'ok')
  const protectedRead = await fetch('http://127.0.0.1:3000/api/files', {redirect: 'manual'})
  assert.equal(protectedRead.status, 401)
  const invalidImageRequest = await fetch('http://127.0.0.1:3000/_next/image', {redirect: 'manual'})
  assert.equal(invalidImageRequest.status, 400)
  console.log(JSON.stringify({health: 200, unauthenticatedFiles: 401, invalidImageRequest: 400}))
})().catch(error => {console.error(error.message); process.exitCode = 1})
NODE

docker exec -i "$fixture_app" node - verify-initial < .github/scripts/verify-incident-fixture.cjs
docker exec -i "$fixture_app" node - seed-upgrade < .github/scripts/verify-incident-fixture.cjs
docker restart "$fixture_app" >/dev/null
wait_for_app
docker exec -i "$fixture_app" node - verify-upgrade < .github/scripts/verify-incident-fixture.cjs
# A second inherited boot must preserve the already migrated hashes and config.
docker restart "$fixture_app" >/dev/null
wait_for_app
docker exec -i "$fixture_app" node - verify-upgrade < .github/scripts/verify-incident-fixture.cjs

---
description: Deploy Flare with persistent PostgreSQL and uploads using Docker Compose, with a path to HTTPS and repeatable upgrades.
---

# Deploy with Docker

This guide creates one Flare container and one PostgreSQL container. The app listens on your server's loopback address, PostgreSQL stays inside the Compose network, and both data stores use persistent named volumes.

You need Docker Engine with the Compose plugin, a terminal, and enough disk for your files and database. Run `docker compose version` to confirm Compose is available.

## 1. Create a deployment directory

```sh
mkdir flare
cd flare
umask 077
```

Generate two different secrets:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Save a `.env` file in this directory. Replace both placeholders with the generated values. Hexadecimal passwords work directly in the database URL; other passwords may require URL encoding.

```dotenv
POSTGRES_PASSWORD=REPLACE_WITH_FIRST_GENERATED_VALUE
NEXTAUTH_SECRET=REPLACE_WITH_SECOND_GENERATED_VALUE
NEXTAUTH_URL=http://localhost:3000
FLARE_IMAGE=flintsh/flare:latest
```

`latest` follows the stable release. For a repeatable production deployment, use the version tag you have chosen from the [Flare releases](https://github.com/FlintSH/Flare/releases), or pin the pulled image digest as described below. `ghcr.io/flintsh/flare` is the alternative official registry. Official builds cover AMD64 and ARM64.

## 2. Add Compose

Create `compose.yaml`:

```yaml
name: flare

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: flare
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: flare
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U flare -d flare']
      interval: 10s
      timeout: 5s
      retries: 10

  flare:
    image: ${FLARE_IMAGE:-flintsh/flare:latest}
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:3000'
    environment:
      DATABASE_URL: postgresql://flare:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432/flare?schema=public
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?Set NEXTAUTH_SECRET in .env}
      NEXTAUTH_URL: ${NEXTAUTH_URL:?Set NEXTAUTH_URL in .env}
    volumes:
      - uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy

volumes:
  postgres_data:
  uploads:
```

Compose waits for the database health check before starting Flare. Flare's entrypoint also waits for the database, applies Prisma migrations, initializes configuration, migrates legacy file passwords, and starts the application. Do not replace its startup command with `next start` in a container deployment. [Docker documents the dependency behavior](https://docs.docker.com/compose/how-tos/startup-order/).

## 3. Start Flare

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 flare
```

Wait for initialization to finish, then open `http://localhost:3000/setup`. If Docker runs on a remote machine, use an SSH tunnel from your computer:

```sh
ssh -L 3000:127.0.0.1:3000 your-user@your-server
```

Keep the tunnel open and use `http://localhost:3000` in your local browser. The initial account becomes the administrator. Complete [the setup walkthrough](/admin/setup), then upload a small test file.

::: tip Keep the deployment directory
The `.env` and Compose files describe your deployment, while Docker volumes hold the data. Keep the configuration in your backup plan. Do not commit `.env` to a public repository.
:::

## 4. Add your public domain

Follow [HTTPS and reverse proxies](/hosting/reverse-proxy). Update `.env` to your final origin:

```dotenv
NEXTAUTH_URL=https://files.example.com
```

Apply the environment change:

```sh
docker compose up -d flare
```

Environment changes require container recreation; `docker compose restart` alone retains the old environment. Test sign-in, generated upload-tool configuration, share links, and an upload at the public address.

The loopback binding is suitable for a reverse proxy running directly on the host. A proxy running in another container needs to join the Compose network and connect to `flare:3000`, rather than its own `127.0.0.1`.

## Pin your application image

After pulling the release you intend to run:

```sh
docker image inspect flintsh/flare:latest --format '{{index .RepoDigests 0}}'
```

Put the returned `flintsh/flare@sha256:…` value in `FLARE_IMAGE`. A version tag identifies a release; a digest fixes the exact image contents. Record the installed version and digest with each backup.

The `rolling` tag tracks development prereleases. For a pinned prerelease, release workflows publish `rolling-<short-commit>` tags. Read the release notes and take a backup before moving between channels. Setting a release metadata environment variable does not install a different release.

## Existing PostgreSQL or bind mounts

To use an existing database, remove the `db` service and `depends_on`, and set `DATABASE_URL` to that database. The account needs privileges to create and migrate Flare's schema. Keep the database reachable privately and apply your database provider's TLS requirements. Flare uses PostgreSQL; SQLite and MySQL are not alternative backends.

To store local files in a directory you manage, replace `uploads:/app/uploads` with `./uploads:/app/uploads`. The image prepares this directory and runs Flare as UID/GID `1001`. Its entrypoint starts as root to fix upload ownership before switching users; forcing an arbitrary container user can prevent startup. Network filesystems with root squashing or restrictive ownership need corresponding host-side permissions.

## Build or run from source

For a custom image, clone the project and build its supplied Dockerfile:

```sh
git clone https://github.com/FlintSH/Flare.git
cd Flare
docker build -t flare:local .
```

Use `flare:local` as `FLARE_IMAGE` in your deployment. To identify a custom rolling build in Settings:

```sh
docker build \
  --build-arg FLARE_RELEASE_CHANNEL=rolling \
  --build-arg FLARE_COMMIT_SHA="$(git rev-parse HEAD)" \
  -t flare:local .
```

For a source checkout outside Docker, use Node compatible with the repository's dependencies and the exact pnpm release in `package.json`'s `packageManager` field. Supply `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` to the shell/process manager, then:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
node scripts/migrate-config.js
node scripts/hash-file-passwords.js
pnpm build
pnpm start
```

`pnpm start` needs a completed build and an always-running process manager. Run from the project root with writable `uploads` and `tmp` directories. A `.env.local` file is loaded by Next.js, but standalone Node maintenance scripts need their environment supplied separately. For development use `pnpm dev` after setting up the database.

Next: [verify persistence and create a backup](/hosting/maintenance).

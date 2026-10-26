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

For a source checkout outside Docker, use Node.js 22.13 or later and the exact pnpm release in `package.json`'s `packageManager` field. That pnpm release needs Node.js 22.13. CI uses Node.js 24, and the official image uses the current Node.js LTS release (`node:lts`). Supply `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` to the shell/process manager, then:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
node scripts/migrate-config.js
node scripts/hash-file-passwords.js
pnpm build
pnpm start
```

`pnpm start` needs a completed build and an always-running process manager. Run from the project root with writable `uploads` and `tmp` directories; `pnpm start` reads both from there. Builds leave `uploads` out of `.next/standalone`, so building next to existing uploads doesn't copy them. A `.env.local` file is loaded by Next.js, but standalone Node maintenance scripts need their environment supplied separately. For development use `pnpm dev` after setting up the database.

### Use the repository's Compose file

The checkout's `docker-compose.yml` builds Flare from that source and starts PostgreSQL with the same protections as the example above: it reads its secrets from `.env` and refuses to start without them, PostgreSQL has no published port, and the app is published on `127.0.0.1:3000` only.

Generate two different values with `openssl rand -hex 32`, then save `.env` in the checkout directory. If you already keep a `.env` there for `pnpm dev`, add these keys to it instead of replacing it.

```dotenv
POSTGRES_PASSWORD=REPLACE_WITH_FIRST_GENERATED_VALUE
NEXTAUTH_SECRET=REPLACE_WITH_SECOND_GENERATED_VALUE
NEXTAUTH_URL=http://localhost:3000
```

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

This file names its services `app` and `postgres`, where the rest of this handbook uses `flare` and `db`. Substitute the names in maintenance commands, for example `docker compose exec -T postgres pg_dump -U flare -d flare -Fc`. Its volume names start with the Compose project name, which is the checkout directory's name unless you set one: a `Flare` directory gives `flare_uploads` and `flare_postgres_data`. `docker volume ls` shows yours.

For remote access, follow [HTTPS and reverse proxies](/hosting/reverse-proxy) with a proxy on this host (it reaches `127.0.0.1:3000`), or attach a proxy container to the Compose network and point it at `app:3000`. Publishing port 3000 on every interface lets clients skip the proxy and send their own forwarded-IP headers, which Flare uses for rate limits.

### Upgrade from the earlier repository Compose file

Earlier versions of `docker-compose.yml` published PostgreSQL on port 5432 of every host interface with the password `flarepassword`, published the app on every interface, and set `NEXTAUTH_SECRET=your-secret-key-here`. That password and secret are public in this repository. The current file keeps the same service and volume names, so your data carries over, but it needs a `.env` file first.

1. [Make a backup](/hosting/maintenance#make-a-consistent-local-backup) with these substitutions: the services `app` and `postgres`, your uploads volume from `docker volume ls` (for example `flare_uploads`), and `docker-compose.yml` in place of `compose.yaml .env`, since `.env` does not exist yet.
2. Create `.env` next to `docker-compose.yml`:

   ```dotenv
   POSTGRES_PASSWORD=flarepassword
   NEXTAUTH_SECRET=REPLACE_WITH_GENERATED_VALUE
   NEXTAUTH_URL=http://localhost:3000
   ```

   - `POSTGRES_PASSWORD` must match the password stored in your existing database volume. PostgreSQL applies it only when it initializes an empty data directory, so use the value your old file had (`flarepassword` unless you edited it). Step 5 changes it.
   - If your old file still had `your-secret-key-here`, generate a new `NEXTAUTH_SECRET` with `openssl rand -hex 32`. That example value is 20 characters, below the 32 Flare requires for encryption, so no authenticator, saved SMTP password, webhook secret, or invite link was encrypted with it. Replacing it signs everyone out once. If you had set your own secret, keep it: changing a secret in use makes enrolled authenticators unreadable. See [secrets and key rotation](/hosting/maintenance#secrets-and-key-rotation).
   - Set `NEXTAUTH_URL` to the public origin you already use.

3. Update the checkout (`git pull`; resolve any local edits you made to `docker-compose.yml`), then start it:

   ```sh
   docker compose config --quiet
   docker compose up -d --build
   docker compose ps
   ```

   Run it from the same directory as before, and do not add a top-level `name:` or rename the services. The project name prefixes the volume names, so a different one starts with empty volumes. `docker compose ps` should list the app as `127.0.0.1:3000->3000/tcp` and PostgreSQL with no host port.

4. Sign in again and confirm your files and settings are present.
5. Replace the database password, which was public while the port was published. Generate a value with `openssl rand -hex 32`, then open `psql` inside the container (local connections there do not need the old password):

   ```sh
   docker compose exec postgres psql -U flare -d flare
   ```

   At the `flare=#` prompt, run `\password flare`, enter the new value twice, then `\q`. Put the same value in `POSTGRES_PASSWORD` in `.env` and apply it:

   ```sh
   docker compose up -d
   docker compose logs --tail=50 app
   ```

   Compose recreates both containers with the new value. The database volume and its data are unchanged.

PostgreSQL is no longer reachable from the host. Use `docker compose exec postgres psql -U flare -d flare` or `docker compose exec -T postgres pg_dump ...` for maintenance. If a tool on the host must connect, publish it on loopback only, in a `docker-compose.override.yml` next to the main file:

```yaml
services:
  postgres:
    ports:
      - '127.0.0.1:5432:5432'
```

The app is now published on loopback only, so other machines can no longer open `http://your-server:3000`. Put a reverse proxy in front, as described in the previous section. If you must publish port 3000 on every interface anyway, replace the mapping in a `docker-compose.override.yml` (the `!override` tag needs Docker Compose 2.24.4 or later), and firewall the port so only your proxy or trusted clients reach it:

```yaml
services:
  app:
    ports: !override
      - '3000:3000'
```

Without `!override`, Compose adds the mapping to the existing loopback one instead of replacing it.

Flare logs a startup warning while `NEXTAUTH_SECRET` is still `your-secret-key-here` or shorter than 32 characters. The warning does not stop the instance.

Next: [verify persistence and create a backup](/hosting/maintenance).

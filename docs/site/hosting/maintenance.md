---
description: Back up, restore, upgrade, monitor, and move a Flare instance while keeping database records, files, and encryption keys together.
---

# Backups, upgrades, and maintenance

A recoverable Flare instance needs its **PostgreSQL database, file bytes, deployment configuration, and encryption secrets**. The database stores settings as well as accounts and file records. Exporting an appearance pack or a user's data is useful, but is not an instance backup.

[Saved views](../guide/saved-views) are stored in account preferences in PostgreSQL, so a database backup preserves them. Existing accounts start with an empty view list after upgrading; the feature needs no separate migration, storage directory, or environment setting. The personal account export does not include saved views.

The commands below match the [Docker Compose guide](/hosting/docker): project name `flare`, services `db` and `flare`, and volumes `flare_postgres_data` and `flare_uploads`.

## Make a consistent local backup

For a straightforward backup, stop the application so uploads, deletions, and background jobs cannot change files while you capture the database. PostgreSQL remains running for `pg_dump`.

```sh
umask 077
mkdir -p backups
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir "backups/$backup_stamp"
docker compose stop flare
docker compose exec -T db pg_dump -U flare -d flare -Fc > "backups/$backup_stamp/database.dump"
docker run --rm \
  --mount type=volume,src=flare_uploads,dst=/source,readonly \
  --mount "type=bind,src=$PWD/backups/$backup_stamp,dst=/backup" \
  alpine:3.22 tar -czf /backup/uploads.tar.gz -C /source .
cp compose.yaml .env "backups/$backup_stamp/"
docker compose start flare
```

Check each command succeeds before continuing. If the dump or archive fails, resolve the error and redo the backup; do not mark that backup as usable. For a bind mount, archive the actual uploads directory instead. Preserve mounted secret files too, using your secret manager's backup process.

The PostgreSQL custom format supports `pg_restore` and includes the schema and data. It does not back up cluster-level roles; this example recreates the `flare` role through Compose. [PostgreSQL's dump documentation](https://www.postgresql.org/docs/16/backup-dump.html).

Record the current image identity:

```sh
docker inspect "$(docker compose ps -q flare)" --format '{{.Config.Image}} {{.Image}}'
```

Save that output with the backup. Store an encrypted copy off the machine, retain more than one restore point, and periodically restore one. A backup on the same failing disk does not help after disk loss.

::: tip Secrets have their own recovery path
The copied `.env` can contain database and encryption secrets. Protect it accordingly. Keep a securely stored recoverable copy of secrets separately from database archives as well, so losing one storage location does not destroy both.
:::

## S3 backups

Stop the app for the database dump and a coordinated bucket snapshot/copy, or use a tested provider-specific point-in-time process. Preserve the bucket's object keys and relevant object metadata. Versioning helps recover overwritten or deleted objects, but is not automatically an independent backup and does not capture your PostgreSQL data.

Include avatars and favicon, not only files visible in the library. A database restore references the keys that existed at that restore point. If a bucket lifecycle rule deletes objects sooner than Flare expects, the database can retain records whose bytes no longer exist.

Before starting a restored instance, consider queued email, webhooks, and expiry jobs. Restoring a database restores pending work too. A test restore should have email disabled and network egress restricted from real webhook recipients. Do not let a restore drill accidentally resend production events or delete production objects.

## Restore into a separate environment

Practice on a new deployment directory with a new Compose project name and isolated storage. The example below assumes its project name is `flare-restore`, the services still use `db`/`flare`, and `BACKUP_DIR` points to a complete backup.

1. Copy the backed-up Compose configuration and `.env` into the new directory. Set `name: flare-restore`, use another host port such as `127.0.0.1:3001:3000`, and set `NEXTAUTH_URL=http://localhost:3001` for a local test.
2. Keep the original encryption key. Add `FLARE_EMAIL_ENABLED: "false"` to the app environment for a drill, and block real webhook delivery with the test environment's network policy.
3. Start only the new database, then restore the dump and uploads:

```sh
docker compose up -d db
docker compose exec -T db pg_isready -U flare -d flare
docker compose exec -T db pg_restore \
  -U flare -d flare --no-owner --no-acl --exit-on-error < "$BACKUP_DIR/database.dump"
docker compose create flare
docker run --rm \
  --mount type=volume,src=flare-restore_uploads,dst=/restore \
  --mount "type=bind,src=$BACKUP_DIR,dst=/backup,readonly" \
  alpine:3.22 tar -xzf /backup/uploads.tar.gz -C /restore
docker compose up -d flare
```

Use an absolute `BACKUP_DIR`; wait until `pg_isready` succeeds before restoring. Restore into a **new, empty database and uploads volume**. `docker compose create flare` creates the stopped application container and its correctly labeled volume without starting background jobs. These commands deliberately do not drop or overwrite an existing instance.

For an S3 restore, use a separate restored bucket. The restored database contains the original bucket configuration, so prevent production bucket access and update the copied instance's storage settings before testing files or allowing background jobs to run against it. A controlled local restore can instead restore matching object keys into its uploads directory and change the copied configuration to local storage before starting the app.

Verify sign-in, Settings, several file types, a private file, a password-protected file, folders, short links, avatars, and a new upload/delete cycle. Confirm the app can decrypt its secrets without printing them. A health-check response alone is not a restore test.

## Upgrade Flare

1. Read the chosen release's notes and identify any migration instructions.
2. Record the current image, deployment files, and secrets.
3. Take a consistent database-and-files backup and verify it exists.
4. Change `FLARE_IMAGE` to the chosen version or digest in `.env`.
5. Pull and recreate the app:

```sh
docker compose pull flare
docker compose up -d flare
docker compose logs --tail=150 flare
docker compose ps
```

The official image runs database and configuration migrations on startup. It does not require you to manually run `prisma db push`. Existing email functionality remains disabled on upgrade unless you enable it. Settings → General shows release information and update availability; it does not install the update for you.

Test sign-in, upload, download, and any integrations you depend on after the update. Avoid unattended movement to `rolling` on an instance whose downtime or data loss would be costly.

### Rollback

An older image may not understand a newer database schema. Do not assume changing an image tag reverses migrations. The dependable rollback is the recorded old image **plus its matching pre-upgrade database and file backup** in a clean restore environment. Account for new uploads and account changes made since that backup before switching traffic.

### PostgreSQL upgrades

Upgrade PostgreSQL separately from Flare. Keeping `postgres:16-alpine` within PostgreSQL 16 is different from changing the database major version. A new major image cannot simply reuse an old major's data directory. Use a planned logical dump/restore or the PostgreSQL-supported upgrade procedure, and test with an isolated restored instance first. Keep database storage private and monitor its own health and disk use.

## Secrets and key rotation

Flare encrypts saved SMTP passwords, token-bearing mail payloads, and webhook signing secrets. Its active encryption key is `FLARE_EMAIL_ENCRYPTION_KEY` or its `_FILE` equivalent, otherwise `NEXTAUTH_SECRET`.

Preserve the same effective key during recreation and restores. Introducing a dedicated key that differs from the previous fallback is a key change too. Setting a new key does not automatically re-encrypt database values.

For planned encryption rotation, pause email and webhooks, handle or cancel queued work, and retain a recovery copy of the old key. After changing the key, re-enter SMTP credentials and recreate webhooks with newly shared receiver secrets; issue fresh account links as needed. Existing encrypted webhook secrets cannot be recovered using the new key. A dedicated key lets you rotate the session secret later without simultaneously changing the encryption key.

For an email lockout, `FLARE_EMAIL_ENABLED=false` disables sending and local verification enforcement. It does not repair encryption, change passwords, disable SSO, or restore webhook secrets. Use the [email recovery workflow](/admin/email#recover-from-an-email-lockout).

## Monitoring and routine checks

| Signal                                | Why it matters                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `/api/health` responds                | Web process liveness only; the endpoint does not query PostgreSQL, storage, or SMTP |
| Disk free space and inodes            | Local uploads, temporary files, database, and logs can fill disk independently      |
| Memory and CPU                        | Large uploads and OCR increase resource use                                         |
| Database reachability and connections | Authentication, settings, file records, and durable jobs rely on PostgreSQL         |
| Failed email/webhook deliveries       | A running web service can still fail external delivery                              |
| A periodic upload/download check      | Tests the database-and-storage path together                                        |
| Backup age and restore result         | Confirms recovery is practical                                                      |

Use `docker compose logs --tail=100 flare` for app diagnostics and `docker compose logs --tail=100 db` for database startup issues. Set `LOG_LEVEL=debug` temporarily when investigating a reproducible problem, then restore your usual level. Review logs before sharing them externally.

Do not remove files directly from the uploads directory as routine cleanup; that leaves database records and usage accounting behind. Use Flare's file/account controls or restore tools that keep both sides consistent. `docker compose down` preserves named volumes, but **`docker compose down -v` deletes them**.

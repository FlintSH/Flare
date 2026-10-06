---
description: Back up, restore, upgrade, monitor, and move a Flare instance while keeping database records, files, and encryption keys together.
---

# Backups, upgrades, and maintenance

A recoverable Flare instance needs its **PostgreSQL database, file bytes, deployment configuration, and encryption secrets**. The database stores settings as well as accounts, file records, and durable background jobs, including pending account storage cleanup. Exporting an appearance pack or a user's data is useful, but is not an instance backup.

The [archive workspace](/guide/archives) packages or extracts account files. Its generated archives do not include database state, permissions, credentials, configuration, or encryption keys, and its extraction flow does not restore an instance. Back up generated archives and extracted files alongside the rest of the stored file bytes. Existing installations retain their current files and sharing settings; archive operations create new outputs only when a user requests them. Those outputs default to private/no expiration unless the user explicitly selects an upload profile.

Existing accessible archive links also gain share-page entry browsing and downloads. Their current visibility and password still control access, including private-file and moderator rules. Share pages do not extract into an account; owner-library extraction and creation retain their existing permissions. Review [public archive processing limits](./storage#archive-processing) when planning application resources.

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

Before starting a restored instance, consider queued email, webhooks, expiry jobs, and account storage cleanup. Restoring a database restores pending work too. A test restore should have email disabled and network egress restricted from real webhook recipients and production object storage. Account cleanup jobs retain the original storage target; changing the restored instance's active provider alone does not disable them. Isolate both its upload volume and storage credentials/network before starting the app so a restore drill cannot delete production objects.

## Restore into a separate environment

Practice on a new deployment directory with a new Compose project name and isolated storage. The example below assumes its project name is `flare-restore`, the services still use `db`/`flare`, and `BACKUP_DIR` points to a complete backup.

1. Copy the backed-up Compose configuration and `.env` into the new directory. Set `name: flare-restore`, use another host port such as `127.0.0.1:3001:3000`, and set `NEXTAUTH_URL=http://localhost:3001` for a local test.
2. Keep the original encryption key. Add `FLARE_EMAIL_ENABLED: "false"` to the app environment for a drill. Block real webhook delivery and production object-storage access with the test environment's network policy before starting the app.
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

For an S3 restore, use a separate restored bucket. The restored database contains both the original bucket configuration and any pending cleanup targets, so prevent production bucket access before starting the app. Update the copied instance's storage settings before testing files. Cleanup jobs pinned to the old bucket remain pending when its identity no longer matches; they are not redirected to the restored bucket. A controlled local restore can instead restore matching object keys into its isolated uploads directory and change the copied configuration to local storage. S3 cleanup can still run when saved S3 settings match a job, even with local storage active, so retain the network restriction throughout the drill.

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

### Sessions and audit log migration

Migrations `20261006000200_instance_audit` and `20261006010000_browser_sessions` add persistent instance audit events, server-side browser-session records, and account login history. Normal image startup applies the database migration. Back up PostgreSQL first, deploy all application replicas together, and verify the new tables are present before accepting sign-ins. There is no new environment switch or background service to enable.

**Everyone must sign in again after this upgrade.** Older cookies do not identify a server-side session record and are rejected rather than silently trusted. Existing accounts, passwords, passkeys, authenticator/recovery methods, role assignments, files, and integration credentials remain in place. Named API tokens and the legacy upload credential do not become browser sessions and are not revoked by this migration. Update any custom dashboard client to handle a new sign-in prompt and the [session API](../api/activity).

Audit/login history begins when the feature runs; previous activity is not backfilled. Administrator can open **Audit log**; grant `audit.read` only to trusted reviewers who should see activity across all accounts, including private filenames. Verify a fresh sign-in appears in **Profile → Account → Active sessions**, create and revoke a second disposable browser session, and confirm that the revoked browser is refused on its next protected request. Then create, edit, and remove a disposable file and inspect the resulting [audit events](../admin/audit).

Personal login history covers 90 days. The security worker removes older attempts and session rows whose fixed expiry is more than 90 days old in bounded batches. Revoking a session removes its access immediately on the next request; waiting for physical row cleanup is unnecessary. This automatic cleanup does not purge audit events.

Audit records live in PostgreSQL, survive account/file deletion, and have **no automatic retention cutoff**. There is no built-in audit purge control. Include their growth in database capacity planning and define retention with your own operator policy. Backups contain this sensitive history too. Deleting the corresponding application object does not remove the historical metadata from the live audit table or a backup.

Restoring a database restores session revocation and audit history to its backup point. A previously revoked session whose cookie and fixed expiry are still valid can become usable again if its record is restored. After a disaster recovery, revoke affected users' sessions through **Users → Revoke Sessions** and review credentials changed since the backup. A restore also loses events recorded after that snapshot unless separately preserved; the audit log is not an independent or tamper-evident archive.

Where per-object evidence is available, bulk audit recording preserves separate object events while inserting sanitized records in batches of at most 500. Count-only operations can instead produce aggregate events. Successful transactional change events are flushed after commit. If a batch fails, remaining batches are still attempted, but there is no durable queue or automatic retry for the lost events; the underlying change can already have succeeded. Batching reduces database round trips without establishing a request-time guarantee or changing retention. Events in a batch can share a database timestamp, so display order alone does not establish causality.

Audited bulk deletions lock candidate rows while rechecking and removing them, so concurrent changes to those rows may wait for the transaction to finish. This keeps per-file deletion evidence aligned with the rows actually removed.

Most audit writes are best effort. Account deletion’s per-file audit records are inserted in the deletion transaction: an audit insert failure rolls back account removal and queued cleanup rather than allowing the file evidence to be lost. Monitor application diagnostics for audit-write errors and verify events are arriving after a database outage or upgrade. Absence of an event is not proof that an operation did not occur. Direct database/storage edits and requests served by object storage or caches need separate infrastructure logs. [Review client-IP trust](./reverse-proxy#client-addresses-in-session-history) before using session metadata to investigate access.

### Two-factor authentication and passkey migration

Migration `20261004010000_account_security` adds account authenticator state, hashed one-time recovery codes, public passkey credentials, short-lived verification challenges, and shared rate-limit counters. Normal image startup applies it. Existing accounts retain their passwords, SSO bindings, roles, integrations, and content; two-factor authentication stays off and passkeys stay empty until each account enrolls. No additional environment variable is required.

Before upgrading, back up the database and preserve the existing `NEXTAUTH_SECRET`. Authenticator secrets are encrypted with a key derived from that secret, independently of `FLARE_EMAIL_ENCRYPTION_KEY`. All application replicas must share the same value. Do not rotate it during this upgrade.

Afterward, use an isolated account to test authenticator enrollment, saving recovery codes, password-plus-code sign-in, one-time recovery, and passkey registration/sign-in. Authenticator/recovery changes and passkey additions/removals end browser sessions; renaming a passkey does not. Review custom browser clients against the [security session contract](/api/security); direct password callbacks must also satisfy an enabled authenticator. Named-token scopes and upload-tool credentials retain their existing behavior.

Include the new security records in future database backups. A restore also restores both recovery-code sets' usage, the passkey requirement, and passkey registration/revocation state at the backup time; codes used or passkeys removed after that point can become usable again. Review affected credentials after disaster recovery. A test restore at localhost cannot authenticate with production-hostname passkeys. Keep a tested dedicated passkey recovery code for an account that requires passkeys, or an allowed alternative method for an account without the requirement. Do not disable second factors merely to make a restore drill easier.

Before a [hostname change](./reverse-proxy#passkeys-and-hostname-changes), ensure users with a passkey requirement have their dedicated recovery codes or explicitly turn the requirement off using a working passkey. Password plus authenticator/recovery code or SSO can be a fallback only with the requirement off. Register new passkeys on the new hostname afterward. Keep independent administrator recovery methods: there is no dashboard administrator bypass for a lost factor or a passkey requirement.

#### Required-passkey migration

Migration `20261004020000_require_passkeys` adds `User.passkeyRequired` with a **false** default and the separate `PasskeyRecoveryCode` table. It preserves existing authenticator enrollment, authenticator recovery codes, passkeys, passwords, and provider bindings. Normal startup applies the migration; no new environment variable or separate service is required. Accounts continue their existing sign-in behavior until each owner explicitly enables the requirement after a fresh passkey confirmation.

An enabled account needs its registered passkey or an unused dedicated passkey recovery code to sign in. Passwords, authenticator codes, and SSO cannot bypass the setting. Each dedicated code grants full sign-in with the account's email address, works once, and provides five minutes to repair access without turning the requirement off automatically. Keep these codes private and independent of a single device. Disabling the requirement deletes its dedicated set; enabling it again creates a new set. Password resets and administrator email/password changes preserve the requirement and both code sets; those account edits revoke existing browser sessions.

After upgrading, test activation, rejection of password/SSO fallback, passkey sign-in, one-use dedicated recovery, and an explicit disable operation on a disposable account. Verify both local and SSO-only recovery if your instance supports both. Backups must include the flag and dedicated code usage alongside existing credentials; restoring an old backup can restore an old requirement value and previously consumed recovery codes. An older image does not enforce this new requirement: plan rollback with the matching database backup and account owners rather than assuming that swapping only the image preserves the policy.

#### Authentication rate-limit cleanup

Each running application process checks for old authentication rate-limit counters every **60 seconds**, removing at most **1,000** records whose reset time is more than **24 hours** old per run. Database row locks let replicas clean different records without waiting on each other, and a process does not overlap its own cleanup runs. A failed cleanup is retried on the next interval. Keep at least one application process running; no separate worker service or setting is required.

Cleanup runs independently of sign-in requests. An expired counter no longer blocks authentication even if its row is waiting for cleanup; the normal 15-minute limits remain unchanged. This cleanup does not remove authenticators, recovery codes, passkeys, or active limit counters.

### Upgrading to roles

The role migration replaces the `User.role` enum with roles and account assignments. Every account inherits **Everyone**, whose initial permissions preserve existing personal workflows. Every former `ADMIN` account receives the new **Admin** role with all permissions. The first account on a fresh instance receives that role automatically. Existing files, SSO bindings, integrations, and account data are preserved.

1. Back up the database and files before applying the migration; role assignments and Everyone permissions are database state and must be included in future backups.
2. Let the normal image startup run migrations. Do not manually replace `ADMIN`/`USER` values or use `prisma db push` as a migration substitute.
3. Sign in with an existing administrator and open **Roles**. Confirm Everyone and Admin exist and trusted administrators hold the Admin role.
4. Test a former non-administrator account: uploading, library access, links, and integrations should retain their previous personal capabilities.
5. Review Everyone before tightening access. Removing a grant affects existing accounts, future registrations, SSO provisioned accounts, and credentials owned by those accounts unless another role restores it.
6. Check custom dashboard clients for the removed scalar `role` field/filter. Use `roleIds` for account writes, `roles` for responses, and `roleId` for filtering. The named-token scope names and supported paths are unchanged; tokens additionally obey their owner's current permissions.
7. Test a delegated role with an isolated account and verify both its intended actions and denied actions. Keep a working local administrator recovery account.

No new environment variables are required. [Roles and permissions](/admin/roles) covers hierarchy, additive grants, safe delegation, and the last-accessible-administrator safeguard. [Session contracts](/api/roles) describe the account DTO changes. An old app image expects the removed enum; rollback requires its matching pre-migration backup, not just a different image tag.

### Durable account-cleanup migration

Migration `20260926020000_durable_account_cleanup` adds the `StorageDeletion` table. Normal image startup applies it. No new environment variable, separate worker service, or manual backfill is required. Each application process starts the worker; database leases coordinate its work across replicas.

Whole-account deletions committed after this migration preserve cleanup jobs independently of the deleted account and file rows. Earlier deleted accounts have no remaining records from which this migration can reconstruct every orphaned object, so it does not retrospectively repair earlier cleanup failures. Reconcile those against storage records and backups separately. Include the queue in database backups and read the [restore precautions](#restore-into-a-separate-environment) before starting a copied database.

### Storage-provenance migration

Migration `20260926030000_storage_provenance` adds each file's recorded storage target, the avatar's stored path/target, and the `StorageDeletion.writePending` flag used to protect unfinished avatar writes. New uploads retain the nonsecret identity of the provider that actually wrote their bytes, so later account cleanup does not guess from the instance's current storage selection.

Before upgrading, stop all old application processes and take a consistent database-and-storage backup. Existing file records have no trustworthy upload-time storage history, so the migration leaves their new target field unset. It also marks existing cleanup jobs **unknown**, clears their active leases, and preserves their former provider/target only as diagnostic hints. Those deletion-time values cannot prove where an earlier upload was stored.

Chunk uploads started before this migration do not have the required target metadata. Their later part or completion requests return `409`; ask users and integrations to initialize fresh uploads and resend those files. Completed files keep their existing records.

After starting the upgraded app, inspect [pending cleanup](#inspect-pending-cleanup). Unknown-target jobs retain the object path and former owner ID but do not delete bytes until an operator verifies and assigns the original target. New uploads record their targets automatically; upgrading does not move files, reconstruct lost storage history, or repair objects left by older deletions. Keep configuration history, storage inventories, and backups available for reconciliation.

### Upgrading from 2.0 to 2.1

Use the normal backup and upgrade steps above. The image applies the new folder and tag database migrations on startup. Existing files stay available in **All files**; upgrading does not move them into folders or publish collections.

The dependency refresh retains Next.js 15, React 18, Prisma 6, and Tailwind 3. It does not introduce new instance settings or environment variables. Source builds use Node.js 24 and the pnpm version declared in `package.json`; see [dependency maintenance](/contributing#dependency-maintenance) for the separate application and documentation checks.

- [Folders](/guide/folders) and [tags](/guide/tags) are optional ways to organize your library. Folders start unshared, and tags stay private to your account. A shared folder lists only its direct public files; it does not publish private files or subfolders.
- **Copy link** now always copies the plain share-page URL. The old **Copy format** preference has been removed. Upload responses use that same URL for `url`, `pageUrl`, and `copyText`; clients that need raw bytes or direct downloads should use `rawUrl` or `downloadUrl` explicitly. Review custom clients that relied on Markdown or HTML in `copyText`.
- Changing your URL ID now updates public file URLs while preserving the storage paths used to read, download, and delete existing files. Links using the previous ID may stop working; copy the current link again. The fix does not automatically repair files affected by an earlier failed change. Restore those files from a matching backup if needed.
- Screenshot tools can be configured directly from **Profile → Uploads → Screenshot tools and scripts**. [macOS setup with iTake](/guide/screenshot-tools#itake-on-macos) is available alongside the existing tools.

After updating, test a new upload, a copied link, an existing download, and any screenshot-tool integration you use. Review a shared folder while signed out before distributing its link.

### Rollback

An older image may not understand a newer database schema. Do not assume changing an image tag reverses migrations. The dependable rollback is the recorded old image **plus its matching pre-upgrade database and file backup** in a clean restore environment. Account for new uploads and account changes made since that backup before switching traffic.

### PostgreSQL upgrades

Upgrade PostgreSQL separately from Flare. Keeping `postgres:16-alpine` within PostgreSQL 16 is different from changing the database major version. A new major image cannot simply reuse an old major's data directory. Use a planned logical dump/restore or the PostgreSQL-supported upgrade procedure, and test with an isolated restored instance first. Keep database storage private and monitor its own health and disk use.

## Secrets and key rotation

Flare encrypts saved SMTP passwords, token-bearing mail payloads, and webhook signing secrets. The active encryption key for those values is `FLARE_EMAIL_ENCRYPTION_KEY` or its `_FILE` equivalent, otherwise `NEXTAUTH_SECRET`.

Preserve the same effective key during recreation and restores. Introducing a dedicated key that differs from the previous fallback is a key change too. Setting a new key does not automatically re-encrypt database values.

For planned encryption rotation, pause email and webhooks, handle or cancel queued work, and retain a recovery copy of the old key. After changing the key, re-enter SMTP credentials and recreate webhooks with newly shared receiver secrets; issue fresh account links as needed. Existing encrypted webhook secrets cannot be recovered using the new key. A dedicated email key separates email/webhook encryption from session-secret rotation. Authenticator secrets still depend on `NEXTAUTH_SECRET`: changing it without an authenticated re-enrollment or a separately implemented migration makes existing authenticators unreadable. Preserve the old secret. Flare does not provide automatic authenticator key rotation: a planned change requires users to disable their authenticators while the old key is active, then enroll again after rotation, or a separately reviewed data migration. Keep tested alternative administrator access throughout that process. If a key was lost unexpectedly, use a registered passkey or the recovery method permitted by the account: password plus an authenticator recovery code when the passkey requirement is off, or a dedicated passkey recovery code when it is on. Recovery hashes remain usable without decrypting the old authenticator. Use the five-minute proof window after an eligible recovery sign-in to disable the unreadable authenticator and arrange re-enrollment; the last matching recovery code is sufficient to begin that repair.

For an email lockout, `FLARE_EMAIL_ENABLED=false` disables sending and local verification enforcement. It does not repair encryption, change passwords, disable two-factor authentication or SSO, remove passkeys, turn off a passkey requirement, or restore webhook secrets. Use the [email recovery workflow](/admin/email#recover-from-an-email-lockout).

## Account storage cleanup

Deleting an account from Profile or Users commits account removal and durable cleanup jobs together, using the objects' recorded storage locations rather than the current instance backend. The worker performs storage I/O only after that commit. Rejected deletions, including the last-administrator safeguard, leave the account and bytes intact. This queue covers **whole-account deletion** and avatar replacement, removal, or failed publication; individual file or moderation deletion does not use it.

Large libraries are copied into the queue directly by PostgreSQL in bulk. Account deletion has a **120-second database transaction budget**; other account mutations keep their normal limits. This is an upper bound, not a promised completion time. If the request times out, check whether the account still exists before retrying. A failed transaction rolls back both account removal and the queued work.

The worker polls every **5 seconds** and allows **4 active jobs globally** across app processes. A claimed job has a **2-minute lease**, renewed every **30 seconds**; an expired lease can be claimed after a process stops. A missing object counts as success. Other failures retry after **30 seconds**, doubling up to **1 hour** between attempts, with no retry limit. Successful jobs are removed; pending jobs survive restarts. Keep at least one application process running to make progress.

Jobs record the path, former owner ID, provider, and nonsecret storage identity captured when the object was written. They do not store a copy of storage credentials:

- Local jobs always use the local filesystem, even if the instance now uses S3. Keep the original uploads volume mounted until its cleanup is complete.
- S3 jobs use fresh saved credentials only when the saved **bucket, region, endpoint, and path-style setting** match the recorded target. Changing credentials for that same target permits subsequent retries. Changing its identity leaves the job pending; cleanup never falls back to local storage or deletes the same key in another bucket. Matching saved S3 settings can process jobs even when the active provider is local.
- Unknown historical targets remain pending with **Storage provenance is unknown**. Restoring current S3 settings does not resolve missing history, and a file path alone is not evidence of which backend stored it.
- Uploaded avatars retain their app-owned path and provider independently of the displayed profile image URL. The exact legacy `/avatars/{accountId}.jpg` path is known local storage. Older `/api/avatars/{accountId}.jpg` or public URLs ending in the account's own avatar key retain that key as unknown provenance for review. Arbitrary external URLs never determine a backend or authorize deleting a different account's object.

### Inspect pending cleanup

There is no dashboard cleanup queue or manual retry button. With the documented Compose deployment, inspect it using read-only SQL:

```sh
docker compose exec -T db psql -U flare -d flare -c \
  'SELECT provider, status, "writePending", count(*) AS objects FROM "StorageDeletion" GROUP BY provider, status, "writePending" ORDER BY provider, status, "writePending";'

docker compose exec -T db psql -U flare -d flare -c \
  'SELECT id, "ownerId", path, provider, target, status, "writePending", attempts, "availableAt", "leaseUntil", "lastError" FROM "StorageDeletion" ORDER BY "createdAt" LIMIT 50;'

docker compose logs --tail=150 flare
```

`writePending = true` protects an unfinished avatar write and excludes it from cleanup claims. `availableAt` is the earliest next attempt for an eligible pending job; `leaseUntil` describes an in-progress claim. `attempts` includes claims recovered after a crash. Logs use the `storage-cleanup` component, and `lastError` gives a sanitized recovery hint. Treat owner IDs and storage details as private when sharing diagnostics.

For **Storage provenance is unknown**, verify the original object location using deployment history, storage inventories, and backups. A migrated job's `previousProvider` and `previousTarget` are hints, not a verified deletion target. Do not assign every unknown job to the current backend or infer S3 ownership from an arbitrary profile-image URL.

For **Storage deletion failed**, check storage reachability, credentials, delete permissions, and local-volume ownership. For **Storage target changed**, compare `target` with the saved S3 settings. Plan maintenance to restore the original matching target and valid credentials, let cleanup complete, then resume the storage migration. Do not rewrite a job's target to a different bucket or discard a pending row to make the count disappear. Wait until its next `availableAt`; restarting the app does not bypass the retry schedule.

An empty queue means all recorded jobs completed; it does not certify erasure from backups, S3 object versions, external caches, or storage left by older deletions. Flare has no account undelete operation: recovery needs a consistent pre-deletion database and file backup. A copied database can itself resume pending deletions, so follow the isolation precautions above.

### Resolve an unknown storage target

This is an operator repair, not a bulk backfill. First identify the job's exact object path and verify the original backend using storage inventories, deployment history, and backups. A matching filename in the current bucket is not enough: the same key can exist in more than one backend. Preserve the old diagnostic values with your maintenance record.

Stop **all application replicas and other writers**, including old versions, before editing cleanup or storage metadata. The Compose command below stops only the documented deployment's app service; stop any additional processes separately. Back up the database before making the repair.

For one verified local-storage job, replace both placeholders with the inspected job ID and path:

```sh
docker compose stop flare
docker compose exec -T db psql -U flare -d flare \
  -v ON_ERROR_STOP=1 \
  -v cleanup_id='VERIFIED_JOB_ID' \
  -v cleanup_path='uploads/VERIFIED_OBJECT_PATH' \
  -v storage_target='{"provider":"local"}' <<'SQL'
UPDATE "StorageDeletion"
SET provider = (:'storage_target'::jsonb)->>'provider',
    target = :'storage_target'::jsonb,
    status = 'pending', "availableAt" = NOW(),
    "leaseId" = NULL, "leaseUntil" = NULL,
    "lastError" = NULL, "updatedAt" = NOW()
WHERE id = :'cleanup_id' AND path = :'cleanup_path' AND provider = 'unknown'
RETURNING id, path, provider, target, "writePending";
SQL
```

For a verified S3 job, supply its original target instead of the local JSON. Include all five fields; use an empty endpoint string for the AWS regional default. Never put access keys or secrets in this value:

```json
{
  "provider": "s3",
  "bucket": "verified-original-bucket",
  "region": "verified-region",
  "endpoint": "",
  "forcePathStyle": false
}
```

The update must return exactly the intended row. If it returns none, inspect the ID, path, and current state; do not broaden the condition to unrelated jobs. Matching saved S3 settings and valid current credentials are still required when the worker resumes. This repair preserves `writePending`; handle a retained writer separately below before restarting the app.

### Recover an interrupted avatar write

New avatar uploads create a durable `writePending = true` record before storage I/O. A successful publication removes that record and saves the new avatar's path/target; a settled failed upload releases the record for normal cleanup. Replaced and administratively removed avatars also use the durable queue. Each upload has a unique key, so cleaning up an older attempt cannot delete a replacement.

If the process crashes, or cannot update PostgreSQL after the write settles, `writePending` can remain true. These rows have **no automatic timeout** and the worker cannot claim them. Their presence may represent an active upload, not a failure. Do not release a row merely because it is old: a writer could otherwise finish after cleanup had already removed the object.

After stopping **every possible writer** and the cleanup workers, verify the retained row's exact key and target. Resolve unknown provenance first if needed. Release only that inspected row:

```sh
docker compose exec -T db psql -U flare -d flare \
  -v ON_ERROR_STOP=1 \
  -v cleanup_id='VERIFIED_JOB_ID' \
  -v cleanup_path='uploads/avatars/VERIFIED_AVATAR_KEY.jpg' <<'SQL'
UPDATE "StorageDeletion"
SET "writePending" = false, status = 'pending', "availableAt" = NOW(),
    "leaseId" = NULL, "leaseUntil" = NULL,
    "lastError" = NULL, "updatedAt" = NOW()
WHERE id = :'cleanup_id' AND path = :'cleanup_path' AND "writePending" = true
RETURNING id, path, provider, target, "writePending";
SQL
```

Once the selected repairs are verified, restart the app with `docker compose start flare` and inspect the queue. The worker now retries deletion normally. Do not remove the row to dismiss the warning: it is the durable record needed to clean up those bytes.

## Monitoring and routine checks

| Signal                                | Why it matters                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/api/health` responds                | Web process liveness only; the endpoint does not query PostgreSQL, storage, or SMTP       |
| Disk free space and inodes            | Local uploads, temporary files, database, and logs can fill disk independently            |
| Memory and CPU                        | Large uploads and OCR increase resource use                                               |
| Database reachability and connections | Authentication, settings, file records, and durable jobs rely on PostgreSQL               |
| Pending account-cleanup jobs          | Storage failures can outlive the deleted account; inspect retries and the recorded target |
| Failed email/webhook deliveries       | A running web service can still fail external delivery                                    |
| A periodic upload/download check      | Tests the database-and-storage path together                                              |
| Backup age and restore result         | Confirms recovery is practical                                                            |

Use `docker compose logs --tail=100 flare` for app diagnostics and `docker compose logs --tail=100 db` for database startup issues. Set `LOG_LEVEL=debug` temporarily when investigating a reproducible problem, then restore your usual level. Review logs before sharing them externally.

Do not remove files directly from the uploads directory as routine cleanup; that leaves database records and usage accounting behind. Use Flare's file/account controls or restore tools that keep both sides consistent. `docker compose down` preserves named volumes, but **`docker compose down -v` deletes them**.

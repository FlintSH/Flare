---
description: Diagnose startup, upload, storage, authentication, email, appearance, and webhook problems with focused checks.
---

# Troubleshooting

Start with what fails: startup, sign-in, upload, opening an existing file, or a background integration. Note the time, request status, and whether it affects all users or one account. That narrows the useful logs and avoids changing unrelated settings.

## The container never becomes healthy

```sh
docker compose ps
docker compose logs --tail=150 flare
docker compose logs --tail=100 db
docker compose exec -T db pg_isready -U flare -d flare
```

The startup script waits for PostgreSQL and runs migrations. Check `DATABASE_URL` points to the database's network hostname (`db` in the documented Compose example, `postgres` in the repository's `docker-compose.yml`), not the app container's `localhost`. Check credentials, reachability, schema permissions, and database disk space.

Changing `POSTGRES_PASSWORD` in Compose does not change a password inside an already initialized PostgreSQL volume. Update the actual database account deliberately or restore the original correct environment value. Do not delete the volume to fix a password mismatch on a real instance.

If migrations failed, preserve the logs and take a database backup before corrective work. Do not substitute `prisma db push`, remove migrations, or reset the database to bypass an error.

## The site loads, but settings or sign-in fail

Check that `NEXTAUTH_URL` exactly matches the public scheme, hostname, and port you use. Recreate the container after changing it. Your proxy must preserve the public host and protocol.

All replicas must use the same authentication secret. A secret regenerated on every deploy invalidates sessions and may also make authenticator, SMTP, and webhook secrets unreadable. Authenticator encryption always depends on `NEXTAUTH_SECRET`, even when email/webhooks use a dedicated key. If only appearance is broken, use [appearance recovery](/admin/appearance#recover-an-unusable-appearance).

## Startup logs warn about NEXTAUTH_SECRET

Flare warns at startup when `NEXTAUTH_SECRET` is `your-secret-key-here`, the example value in earlier versions of the repository's `docker-compose.yml` and `.env.example`, or shorter than 32 characters. Anyone can sign session tokens with the published example. A short value also blocks authenticator setup, and invite links, webhooks, and saved SMTP passwords unless `FLARE_EMAIL_ENCRYPTION_KEY` is set.

Generate a value with `openssl rand -hex 32`, set it, and recreate the container. Replacing the published example signs everyone out once and loses nothing else, because Flare never encrypted data with a value that short. Replacing a secret that is already 32 characters or longer is different: follow [secrets and key rotation](/hosting/maintenance#secrets-and-key-rotation) so enrolled authenticators stay readable. [Upgrading from the earlier Compose file](/hosting/docker#upgrade-from-the-earlier-repository-compose-file) covers the whole change.

## Upload error reference

| Symptom                                                    | Check                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `413` before Flare sees the request                        | Reverse proxy/CDN body-size ceiling; allow multipart overhead                                                                              |
| Maximum upload size message                                | Settings → Storage; the per-file limit applies to admins too                                                                               |
| Quota exceeded                                             | Account usage versus the instance quota; `quotas.bypass` or Administrator exempts total quota                                              |
| `429`                                                      | Wait for the returned retry period; avoid restarting the instance as a rate-limit workaround                                               |
| `401` or `403` from a tool                                 | Token value, scope, expiry, revocation, and required email verification                                                                    |
| Upload session not found after a restart                   | In-progress chunk metadata was local to the previous process/filesystem; start the upload again                                            |
| Upload breaks after a storage change or provenance upgrade | Start a new upload. Part/completion requests reject `409` for a changed actual provider or old session metadata without a recorded target. |
| Small uploads work, large ones fail                        | Proxy timeouts, host request limits, temp disk, memory, and S3 multipart permissions                                                       |

Flare has process-local request throttles as well as persistent email throttles. If unrelated users appear to share a rate limit, inspect your proxy's forwarding headers. The app should receive a trusted client IP, not a spoofed header or the same proxy IP for everyone.

## Files disappear after redeploying

If accounts and file records remain but bytes cannot be read, check your storage mount. The official local path is `/app/uploads`, and files written only into the container layer disappear when it is replaced. Restore file bytes from backup into the correct persistent volume.

If accounts and settings also disappeared, inspect the PostgreSQL volume and database URL. You may be connected to a new empty database. Do not complete setup again until you have checked whether the original data still exists.

## Raw links return 500

`GET /{userUrlId}/{filename}/raw` checks access, opens the stored content, and saves one view before serving the response. A local file can disappear between the size check and opening it; this returns `500` without counting a view. A failed database counter write also returns `500` without serving the content. Both full and range responses close acquired streams on these failures so repeated requests do not retain file descriptors.

Inspect the application's **File serve error** logs, confirm that the original storage object exists and is readable, and check PostgreSQL availability and write permissions. Restore the missing object from your backup or resolve the storage/database problem, then retry the raw request and refresh the library. A failed counter write does not add a view. No re-upload or database migration is required for files whose bytes and metadata are intact.

An unknown file URL or a private file requested by an unauthorized visitor returns `404`; a public file with a missing or incorrect password returns `401`. Check [sharing and privacy](/guide/sharing#view-counts) before treating an access denial as a storage failure.

## Image thumbnails fail

Check the direct `/api/files/{id}/thumbnail` response in the same signed-in browser, even if the failed request is to `/_next/image?url=.../thumbnail`. A successful image response must contain readable image bytes; `200` with an empty body is still a failure. The thumbnail endpoint streams the original image, and the optimizer can resize public library previews. Protected library previews and **View Content** use the browser session directly.

An S3 stream bug in older builds could discard the image before the response started reading it. The direct route then returned an empty `200`, and the optimizer rejected it with `400` and `"url" parameter is valid but internal response is invalid`. Deploy the fixed build, restart all app replicas, and reload open tabs. Existing S3 objects need no re-upload, thumbnail regeneration, bucket permission change, or database migration. If a proxy retained an old empty response, purge the affected thumbnail URL after updating; ordinary file access rules still apply.

For private or password-protected images that fail only in **View Content**, update the frontend too: current moderation previews bypass the image optimizer, which does not forward browser authentication headers. They use the moderator's existing `content.read` permission.

If the direct request also fails, check that the session is still valid and has `files.read` for owned images or `content.read` for moderation. Private images are hidden with `404` from other visitors, and password-protected public images require the file password outside authorized owner/moderator sessions. For a `500`, inspect the application logs and storage availability. Keep file passwords and private file URLs out of support reports. See [library preview recovery](/guide/library#understand-activity-and-refresh) and [moderation permissions](/admin/users#moderate-files-and-shortened-links).

## S3 failures

| Error or behavior                                     | Likely cause                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Access denied for every upload                        | Incorrect credentials, bucket, region, or object permissions                                                      |
| Signature mismatch                                    | Wrong region/endpoint, changed signed URL, proxy host rewriting, or clock skew                                    |
| Browser cannot reach a preview/download URL           | The configured S3 endpoint is only reachable from the container or private network                                |
| Ordinary uploads work but avatars fail                | Provider rejects the avatar `public-read` ACL; [see compatibility details](/hosting/storage#avatar-compatibility) |
| Files fail immediately after changing provider/bucket | The bytes were not migrated; changing settings does not move objects                                              |
| Expired signed link                                   | Open the original Flare share link again to obtain an authorized fresh URL                                        |

Use the endpoint your provider documents for its S3 API, not its web console or a bucket browsing URL. Test path-style access if required by that provider. Do not change a bucket to public as a blanket fix for access errors.

## A deleted account still has objects in storage

Whole-account deletion removes account records immediately and queues file/avatar cleanup for the background worker. Storage downtime, a changed S3 target, or unknown historical storage locations can leave those jobs pending. Inspect the [cleanup queue and retry times](/hosting/maintenance#inspect-pending-cleanup), then correct the reported connectivity, permissions, or target mismatch. Jobs retry indefinitely and survive app restarts; no manual retry button is needed. **Storage provenance is unknown** needs operator verification of the original location before cleanup can proceed. The current backend and the migration's `previousTarget` diagnostic hint are not proof of that location.

Keep the original local uploads volume mounted for local jobs. S3 jobs need the saved bucket, region, endpoint, and path-style identity to match their recorded target, plus working current credentials. They never redirect cleanup to a new bucket. An already-issued signed URL can remain usable until its object is removed or the URL expires.

If no job exists, confirm whether the deletion happened before the durable-cleanup migration or was an individual file deletion; those older or separate operations are not backfilled into the account queue. Check sanitized logs and backups before reconciling orphaned objects. Account deletion does not remove backups, object versions, or external caches.

## An avatar upload failed or cleanup remains blocked

A new avatar is published only after the storage write succeeds and the account's current permission and quota pass a second check. A deleted account or revoked `profile.update` permission can reject an upload that was already in progress. The old avatar stays in place if publication fails.

Inspect the [cleanup queue](/hosting/maintenance#inspect-pending-cleanup). A `writePending = true` row protects an active or interrupted avatar write from premature deletion. A restart deliberately does not clear that flag. If a writer crashed, follow [interrupted-write recovery](/hosting/maintenance#recover-an-interrupted-avatar-write): stop every possible old writer before releasing the one verified record.

A fresh request to `/api/avatars/{filename}` returns `404` for a key no longer referenced by an account. For a newly recorded avatar, `503` means its stored target cannot be resolved; restore matching S3 settings if applicable. Do not point it at another bucket merely because an identically named key exists there.

## OIDC sign-in loops or rejects an account

Use `/auth/login?local=1` to reach password sign-in as a local administrator. Check the configured issuer's discovery URL and the provider redirect URI, which must be `https://your-host/api/auth/callback/oidc`.

An **account already exists** error does not mean a user can link it by matching an email address. Local accounts remain local; existing OIDC accounts remain tied to the original issuer and subject. With auto-provisioning disabled, a manually created account with the same email is not a linked identity. [OIDC behavior and error guide](/admin/sso).

## Account email is not arriving

Open Settings → Email and inspect delivery status and sanitized errors. A message accepted by SMTP may still be in spam or rejected later by the provider. Check provider logs, sender authorization, credentials, TLS mode, and DNS mail authentication.

Missing recovery mail can also be expected: recovery requires a verified address on a local password account. The public form does not disclose whether an address is eligible. An old account's saved address is not automatically proof of mailbox ownership.

If a managed field cannot be edited, its environment override is active. If decryption errors started after redeployment, restore the original encryption key. For policy lockout, see [email recovery](/admin/email#recover-from-an-email-lockout).

## Webhook deliveries fail

Inspect delivery history under Profile → Integrations. Confirm the receiver returns a successful HTTP status promptly, accepts the actual payload, and validates the signature using the original raw body. Check its public HTTPS reachability and DNS results from the server's network.

Private IPs and HTTP are denied unless the operator explicitly enables `FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK=true`. Redirecting a webhook URL is not a substitute for setting its final destination. If all existing webhooks fail after a secret change, check the encryption key before changing receiver signatures. [API and webhook documentation](/api/).

## OCR, expiration, or delivery jobs seem delayed

Flare's application process must remain running for background work. Check startup logs, database reachability, memory pressure, and whether the host sleeps the service. OCR is enabled in Settings → General and may be opted out for an upload. Processing an image takes time and does not guarantee useful extracted text.

With `audit.read`, filter [Audit log](/admin/audit) for the relevant file and processing outcomes, then compare the timestamps with worker diagnostics. Recorded OCR events retain outcomes rather than extracted text.

Expiration is a background action; an unavailable process cannot apply it on schedule. Email, webhook, and account storage-cleanup jobs use durable queues and retries, while image OCR work has process-local queue state. A green `/api/health` response does not certify that any of these jobs succeeded.

Each Flare process reads one image at a time. Automatic OCR after upload and **Extract text** requests share that queue, so a burst of uploads delays manual requests and the reverse. A request waits up to 60 seconds and then answers `202` while reading continues. At most ten new images wait to be read, and at most 30 requests wait for results at once, including requests for an image that is already being read; more get `503`. Each account, or client address for anonymous visitors, can start 20 readings per 10 minutes before getting `429`. After a failed reading, Flare waits 5 minutes before trying that image again. All of this state is in memory: a restart clears it, and queued work that hadn't finished is not resumed. Ask for **Extract text** again after a restart. Correct client addresses depend on your [proxy configuration](/hosting/reverse-proxy).

## Audit activity is missing

Open [Audit log](/admin/audit), clear the filters, and widen the time range. History starts with the session/audit migration; earlier activity is not backfilled. Confirm the caller has `audit.read`, then check PostgreSQL availability, migration status, disk space, and application diagnostics for audit-write failures. Create one disposable file and refresh the log to test current ingestion. Most audit writes are best effort, so a missing event is not proof that an operation failed or never happened. Account deletion’s per-file evidence is transactional and rolls back deletion if the insert fails.

A direct S3 request, a cache hit, a provider-side sign-in rejection, or an external database change may need the corresponding infrastructure logs. Avoid sharing private filenames, actor details, and request metadata in a public report without reviewing them.

## Archive operations fail or stay busy

First distinguish the ordinary upload from archive processing. A successfully uploaded RAR, 7z, cut-off, or damaged archive stays downloadable even when the archive browser can't read it. Browsing lists every entry it can read and marks encrypted, unsupported, linked, or unsafe entries individually; extraction still rejects archives containing them, and archives over the extraction limits. Check the [supported formats and limits](/guide/archives#supported-sizes-and-formats). A listing that stops early names its reason: the 100,000-entry limit, the two-minute listing budget (or 64 GiB of uncompressed TAR.GZ or GZIP data), or damage after the listed entries.

Check which entrypoint is in use. Owner-library browsing and extraction require the owner's browser session; a moderator permission does not replace source ownership there. Share-page browsing and entry downloads follow the file's normal visibility/password rules, including privileged owner or `content.read` access. Missing/changed passwords can return `401`; private or removed files return `404` to ineligible viewers. Named tokens do not grant access to either route set. Extraction remains in the owner's library and additionally needs upload/folder permissions, a valid owned destination, enough account quota, and output files within the instance's size limit.

For `429`, honor `Retry-After`: five seconds for capacity, or 60 seconds for the per-IP shared limits. Each application process reads two archive listings at once with 32 more waiting, lets one account or IP address start at most four unfinished listings, streams up to 64 entry responses (8 per account or IP address), runs two extraction or creation operations (one per account), and allows 32 pending shared request bodies. Shared pages also allow 120 listing and 600 entry requests per IP per minute. Incomplete, malformed, or unauthorized shared submissions never start reading an archive.

A listing that failed returns the same error for 30 seconds without reading the archive again; wait that long before retrying after fixing storage. If a TAR.GZ or GZIP listing is slow, that is the one-time decompression pass. It reads the whole object (from S3 too) and uses CPU in proportion to the uncompressed size; later openings are immediate while the listing stays in the [128 MiB per-process cache](./storage#archive-processing). Large TARs on S3 make one range request per member header. If seeking in a video or loading text previews fails behind a proxy, confirm that it passes `Range` headers and `206` responses through.

For `408`, distinguish a shared body that took more than five seconds, a browser that cancelled a request (closing a preview or seeking can do this routinely), and extraction or creation that exceeded 120 seconds. Retry a stalled submission on a stable connection and inspect proxy body timeouts. For slow extraction, inspect application/storage logs, temporary disk capacity, S3 connectivity, and proxy timeouts. Reduce the archive or selection instead of repeatedly submitting the same oversized job. The originals remain unchanged and a failed operation does not publish a partial output set. See [archive resource requirements](./storage#archive-processing).

A `504` on archive requests means preparing an entry response took more than 60 seconds, or storage sent no data for 60 seconds while a listing was read. Check S3 or disk health and connectivity; the request releases its capacity rather than waiting indefinitely.

A `413` with "This file is too far into a compressed archive for Flare to read" means that opening the entry would require decompressing more than 1 GiB before its first byte. Common compressors leave resume points much closer together, so this takes an unusual or crafted file. Download the whole archive to open that entry. Seeking more than 1 GiB into a compressed (deflated) ZIP entry sends the entry from its start instead, so a media player may not be able to jump that far; archives that store media uncompressed seek anywhere.

If previews of a protected shared archive start returning `401` across replicas or after a restart, check that every process has the same stable `NEXTAUTH_SECRET`; archive unlock cookies are signed with a key derived from it.

## Collect a useful support report

Include the installed release/channel and commit when shown, deployment method, storage backend, a brief reproduction, HTTP status, and relevant sanitized logs with timestamps. State whether the problem began after an upgrade or configuration change.

Remove passwords, database URLs containing credentials, API/upload tokens, webhook secrets, private file links, and recovery links before posting. Report reproducible issues through the [Flare issue tracker](https://github.com/FlintSH/Flare/issues) or ask the community in [Discord](https://discord.gg/mwVAjKwPus).

## Authenticator and passkey sign-in

For rejected authenticator codes, check the device's automatic time, the account/instance entry in the authenticator, and whether the code was already used. Rate limits and expired setup/challenge state require waiting or starting the action again. Use an unused recovery code or registered passkey if available. Password recovery and `FLARE_EMAIL_ENABLED=false` do not disable two-factor authentication.

For passkeys, confirm the browser is using the canonical HTTPS origin in `NEXTAUTH_URL`, and that the passkey was registered on its hostname. The proxy must preserve the public origin. A renamed hostname needs newly registered passkeys; a production credential cannot be exercised on an unrelated local restore URL. Cancelling a device prompt is recoverable by retrying or choosing another method.

If an account explicitly requires passkeys, correct passwords, authenticator codes, and SSO are intentionally rejected. Use a registered passkey or **Use a passkey recovery code** with the account's current email and an unused dedicated code. These codes are separate from password-plus-authenticator recovery codes and need no password. Successful emergency recovery keeps the requirement on and gives five minutes to add a key, replace the dedicated codes, or choose **Allow other sign-in methods**. Password reset, an administrator email/password edit, and `FLARE_EMAIL_ENABLED=false` do not remove the requirement. A last-key removal is refused while it remains enabled.

Dedicated recovery matches email addresses case-insensitively. If an unused dedicated code is rejected, check for legacy accounts whose addresses differ only by capitalization. An ambiguous address is rejected without spending the code; the public error does not disclose that collision. Follow the [administrator address-collision guidance](/admin/users#account-sign-in-security) to establish distinct addresses for the separate accounts. A working registered passkey remains an option while the collision is investigated.

If a deployment made existing authenticators unreadable, restore the matching `NEXTAUTH_SECRET` rather than changing factor records ad hoc. A dedicated `FLARE_EMAIL_ENCRYPTION_KEY` does not recover authenticators encrypted under another session secret. Recovery hashes do not require that encryption key: use password plus an authenticator recovery code when the passkey requirement is off, or a dedicated passkey recovery code when it is on. A registered passkey also remains an option. Either eligible recovery sign-in supplies five minutes of fresh proof, so even the last matching code can begin repair without spending a second code. Re-enroll the authenticator under the intended stable key. If all permitted methods and matching recovery codes are lost, there is no dashboard bypass: investigate with the operator under your instance's account-recovery process. See the [user recovery guide](/guide/security#recover-when-required-passkeys-are-unavailable) and [operator migration guidance](./maintenance#two-factor-authentication-and-passkey-migration).

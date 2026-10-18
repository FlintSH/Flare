---
description: Choose local or S3-compatible storage, configure limits and quotas, and understand provider changes and signed links.
---

# Storage, limits, and quotas

Choose a storage backend during setup or under **Settings → Storage**. Changing this section requires `settings.storage`; navigating Settings also uses `settings.read`. This controls where file bytes live. PostgreSQL remains required for both backends.

<Screenshot src="/screenshots/preferences/settings-storage.png" alt="Flare Storage settings showing the storage provider and upload limits" caption="Storage and quota controls live together in Settings." />

Session records, login history, and [audit events](/admin/audit) are stored in PostgreSQL, independently of local/S3 file bytes. They do not count toward a user's uploaded-file quota. Monitor database growth and preserve these records in [backups](./maintenance#sessions-and-audit-log-migration); deleting an uploaded object does not remove its historical audit metadata.

## Local storage

Local storage writes beneath the application's `uploads` directory: **`/app/uploads` in the official container**. Mount a persistent volume there. The app runs as UID/GID `1001`; its entrypoint prepares upload-directory ownership on startup.

Use local storage when one server has enough disk and you want the fewest moving parts. File previews and downloads stream through the Flare app, so server disk speed and network bandwidth influence transfers. The app supports range reads for media seeking.

The temporary directory is separate: `/app/tmp` contains in-progress upload state and local multipart parts. Leave it writable with enough free space. Stopping the app during a large upload can require the user to restart that upload.

## S3-compatible storage

Create a bucket and credentials with your provider, then enter:

| Setting               | What to enter                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| **S3 Bucket**         | The existing bucket name, without a URL or object path                                            |
| **Region**            | The region identifier expected by your provider                                                   |
| **Access Key ID**     | A credential dedicated to this Flare instance                                                     |
| **Secret Access Key** | Its corresponding secret                                                                          |
| **Custom Endpoint**   | Your provider's HTTP(S) S3 API origin; leave empty for the AWS regional default                   |
| **Force Path Style**  | Enable when your compatible provider expects `endpoint/bucket/key` rather than a bucket subdomain |

The provider is configured through saved instance settings. Flare does not read `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, or an IAM role as substitutes for these configured credentials. Setup validates required fields but does not perform a live bucket test.

The credential needs the object operations Flare uses: read, write, delete, object metadata, and multipart upload/complete/abort. Bucket listing and copying are used by storage-level folder operations. Provider-specific permission names differ; scope access to this bucket and test upload, download, delete, avatar, and larger multipart workflows before inviting users. Flare's dashboard folders organize database records and do not create a public directory listing in the bucket.

Thumbnail and other streamed reads keep the S3 response unread until their consumer starts reading, so response setup does not discard the image bytes. If an older build returns an empty `200` for a thumbnail, or the image optimizer returns `400` for it, update Flare and restart its replicas. Stored objects and credentials need no changes for this fix; follow [thumbnail troubleshooting](./troubleshooting#image-thumbnails-fail) if a preview remains broken.

### Private files and signed links

Keep uploaded file objects private. Flare checks file access before serving or redirecting to a signed URL. Ordinary S3 object and download links created by the current implementation generally last **six hours**; multipart part-upload URLs last **one hour**. A recipient who has an unexpired signed URL can continue using that URL until expiry, even if a later Flare permission change would deny a new request. Deleting the object removes the underlying bytes.

The S3 endpoint used in a signed URL must be reachable by users' browsers, not only by the app container. A private Docker service name is unsuitable for browser redirects. Preserve the exact signed hostname, path, and query when using a proxy in front of object storage.

### Avatar compatibility

Current S3 avatar uploads request a `public-read` object ACL and use a public avatar URL. This differs from the private signed-link flow for ordinary files. Providers that reject ACLs, or buckets that block public ACLs, can reject avatar uploads even when normal file uploads work.

AWS S3's default bucket-owner-enforced mode disables ACLs. Plan for this compatibility constraint before selecting a bucket policy; do not make all file objects public to work around an avatar failure. Test the complete account/avatar flow on your chosen provider, or use local storage if its policy cannot support the current avatar behavior. [AWS Object Ownership and ACL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html).

## Maximum upload size

The default maximum is **100 MB per file**. The setting supports MB or GB and uses powers of 1024. It applies to every role, including Administrator and roles with quota bypass. Your reverse proxy and host may impose additional request limits; [align them](/hosting/reverse-proxy#align-all-upload-limits).

This limit is checked during upload and finalization. It does not shrink or remove files uploaded before you lower it.

## User quotas

Quotas are **disabled by default**. Enabling them applies a shared per-user allowance; its starting value is **10 GB**. Each account's recorded storage usage is checked against that allowance unless its roles grant `quotas.bypass` or Administrator. Grant quota bypass independently of administration when appropriate.

This is one default quota for accounts without bypass. Flare does not currently expose separate per-account or per-role numeric quota values, shared group quotas, or reserved disk capacity. If you lower the allowance below a user's existing usage, their files remain, but further uploads are blocked until enough space is freed or the limit is raised.

## Archive processing

**Browsing and entry previews read only the bytes they need.** Listing a ZIP reads its central directory from the end of the file; listing a TAR reads member headers and skips their data; opening an entry reads that entry. They use ranged reads from the stored file: positional reads on local storage, and HTTP `Range` requests (`GetObject` with a byte range) on S3. Nothing is copied to temporary disk. On S3, each archive opening costs a size lookup plus a few small range requests for a ZIP, and one range request per member header that isn't already within the last 512 KiB read for a TAR. A TAR with many large members is therefore slower to list from S3 than from local storage.

TAR.GZ/TGZ and GZIP files are compressed as one stream, so the first listing decompresses the whole file once on the application server. This takes CPU time roughly proportional to the uncompressed size, and on S3 it downloads the whole object once. During that pass Flare records up to 256 resume points of 32 KiB each (at most 8 MiB per archive), so later entry reads decompress only from the nearest point. Listing stops after **2 minutes** or **64 GiB** of uncompressed data and keeps the entries found. Entry reads of deflated ZIP members decompress from the start of that member.

A listing stops early, with a notice, if it would use more than about **64 MiB** of memory. Finished listings stay in an in-memory cache of about **128 MiB** per process, shared by all accounts and share pages that read the same stored archive; the oldest are evicted first. A restart, or a change to the file's name, stored path, or storage target, starts a fresh listing. Up to two listings are read at once per process, with up to 32 more archives waiting; concurrent requests for the same archive share one read, and an unfinished listing that no browser is waiting for is stopped after 30 seconds. Entry responses stream directly from storage, up to 64 at once per process and 8 per account or IP address, with no total duration limit. A client disconnect stops the read, and a response nobody reads for 60 seconds is closed so it can't hold a slot; `HEAD` requests never open the entry. Storage that sends no data for 60 seconds while a response is being prepared fails that request with `504`, and a listing read that stalls entirely is stopped 60 seconds after its two-minute budget, freeing its slot even if the storage call never returns.

**Extraction and creation still stage files.** They work in a private `flare-archive-*` directory under the operating system's temporary directory, so keep room for the compressed source, expanded members, and generated output as well as other uploads in progress. Normal completion, failure, or cancellation removes that workspace. A process crash or failed removal can leave temporary files. Inspect the warning logs and, with every process using that temporary mount stopped, remove only identified abandoned workspaces. These files are temporary processing copies, not a replacement for the stored source files. At most two extraction or creation operations run per process, one per account, within a 120-second deadline; their [fixed limits](../guide/archives#supported-sizes-and-formats) apply regardless of upload settings.

Archive reads honor a file's recorded storage target. Historical files without a recorded target use the active provider, matching the older download behavior. A recorded target that is unavailable or conflicts with the current S3 configuration causes a conflict response instead of reading another bucket. Restore matching configuration or follow the [verified storage migration procedure](#changing-backend-or-bucket); do not clear provenance metadata to bypass it.

Anonymous share pages can start listings, so the per-process limits above bound that work too. Shared listing requests are limited to 120 and shared entry requests to 600 per IP per minute per process. Shared requests read at most 16 KiB under a separate five-second deadline, with up to 32 pending body reads per process. Header/origin and IP-rate checks run first; strict body validation and file authorization finish before any archive data is read. A full body-read pool returns `429` with `Retry-After: 5`; a stalled body returns `408`. These are process limits, not a distributed queue or rate budget across replicas.

Previews of protected shared archives use a short-lived unlock cookie signed with a key derived from `NEXTAUTH_SECRET`. Set the same stable secret on every replica, as [authentication already requires](./configuration). Without it, each process uses a random key, so unlocks stop working after a restart or on another replica and visitors have to reload the share page.

Reverse proxies must pass `Range` request headers and `206 Partial Content` responses through unchanged for video and audio seeking and for text previews, as they already do for ordinary video files. Response buffering does not break previews but delays their first bytes. A slow TAR.GZ listing is served by short polling requests rather than one long request, so ordinary proxy timeouts do not cut it off.

The shared-read rate budget resets when the process restarts. Client identification uses the first `X-Forwarded-For` address, then `X-Real-IP`, falling back to `127.0.0.1` when neither is present. Keep the application behind a trusted proxy that replaces incoming client-IP headers, as described in the [reverse-proxy guide](./reverse-proxy#keep-access-decisions-in-flare).

Extracting adds new file records and storage bytes while retaining the original archive. Creating an archive adds one new file while retaining all selected source files. Outputs default to private/no expiration, without inheriting the account’s default profile. An explicitly selected owned profile instead supplies sharing, tags, expiration, naming, and share style; its current permissions, revision, and effective inherited settings are checked before publication. Changing an inherited account or instance default can return `409` and require the user to review the refreshed profile summary. The normal account quota and maximum output-file size apply; quota bypass does not remove fixed archive limits. Failed operations do not publish partial output sets. Archive creation is not a backup or storage migration: preserve the database, stored files, and secrets using the [backup procedure](./maintenance).

If output objects were written before a failure, their uncommitted paths are queued for the existing [storage deletion worker](./maintenance#account-storage-cleanup) using the recorded destination target. Bytes can remain until that worker succeeds. A database failure that prevents queuing is logged and requires operator reconciliation; atomic publication of file records is not a promise that every failed storage write disappears immediately.

Archive requests and published file/folder changes can appear in the [instance audit log](/admin/audit). Archive names and opened member paths are sensitive operational metadata, even when outputs are private. Each entry request records an audit event, so watching a long video inside an archive can add several. These records use the existing best-effort audit storage and retention rules; a successful entry response does not prove that the later stream reached the recipient completely.

## Changing backend or bucket

::: warning A settings change does not move your files
There is one active storage provider for ordinary file reads and individual file deletion. New file records also retain the actual upload-time target for account cleanup; that metadata does not automatically serve files across multiple backends. Switching from local to S3, between buckets, or back again requires migrating the bytes and reconciling their storage metadata.
:::

Plan a maintenance window:

1. Take a database backup and a complete file backup.
2. Pause account deletions and let [pending account-cleanup jobs](/hosting/maintenance#account-storage-cleanup) finish against the original backend. Confirm the queue is empty before switching its identity or removing the original uploads volume.
3. Pause uploads and stop application writes while copying data.
4. Copy every object, including avatars and favicon, preserving relative keys. A database path such as `uploads/abc/image.png` maps to local `/app/uploads/abc/image.png` and S3 key `abc/image.png`.
5. Compare object counts, sizes, and representative checksums. Preserve appropriate content types and avatar access behavior. Copying bytes outside Flare does not update `File.storageTarget` or the account's `avatarStoragePath`/`avatarStorageTarget`. Record which verified copy is authoritative and [reconcile the affected metadata](#reconcile-copied-object-metadata) as part of the migration; otherwise later cleanup still follows the original target and can leave the new copy behind. Retain an inventory of old copies for separate retirement after verification.
6. Change the stored provider/bucket configuration, restart all app processes to clear cached providers, and test before reopening access.
7. Keep the old files and backup until the migrated installation is verified.

Account-cleanup jobs preserve each object's recorded upload target, even when storage settings changed before the account was deleted. Older records with no reliable target remain unresolved for operator reconciliation. Local jobs continue against the local volume after a switch to S3. S3 jobs wait when the saved bucket, region, endpoint, or path-style setting differs from their recorded target; changing the active provider alone does not cancel them. Restore matching settings during planned maintenance to resume pending work.

There is no built-in cross-provider migration wizard. Changing credentials or backend during a chunked upload can invalidate that upload; ask users to start it again after maintenance. See [backup and restore](/hosting/maintenance) for preserving the database/file relationship.

### Reconcile copied-object metadata

Keep every application writer and cleanup worker stopped while reconciling a storage move, and retain a database backup. For a file whose copied bytes have been verified, update only its inspected ID and unchanged stored path. This example records a verified local destination:

```sh
docker compose exec -T db psql -U flare -d flare \
  -v ON_ERROR_STOP=1 \
  -v file_id='VERIFIED_FILE_ID' \
  -v file_path='uploads/VERIFIED_OBJECT_PATH' \
  -v storage_target='{"provider":"local"}' <<'SQL'
UPDATE "File"
SET "storageTarget" = :'storage_target'::jsonb
WHERE id = :'file_id' AND path = :'file_path'
RETURNING id, path, "storageTarget";
SQL
```

For S3, use the complete verified [target JSON](/hosting/maintenance#resolve-an-unknown-storage-target), including provider, bucket, region, endpoint, and path style. Confirm exactly the intended row is returned. A broader migration needs a verified per-object manifest; assigning all historical records to the currently selected provider does not establish their origin.

An avatar also has `User.avatarStoragePath` and `User.avatarStorageTarget`. Reconcile those only for the verified account and object. These fields do **not** rewrite its displayed `image` URL: an old S3 public URL can still point to the old bucket. Uploading the avatar again through Profile after migration publishes a fresh URL and records its new target. Track any previous copies separately; each file or avatar records one authoritative target, not every backup or migration copy.

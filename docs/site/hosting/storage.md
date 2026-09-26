---
description: Choose local or S3-compatible storage, configure limits and quotas, and understand provider changes and signed links.
---

# Storage, limits, and quotas

Choose a storage backend during setup or under **Settings → Storage**. Changing this section requires `settings.storage`; navigating Settings also uses `settings.read`. This controls where file bytes live. PostgreSQL remains required for both backends.

<Screenshot src="/screenshots/preferences/settings-storage.png" alt="Flare Storage settings showing the storage provider and upload limits" caption="Storage and quota controls live together in Settings." />

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

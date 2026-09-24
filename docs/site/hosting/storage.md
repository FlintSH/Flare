---
description: Choose local or S3-compatible storage, configure limits and quotas, and understand provider changes and signed links.
---

# Storage, limits, and quotas

Choose a storage backend during setup or under **Settings → Storage**. This controls where file bytes live. PostgreSQL remains required for both backends.

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

The default maximum is **100 MB per file**. The setting supports MB or GB and uses powers of 1024. It applies to administrators as well as ordinary users. Your reverse proxy and host may impose additional request limits; [align them](/hosting/reverse-proxy#align-all-upload-limits).

This limit is checked during upload and finalization. It does not shrink or remove files uploaded before you lower it.

## User quotas

Quotas are **disabled by default**. Enabling them applies a shared per-user allowance; its starting value is **10 GB**. Each ordinary user's recorded storage usage is checked against that allowance. Administrators are exempt from the total quota.

This is one default quota for all ordinary users. Flare does not currently expose separate per-account quota values, group quotas, or reserved disk capacity. If you lower the allowance below a user's existing usage, their files remain, but further uploads are blocked until enough space is freed or the limit is raised.

## Changing backend or bucket

::: warning A settings change does not move your files
There is one active storage provider for the instance. Existing database records retain their storage paths; they do not retain a separate provider selection for each file. Switching from local to S3, between buckets, or back again requires migrating the bytes as well.
:::

Plan a maintenance window:

1. Take a database backup and a complete file backup.
2. Pause uploads and stop application writes while copying data.
3. Copy every object, including avatars and favicon, preserving relative keys. A database path such as `uploads/abc/image.png` maps to local `/app/uploads/abc/image.png` and S3 key `abc/image.png`.
4. Compare object counts, sizes, and representative checksums. Preserve appropriate content types and avatar access behavior.
5. Change the stored provider/bucket configuration, restart all app processes to clear cached providers, and test before reopening access.
6. Keep the old files and backup until the migrated installation is verified.

There is no built-in cross-provider migration wizard. Changing credentials or backend during a chunked upload can invalidate that upload; ask users to start it again after maintenance. See [backup and restore](/hosting/maintenance) for preserving the database/file relationship.

---
description: Run Flare on Railway with PostgreSQL, a public URL, persistent file storage, and reliable redeployments.
---

# Deploy on Railway

The [Flare Railway template](https://railway.com/template/JVT41u?referralCode=R5s8WT) is a convenient starting point. Review the generated services and variables before opening registration; a deployment template is a starting configuration, not your backup strategy.

## Required services and variables

You need a Flare service and a PostgreSQL service. Use the official Docker image or the repository's Dockerfile so Flare's startup script applies database migrations automatically.

Set these variables on the Flare service:

| Variable          | Value                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | A reference to your PostgreSQL service's connection URL, using Railway's private network where available |
| `NEXTAUTH_SECRET` | A stable random secret; generate with `openssl rand -hex 32`                                             |
| `NEXTAUTH_URL`    | Your full public HTTPS origin, such as `https://files.example.com`                                       |
| `PORT`            | `3000` when using the official image and a matching target port                                          |

Do not put an internal database hostname into `NEXTAUTH_URL`. That variable describes the address your users visit.

## Make file storage persistent

Choose one of these arrangements before uploading files:

- **Local storage:** attach a volume to the Flare service at **`/app/uploads`**. The PostgreSQL service needs its own persistent storage. Railway mounts service volumes at runtime; files written elsewhere in the application filesystem are not part of that volume. [Railway volume documentation](https://docs.railway.com/volumes).
- **S3-compatible storage:** create a bucket and enter its details during [setup](/admin/setup) or in [Settings → Storage](/hosting/storage). The app still needs writable temporary disk for in-progress uploads.

A volume mounted at `/uploads` or `/data` will not preserve Flare's default `/app/uploads` directory. Check the exact mount path.

## Domain and health check

1. Generate a Railway domain or attach your custom domain to the Flare service.
2. Route the public service to port `3000`.
3. Update `NEXTAUTH_URL` to the final HTTPS address and redeploy.
4. Set the health check path to `/api/health` and allow time for first-start migrations.
5. Open `/setup` and create your administrator account.

Railway checks the configured `PORT` during deployment. Its deployment health check does not continuously monitor your running instance, and volume-attached deployments can have a short interruption during replacement. Flare's endpoint confirms the web process responds; it does not test database, bucket, or SMTP availability. [Railway health-check behavior](https://docs.railway.com/deployments/healthchecks).

## Verify a redeployment

Upload a test file, note its share link, and redeploy the Flare service. Sign in again, check the file in your library, and download it from the saved link. If the record exists but its bytes are missing, inspect the uploads volume before adding more data.

Keep Flare running continuously so queued mail, webhook deliveries, OCR, and expiration work can run. Use one replica initially; [the hosting overview](/hosting/#multiple-replicas-and-serverless-hosts) explains why S3 alone does not make uploads stateless.

## Backups and upgrades

Retain your environment variables securely, including encryption keys. Schedule database backups and a corresponding file backup or bucket protection plan. Practice restoring into a separate service before relying on the backups.

When updating, record the current image tag/digest, take a consistent backup, then deploy your chosen release. Automatic database migrations run at startup. A prior application image is not a guaranteed rollback after a schema change; see [upgrade and restore procedures](/hosting/maintenance).

Platform limits and billing depend on your Railway plan. Verify storage capacity, request limits, and outbound SMTP availability in your project before promising a particular upload size or email workflow to users.

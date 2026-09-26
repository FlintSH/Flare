---
description: Choose a home for Flare, understand what needs to persist, and plan a reliable deployment.
---

# Host Flare your way

Flare runs as a long-lived web application with PostgreSQL and either local files or S3-compatible object storage. A single Docker deployment is a good starting point for a personal instance, family server, or small team. You can add a custom domain, email, and single sign-on when you need them.

## Choose your deployment

| Your situation                                           | Start here                                                                          | You manage                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| You have a VPS, home server, or NAS that runs containers | [Docker Compose](/hosting/docker)                                                   | Server, database, disk, backups, and HTTPS                          |
| You prefer a managed application platform                | [Railway](/hosting/railway)                                                         | Service configuration, persistence, backups, and platform costs     |
| You already operate PostgreSQL and object storage        | [Docker](/hosting/docker) with [S3 storage](/hosting/storage#s3-compatible-storage) | App deployment and connections to your existing services            |
| You develop Flare or need a custom build                 | [Run from source](/hosting/docker#build-or-run-from-source)                         | Node, dependencies, migrations, process management, and persistence |

## What runs where

```text
Browser / screenshot tool / API client
                 │ HTTPS
          Domain + reverse proxy
                 │ HTTP, private network
             Flare :3000
              /       \
       PostgreSQL     File storage
       accounts       local /app/uploads
       settings       or S3-compatible bucket
       file records
       background jobs
```

The database contains accounts, permissions, file metadata, folders, tags, short links, upload profiles, integration credentials, settings, and queued jobs. File storage holds the actual uploaded bytes, avatars, and favicon. **Both are required for recovery.** Saving one without the other is not a complete backup.

Flare also needs a writable temporary directory at `/app/tmp` in the official container. In-progress uploads use temporary files even when final storage is S3. A restart can interrupt these uploads; completed files live in your configured persistent storage.

## Before you launch

1. Decide your public address, such as `https://files.example.com`. Set it as `NEXTAUTH_URL` so generated links and authentication use the right origin.
2. Generate a stable authentication secret. Preserve it across redeployments and backups.
3. Choose storage. Local is simplest on one machine; S3 separates file capacity from the app disk.
4. Decide whether people can create accounts. Setup supports open registration or administrator-created accounts.
5. Plan a database-and-files backup before uploading anything irreplaceable.

Email is optional. A working Flare instance does not require SMTP, a domain-specific mail server, Redis, or a separate worker container. Background processing runs inside the application process.

## Capacity and availability

There is no universal minimum memory or CPU figure: image OCR, large uploads, concurrent previews, and source builds have different costs. Start with one instance, monitor memory, CPU, disk, and database connections, then adjust to your workload. [Disable background OCR](/admin/#general) if text extraction is unnecessary on a small machine.

Keep sufficient local free space for temporary uploads as well as completed local files. An upload size limit is a per-file rule, not a disk reservation. User quotas do not protect you from every source of disk growth: roles with `quotas.bypass` or Administrator are exempt, and PostgreSQL, logs, temporary data, and backups also consume space.

### Multiple replicas and serverless hosts

Use a single application replica unless you have tested your complete upload workflow across replicas. Database-backed email and webhook deliveries use leases, but that does not make the entire application stateless. Chunk-upload metadata and local multipart data use `/app/tmp`; some rate limits and OCR queues are process-local. S3 alone does not remove those constraints. A multi-replica design needs shared temporary storage or reliable upload affinity, consistent secrets, shared file access, coordinated changes, and workload-specific testing.

Hosts that suspend or terminate the process between requests are a poor fit for Flare's background work. A static web host can serve these documentation pages, but cannot run the Flare application itself.

## Your first successful deployment

You are ready when you can sign in, upload a file, open its share link in a signed-out browser, download the file, and still do all of that after recreating the app container. Continue with [first-run setup](/admin/setup), then [backups and upgrades](/hosting/maintenance).

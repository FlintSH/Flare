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

The startup script waits for PostgreSQL and runs migrations. Check `DATABASE_URL` points to the database's network hostname (`db` in the documented Compose example), not the app container's `localhost`. Check credentials, reachability, schema permissions, and database disk space.

Changing `POSTGRES_PASSWORD` in Compose does not change a password inside an already initialized PostgreSQL volume. Update the actual database account deliberately or restore the original correct environment value. Do not delete the volume to fix a password mismatch on a real instance.

If migrations failed, preserve the logs and take a database backup before corrective work. Do not substitute `prisma db push`, remove migrations, or reset the database to bypass an error.

## The site loads, but settings or sign-in fail

Check that `NEXTAUTH_URL` exactly matches the public scheme, hostname, and port you use. Recreate the container after changing it. Your proxy must preserve the public host and protocol.

All replicas must use the same authentication secret. A secret regenerated on every deploy invalidates sessions and may also make SMTP and webhook secrets unreadable. If only appearance is broken, use [appearance recovery](/admin/appearance#recover-an-unusable-appearance).

## Upload error reference

| Symptom                                       | Check                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `413` before Flare sees the request           | Reverse proxy/CDN body-size ceiling; allow multipart overhead                                      |
| Maximum upload size message                   | Settings → Storage; the per-file limit applies to admins too                                       |
| Quota exceeded                                | Ordinary user's usage versus the instance quota; admins are exempt from total quota                |
| `429`                                         | Wait for the returned retry period; avoid restarting the instance as a rate-limit workaround       |
| `401` or `403` from a tool                    | Token value, scope, expiry, revocation, and required email verification                            |
| Upload session not found after a restart      | In-progress chunk metadata was local to the previous process/filesystem; start the upload again    |
| Upload breaks after changing storage settings | Restart the upload after the storage change; active multipart sessions track storage configuration |
| Small uploads work, large ones fail           | Proxy timeouts, host request limits, temp disk, memory, and S3 multipart permissions               |

Flare has process-local request throttles as well as persistent email throttles. If unrelated users appear to share a rate limit, inspect your proxy's forwarding headers. The app should receive a trusted client IP, not a spoofed header or the same proxy IP for everyone.

## Files disappear after redeploying

If accounts and file records remain but bytes cannot be read, check your storage mount. The official local path is `/app/uploads`, and files written only into the container layer disappear when it is replaced. Restore file bytes from backup into the correct persistent volume.

If accounts and settings also disappeared, inspect the PostgreSQL volume and database URL. You may be connected to a new empty database. Do not complete setup again until you have checked whether the original data still exists.

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

Expiration is a background action; an unavailable process cannot apply it on schedule. Email and webhook jobs use durable queues and retries, while image OCR work has process-local queue state. A green `/api/health` response does not certify that any of these jobs succeeded.

## Collect a useful support report

Include the installed release/channel and commit when shown, deployment method, storage backend, a brief reproduction, HTTP status, and relevant sanitized logs with timestamps. State whether the problem began after an upgrade or configuration change.

Remove passwords, database URLs containing credentials, API/upload tokens, webhook secrets, private file links, and recovery links before posting. Report reproducible issues through the [Flare issue tracker](https://github.com/FlintSH/Flare/issues) or ask the community in [Discord](https://discord.gg/mwVAjKwPus).

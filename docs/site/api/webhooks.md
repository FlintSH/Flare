---
title: Webhooks
description: Receive file-ready events, verify signatures, and operate reliable Flare automations.
---

# Webhooks

Managing destinations, signing secrets, tests, and delivery controls requires `webhooks.manage`. It is separate from `tokens.manage` and remains session-only. Removing `webhooks.manage` hides and blocks configuration actions; existing enabled destinations and queued deliveries continue. Disable/delete a destination explicitly when you intend to stop that connection. Roles do not add role-change webhooks or change the `file.ready` JSON Schema, signature, ordering, retry, or deduplication contract described below.

A webhook tells your service when a Flare upload has finished. Use it to notify a team, record an upload in another system, or queue your own workflow. Flare sends an HTTP POST to a destination you control.

Webhooks belong to individual accounts. A destination receives events for its owner's files, including private files. It does not receive every user's uploads just because its owner is an administrator.

## Connect a receiver

1. Make your receiver reachable at an HTTPS URL, such as `https://automation.example.com/flare`.
2. Open **Profile → Integrations** in Flare and create a webhook with a recognizable name and the receiver URL.
3. Save the one-time `whsec_…` signing secret in your receiver's secret store.
4. Configure the receiver to verify signatures and timestamps before processing events.
5. Send a test from Flare. Check both your receiver's logs and Flare's delivery history.
6. Upload a small file and confirm that a real `file.ready` event reaches the receiver.

There can be **10 webhooks per account**. Names are 1–80 characters; URLs can be at most 2,048 characters and cannot contain embedded credentials or fragments. Destinations are checked when created and again on delivery.

Webhook management uses your signed-in dashboard session. A named API token cannot create destinations, read secrets, send tests, or retry deliveries.

## The file-ready event

Flare currently emits one event type: **`file.ready`**, payload **version 1**. It is recorded in the same database transaction that publishes a successful upload. Multipart and chunked uploads use the same contract. Failed uploads do not create a normal event.

```json
{
  "version": 1,
  "id": "file.ready:cm_example",
  "type": "file.ready",
  "occurredAt": "2026-09-20T12:00:00.000Z",
  "data": {
    "id": "cm_example",
    "name": "screenshot.png",
    "mimeType": "image/png",
    "sizeBytes": 204800,
    "visibility": "PUBLIC",
    "passwordProtected": false
  }
}
```

| Field                    | Meaning                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `version`                | Schema version; currently `1`.                                                             |
| `id`                     | Stable event ID, normally `file.ready:` followed by the file ID. Use it for deduplication. |
| `type`                   | `file.ready`.                                                                              |
| `occurredAt`             | File upload time in ISO 8601 format; unchanged on retries.                                 |
| `data.id`                | Flare's file record ID.                                                                    |
| `data.name`              | File display name.                                                                         |
| `data.mimeType`          | File MIME type.                                                                            |
| `data.sizeBytes`         | Integer file size in bytes.                                                                |
| `data.visibility`        | `PUBLIC` or `PRIVATE` at upload time.                                                      |
| `data.passwordProtected` | Whether a password was set. The password itself is never included.                         |

[Download the complete JSON Schema](/file-ready-event.schema.json). Optional OCR runs separately; `file.ready` does not mean that OCR is complete, and Flare does not emit a separate OCR-completion event.

The payload does not contain file contents, storage paths, share URLs, passwords, OCR text, user account details, or presigned URLs. It is a metadata notification, not a download credential. `files:read` can list metadata in your account, but named tokens do not unlock private file downloads.

### Test events

A test has the same version/type and data fields, adds **`"test": true`**, and uses an ID beginning with `test:`. Its sample file is `example.png` with ID `example-file`. It does not create a file or consume your file quota. Branch on `test === true` when production side effects would be inappropriate.

Tests use the normal delivery queue and signature protocol. Each destination can receive **10 test sends per hour**. A paused webhook must be enabled before testing.

## Verify each delivery

Requests use `Content-Type: application/json` and `User-Agent: Flare-Webhooks/1`. These headers carry the signature information:

| Header              | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| `X-Flare-Event-Id`  | The payload's stable event ID.                                |
| `X-Flare-Timestamp` | Time of this delivery attempt, as Unix seconds.               |
| `X-Flare-Signature` | `v1=` followed by a lowercase hexadecimal HMAC-SHA256 digest. |

The signed message is:

```text
timestamp + "." + exact raw HTTP request body
```

Use the **entire signing-secret string**, including `whsec_`, as the HMAC key. Do not decode the prefix or secret suffix. Each attempt gets a new delivery timestamp and signature, while the event ID and payload remain stable.

Your receiver should:

1. Limit the incoming body size and preserve its original bytes.
2. Check that the timestamp is numeric and within a freshness window, for example five minutes in either direction. Keep clocks synchronized.
3. Compute the expected HMAC and compare signatures using a timing-safe comparison after checking equal lengths.
4. Parse and validate the payload, including `version`, `type`, and agreement between its `id` and `X-Flare-Event-Id`.
5. Persist or deduplicate the event before acknowledging it.

::: warning Verify before parsing and reserializing
Signing is over the exact bytes Flare sent. Parsing JSON and then calling `JSON.stringify` can change whitespace or property order and cause verification to fail. Capture the raw body before framework JSON middleware transforms it.
:::

The [runnable receiver](/integrations.mjs) demonstrates raw-body verification, a five-minute timestamp window, event-ID matching, body limits, and duplicate handling with Node.js built-ins. For production, validate all payload fields against the schema and replace its in-memory duplicate cache with durable storage.

```sh
# Supply FLARE_WEBHOOK_SECRET from your secret manager.
# Run from the repository checkout:
node examples/integrations.mjs receive
```

It listens on `/webhook` at port `8787`; `PORT` changes the port. If you downloaded the example directly, run `node integrations.mjs receive`. Publish it through your HTTPS reverse proxy, or use the operator-controlled private-network setting below for a local receiver.

## Accept quickly and handle duplicates

Return any **2xx** status after you have durably accepted the event. A `204` with an empty body is sufficient. Queue expensive work in your receiver instead of doing it before the HTTP response.

Retries mean **duplicate deliveries are possible**. For example, your receiver can commit an action, but the connection can fail before Flare records its acknowledgment. Store `event.id` in a table with a unique constraint, and record your side effect or queued job in the same transaction. If the ID already exists, return 2xx without repeating the action.

Do not assume global event ordering. Several deliveries can run concurrently, and an older event being retried can arrive after a newer one. A webhook is also not a guaranteed complete audit log: queue-capacity overflow can skip events, and changed file access can cancel queued events.

## Retries and delivery states

The application worker checks for deliveries every **five seconds**. Database leases coordinate a global maximum of **four concurrent deliveries** across application replicas. Normal scheduling can be later than a nominal retry time if the worker is busy or the application is offline.

| Receiver result                          | What Flare does                                      |
| ---------------------------------------- | ---------------------------------------------------- |
| Any 2xx                                  | Marks the delivery `delivered`.                      |
| HTTP 408 or 429                          | Retries while attempts remain.                       |
| HTTP 5xx or a connection/timeout failure | Retries while attempts remain.                       |
| Other HTTP 3xx or 4xx                    | Marks it `failed` without another automatic attempt. |

Redirects are never followed. Configure the exact receiver URL; a `301` from an HTTP-to-HTTPS or trailing-slash redirect is a delivery failure.

There are **five total attempts**, with delays after failures of **1 minute, 5 minutes, 30 minutes, and 2 hours**. Flare uses that schedule rather than the receiver's `Retry-After` header.

| State        | Meaning                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `pending`    | Waiting for its next scheduled attempt.                                                         |
| `processing` | Claimed by a worker and being handled. A 60-second lease permits recovery after worker failure. |
| `delivered`  | The receiver acknowledged with 2xx.                                                             |
| `failed`     | A permanent failure or the attempt limit was reached.                                           |
| `cancelled`  | Paused destination or an invalidated source-file event.                                         |

In **Profile → Integrations**, delivery history includes attempts, the next available time, delivery time, and a sanitized error. It shows the **latest 50 deliveries**. Terminal history (`delivered`, `failed`, `cancelled`) is removed after **30 days**, with cleanup checked hourly by the worker.

### Retry, pause, or remove a destination

A failed delivery can be manually retried once it has been failed for at least **one minute**, provided the webhook is enabled and the queue has room. Retry resets its attempt count and starts another bounded delivery cycle with the same event ID. Receiver deduplication must still apply.

Pausing a webhook cancels its pending and processing records. Re-enabling it accepts new events; it does not replay cancelled history or uploads that happened while paused. Deleting a webhook removes its configuration and associated delivery records. An HTTP request already in flight can still arrive after a pause or deletion.

Before sending a normal event, Flare checks that the file still belongs to the webhook owner and has the same visibility and password-protection state as the payload. It cancels delivery when the file has been removed, moved to another owner, or changed that state. It compares whether a password exists, not the password's actual value.

## Queue and network limits

| Limit                                     | Value      |
| ----------------------------------------- | ---------- |
| Pending/processing deliveries per webhook | 1,000      |
| Pending/processing deliveries per account | 5,000      |
| Outgoing payload                          | 64 KiB     |
| Receiver response body                    | 32 KiB     |
| Receiver response headers                 | 8 KiB      |
| DNS lookup                                | 3 seconds  |
| HTTP attempt                              | 10 seconds |

At queue capacity, new events for the affected destinations are **skipped** so uploading can continue. Skipped events are not replayed when space becomes available. Fix or pause stalled receivers promptly and use your own reconciliation process if every upload must be accounted for. Response bodies are not saved in history; inspect the receiver's logs for its application-level error details.

## Operator configuration

### Public or private destinations

By default, webhooks require HTTPS and must resolve **only to public IP addresses**. Every delivery re-resolves DNS, checks every returned address, and pins the connection to a validated address. Loopback, private, link-local, and other reserved destinations are rejected.

For an intentionally private automation service, the operator can set:

```dotenv
FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK=true
```

This also permits `http://` destinations. It applies to the whole deployment and allows users' webhooks to reach networks accessible to the server. Enable it only when that access is part of the intended hosting policy; it is not a per-webhook switch. The exact lowercase value `true` enables it.

### Keep the encryption key stable

Signing secrets are encrypted in the database. The effective key comes from `FLARE_EMAIL_ENCRYPTION_KEY`, or the file named by `FLARE_EMAIL_ENCRYPTION_KEY_FILE`; set only one. Without a dedicated key, Flare uses `NEXTAUTH_SECRET`. The effective secret must have at least 32 characters.

SMTP and webhook secrets use separate encryption purposes, but share this key configuration. Preserve the key with your database backups and across application replicas. Changing it without migrating encrypted data makes existing signing secrets unreadable; recreate affected webhook destinations and configure their new secrets at the receivers.

The durable queue lives in PostgreSQL and the worker runs inside the application. A deployment must keep a Node.js application process running for background deliveries; a static export or scale-to-zero host cannot independently process pending events.

## Diagnose a failing receiver

| Symptom                                     | Next check                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| URL rejected during creation                | HTTPS, no credentials/fragment, DNS resolves entirely to allowed public addresses.                       |
| Test stays pending                          | Application worker is running, database reachable, webhook enabled, retry time reached.                  |
| Immediate failure with 301/302/307/308      | Use the receiver's final URL directly.                                                                   |
| HTTP 401 from receiver                      | Correct one-time secret, unmodified raw body, current clock, correct HMAC prefix.                        |
| Generic connection/network/encryption error | DNS/firewall/TLS reachability from Flare, response size/time limits, stable encryption key.              |
| Duplicate notification                      | Deduplicate by event ID in durable receiver storage.                                                     |
| Event cancelled                             | Source file removed or changed visibility/password protection, or webhook paused.                        |
| Some uploads have no delivery record        | Check enabled state at upload time and queue capacity; `file.ready` only covers newly finalized uploads. |

Flare offers HTTP APIs and outbound events. There is no server plugin loader or stable in-process extension SDK implied by these integrations.

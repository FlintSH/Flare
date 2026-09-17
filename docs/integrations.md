# Integrations

## Screenshot tools and scripts

Open **Profile → Uploads → Screenshot tools and scripts**
(`/dashboard/profile?section=uploads#upload-tools`) to set up ShareX, iTake, Flameshot,
Spectacle, or Bash. Download the configuration or script for your tool; it already
includes your account's upload token. You do not need to create or copy an API
token first.

Open the downloaded `.sxcu` file to import it into ShareX. For Flameshot,
Spectacle, and Bash, follow the installation and usage instructions at the top of
the downloaded script. Keep these files private because they contain your upload
credential. To use particular sharing settings, download a client from a saved
[upload profile](upload-profiles.md).

### macOS screenshots and screen recordings with iTake

[iTake](https://github.com/SerStars/iTake) is a free, open-source macOS capture
app for screenshots and screen recordings. It requires **macOS 15 (Sequoia) or
newer**, on Apple Silicon or Intel.

1. [Install iTake](https://github.com/SerStars/iTake/releases/latest) and open it.
   Follow its [installation instructions](https://github.com/SerStars/iTake#installing)
   if macOS blocks the first launch. Allow screen recording access when prompted.
2. In Flare, open **Profile → Uploads → Screenshot tools and scripts → Set Up iTake**
   and click **Download Config**. To use a specific saved upload profile, click
   **iTake** under that profile's **Use this profile in your tools** section instead.
3. Open the downloaded `.itup` file and confirm **Import** in iTake. The server URL
   and upload token are already included; no manual fields or API key setup are needed.
4. In iTake's **Preferences → Uploader**, select **Flare — Account defaults** (or
   **Flare — your profile name**), enable **Upload Automatically**,
   and leave **Auto Copy Link** enabled. If prompted on the first upload, allow
   iTake to access its uploader credential in Keychain.

Capture a screenshot or finish a recording to upload it and copy its Flare share
link. The config follows your default upload profile unless downloaded for a
specific profile. Flare's upload size, visibility, and expiration settings still
apply to both images and videos.

Keep the downloaded config private: it contains your upload token. If you
regenerate that token or change your Flare server URL, remove the old uploader in
iTake, then download, import, and select a new config. Flameshot's generated script
is **Linux only**; use iTake on macOS.

## Named API tokens

Open **Profile → Integrations** (`/dashboard/profile?section=integrations`) for
optional named API tokens, webhooks, and delivery history. These connections
belong to your account. Use a named token for a custom integration or when you
want separate permissions, expiration, or revocation for a tool.

Create a separate named token for each such connection. Copy the value when it is first
shown; Flare stores only its SHA-256 hash. Tokens can expire, can be revoked
individually, and optionally bind uploads to one of your upload profiles. A bound
token cannot choose a different profile or change the profile's upload options.
Deleting its bound profile does not silently remove this restriction.

Integration management requires an interactive signed-in session. Named API
tokens cannot create other tokens, read your account upload token, change account
settings, or manage webhooks.

Send `Authorization: Bearer flr_…` with requests. Available scopes are:

| Scope          | Allowed operations                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `files:upload` | Upload a file; start, inspect, cancel and complete chunked uploads; upload/inspect chunk parts |
| `files:read`   | List your files and available file types                                                       |
| `urls:read`    | List your short links                                                                          |
| `urls:write`   | Create and delete your short links                                                             |

Scopes only grant the listed routes and methods. They do not grant administrator
or account-management access, even for an administrator-owned token. Existing
legacy upload tokens continue to work. There is a limit of 50 active named tokens
per account; revoke old tokens to free capacity.

The [runnable example](../examples/integrations.mjs) uses Node.js 20+ built-in
modules. Set `FLARE_URL` and `FLARE_TOKEN` in your environment, then run:

```sh
node examples/integrations.mjs upload ./screenshot.png
```

The example sends a multipart `file` field to `POST /api/files`; the selected
token's bound profile is applied by Flare. The JSON response is printed to stdout.
Keep bearer credentials in environment variables or a secret manager, not in
shared uploader configuration files.

## File-ready webhooks

Add a receiver URL and save its one-time signing secret. The secret is encrypted
using the existing secret-encryption key with a distinct `integrations.webhook.v1`
purpose. Keep the deployment's `FLARE_EMAIL_ENCRYPTION_KEY` (or mounted
`FLARE_EMAIL_ENCRYPTION_KEY_FILE`) stable; when absent, encryption uses
`NEXTAUTH_SECRET`. Changing the effective key requires recreating webhook secrets.

Flare records `file.ready` events in the same database transaction that finalizes
the file. Failed uploads do not create these events. Optional OCR may finish
later. Normal and chunked uploads use the same event contract, also provided as a
[JSON Schema](file-ready-event.schema.json):

```json
{
  "version": 1,
  "id": "file.ready:cm_example",
  "type": "file.ready",
  "occurredAt": "2026-09-13T12:00:00.000Z",
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

Only your own file events go to your receivers. Metadata for private uploads is
included, but file contents, storage paths, passwords, OCR text, account details,
and presigned URLs are excluded. Before delivery, Flare cancels the event if the
file was deleted, changed owner, or changed visibility or password protection.
Test events use the same shape, add `test: true`,
and have an ID beginning with `test:`; they do not create a file.

Each POST includes:

| Header              | Value                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `X-Flare-Event-Id`  | Stable event ID, unchanged on retries                                                           |
| `X-Flare-Timestamp` | Delivery attempt time as Unix seconds                                                           |
| `X-Flare-Signature` | `v1=` followed by hex HMAC-SHA256 of `timestamp + "." + rawBody`, keyed with the signing secret |

Verify the signature against the original request bytes using a timing-safe
comparison, reject timestamps more than five minutes old, and deduplicate by
event ID. Delivery is **at least once**: a receiver can acknowledge a request
before Flare loses the connection or its worker lease. For durable side effects,
store the processed event ID and your action in a single database transaction.
Return a 2xx status after accepting the event.

Set `FLARE_WEBHOOK_SECRET` in the environment and start the sample receiver:

```sh
node examples/integrations.mjs receive
```

It listens at `/webhook` on port 8787 (`PORT` overrides this). Put it behind an
HTTPS reverse proxy for public deployment. The example validates signatures and
timestamps and demonstrates deduplication; its in-memory event cache does not
survive a restart.

## Delivery behavior and operator settings

The application startup hook runs the durable worker every five seconds. Database
leases coordinate up to four concurrent deliveries across replicas. Network
failures, HTTP 408/429 and server errors retry up to five total attempts with
backoffs of 1 minute, 5 minutes, 30 minutes, and 2 hours. Other 3xx/4xx statuses
fail immediately; redirects are never followed. DNS resolution is limited to
three seconds, each HTTP attempt to ten seconds, response bodies to 32 KiB, and
outgoing event payloads to 64 KiB. Response bodies are not saved in history.

Destinations must use HTTPS and resolve exclusively to public IP addresses. Every
delivery rechecks DNS and pins the actual connection to the validated result.
URLs cannot contain embedded credentials or fragments. For an operator-controlled
private automation server or local fixture, set
`FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK=true`; this also permits HTTP. This setting
allows users' receivers to reach the deployment's private network, so enable it
only when that is the intended deployment policy.

The dashboard shows the latest 50 deliveries. Completed, failed, and cancelled
history is removed after 30 days. A failed delivery can be manually retried after
one minute; this starts another bounded attempt cycle. Pausing a webhook cancels
queued attempts, and enabling it does not replay cancelled history. An HTTP
request already in flight can still arrive after pause/delete. Test sends are
limited to ten per webhook per hour; each account can have ten webhooks.

The pending queue is limited to 1,000 deliveries per webhook and 5,000 per
account. When a receiver reaches its limit, new file notifications for that
receiver are skipped while the upload succeeds. Existing queued notifications
remain durable. Recover or disable stalled receivers to restore delivery capacity;
events skipped at capacity are not replayed later.

This milestone exposes APIs and outbound events. It does not load arbitrary
server code or promise a stable in-process plugin SDK.

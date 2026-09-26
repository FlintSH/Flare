---
title: API & integrations
description: Connect your tools to Flare with scoped API tokens, uploads, short links, and signed webhooks.
---

# Build with Flare

Upload from a script, publish a build artifact, make a short link, or notify your own service when a file is ready. Flare's HTTP API uses your existing account, storage, and sharing settings. Named API tokens let each connection have its own permissions and lifetime.

You need a running Flare instance and an account. Every example uses `https://files.example.com` as a placeholder for **your instance**, not a shared Flare service.

## Your first upload

1. Open **Profile → Integrations** on your Flare instance.
2. Create a named API token with **`files:upload`**. Give it a recognizable name, such as “Build artifacts,” and choose an expiration if appropriate.
3. Copy the secret when it appears. Flare cannot show it again.
4. Set `FLARE_URL` to your instance's HTTPS origin and provide `FLARE_TOKEN` through your shell environment or secret manager.
5. Send one file:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./screenshot.png' \
  "$FLARE_URL/api/files"
```

The response includes `data.pageUrl`, the share page to send to someone, alongside raw and download URLs. Let your HTTP client generate the multipart `Content-Type` boundary; do not set that header yourself.

<Screenshot src="/screenshots/handbook/integrations.webp" alt="The Flare profile integrations screen with API tokens and webhooks" caption="Each account manages its own tokens, webhook destinations, and delivery history in Profile → Integrations." />

## Explore a request

Use the builder to see how your choices change a request. It generates a command locally; run the command against your own instance when you are ready.

<ApiPlayground />

## Choose the right connection

| What you want to do                             | Start here                                    |
| ----------------------------------------------- | --------------------------------------------- |
| Give a script only the permissions it needs     | [Authentication and scopes](./authentication) |
| Upload, list, search, or filter files           | [Files API](./files)                          |
| Upload a large file in parts                    | [Chunked uploads](./files#chunked-uploads)    |
| Create, list, or remove short links             | [Short links API](./short-links)              |
| Run your own automation after an upload         | [Webhooks](./webhooks)                        |
| Start with working code                         | [Recipes](./recipes)                          |
| Understand the rest of the application's routes | [Endpoint inventory](./endpoint-inventory)    |

For ShareX, iTake, Flameshot, Spectacle, and Bash, Flare can generate the uploader configuration for you in **Profile → Uploads → Screenshot tools and scripts**. Those downloads already contain your account upload credential. Named tokens are useful when building a custom connection, restricting permissions, or revoking one tool independently.

## Machine-readable references

- [Download the OpenAPI 3.1 document](/openapi.json) for all routes supported by named API tokens. Import it into an API client and replace the server URL with your instance.
- [Download the `file.ready` JSON Schema](/file-ready-event.schema.json) for validating webhook payloads.
- [Read the runnable Node.js example](https://github.com/FlintSH/Flare/blob/main/examples/integrations.mjs). It supports both uploading and receiving signed webhooks without extra packages.

The OpenAPI security scheme is HTTP Bearer authentication. Flare's permission names are application scopes; this is not an OAuth authorization flow.

## Response conventions

The API has a few established response shapes. Check the HTTP status before reading the body, and use the reference for the endpoint you call.

| Operation                                                  | Successful response                                     |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| Multipart upload, file types, create/list short links      | `{ "success": true, "data": ... }`                      |
| List files                                                 | `{ "success": true, "data": [...], "pagination": ... }` |
| Initialize upload, obtain part URL, upload part            | `{ "data": ... }`                                       |
| Complete with `PUT /api/files/chunks`                      | `{ "data": ... }`                                       |
| Complete with `POST /api/files/chunks/{uploadId}/complete` | Upload links directly, with no `data` wrapper           |
| Delete short link                                          | `204 No Content`, with no JSON body                     |

Errors contain an `error` string. Some include `success: false`; others do not. Authentication failures are `401` with `{ "error": "Unauthorized" }`, including an expired token or a missing scope. Authenticated requests without the required role permission return `403`. Do not depend on a `success` field being present on every response.

## Limits and compatibility

Uploads follow the same maximum file size, storage quotas, file checks, upload profiles, and expiration rules as the dashboard. There is no separate API storage pool. A named token owned by an administrator still has only its selected API scopes. Every token request also requires the owner's current role permission; role revocation applies on the next request.

The API paths currently have no version prefix. These references describe the implementation shipped with the documentation. Webhook payloads do carry an explicit `version: 1`; check that field when processing events. Use the documentation from your Flare release when maintaining an older instance.

Named tokens currently cover file listing/uploads and short links. Account administration, token/webhook management, file deletion, changing an existing file's settings, and organization management are dashboard operations. The [endpoint inventory](./endpoint-inventory) identifies their authentication boundaries without implying that they are additional bearer-token APIs.

---
title: Short links API
description: Create and manage account-owned short links with scoped tokens.
---

# Short links API

The token owner's current role permissions also apply: `links.read` for listing, `links.create` for creation, and `links.delete` for deletion. The `urls:write` scope does not bypass these separate account permissions. Losing dashboard/API permission does not disable existing public redirects; delete the link to revoke its redirect.

Flare can turn an HTTP or HTTPS destination into a short URL under your own domain. Short links belong to your account and track redirect counts.

Use `urls:write` to create or delete links and `urls:read` to list them. These permissions are independent of file-upload permissions.

## Create a short link

**`POST /api/urls`** · Scope: **`urls:write`** · Body: **`application/json`**

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/a/long/path"}' \
  "$FLARE_URL/api/urls"
```

The `url` property is required and must be an absolute HTTP or HTTPS URL. Other protocols, such as `file:` or `javascript:`, are rejected. Successful creation returns **200**:

```json
{
  "success": true,
  "data": {
    "id": "cm_link",
    "shortCode": "aB3_dE",
    "targetUrl": "https://example.com/a/long/path",
    "clicks": 0,
    "createdAt": "2026-09-20T12:00:00.000Z",
    "userId": "cm_account"
  }
}
```

The response returns a code rather than a complete short URL. Combine your instance origin with `/u/` and `shortCode`:

```text
https://files.example.com/u/aB3_dE
```

Flare generates a unique six-character code. There is no API parameter for a custom code, link password, expiration, or editable destination. Repeating creation can create another short link to the same target; it is not an idempotent lookup.

## List your short links

**`GET /api/urls`** · Scope: **`urls:read`**

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  "$FLARE_URL/api/urls"
```

```json
{
  "success": true,
  "data": {
    "urls": [
      {
        "id": "cm_link",
        "shortCode": "aB3_dE",
        "targetUrl": "https://example.com/a/long/path",
        "clicks": 12,
        "createdAt": "2026-09-20T12:00:00.000Z",
        "userId": "cm_account"
      }
    ]
  }
}
```

Links are ordered newest first. The endpoint returns the account's whole list; it has no pagination or filtering parameters. An empty account receives `data.urls: []`.

## Delete a short link

**`DELETE /api/urls/{id}`** · Scope: **`urls:write`**

Use the record's **`id`**, not its `shortCode`:

```sh
curl --fail-with-body --request DELETE \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  "$FLARE_URL/api/urls/$FLARE_LINK_ID"
```

Success is **204 No Content**. Do not try to parse an empty successful response as JSON. A missing link returns `404` with `{ "success": false, "error": "URL not found" }`. A link owned by another account returns `403` with `{ "success": false, "error": "Unauthorized" }`.

Deletion stops future redirects through that code. It does not delete the target resource. Deleting an already deleted link returns `404`, so a client may treat “already absent” as its desired final state.

## What visitors see

`GET /u/{shortCode}` is a public redirect route. It increments the link's click count and sends the visitor to the target URL. It does not require a Flare account. A missing/deleted code returns `404`.

The count reflects redirect requests, including requests from bots and link previews. It is not a unique-person analytics metric. A short link does not change the destination's permissions: a target private file remains private.

## Error handling

Invalid destinations return `400` with an `error` message and `success: false`. Missing or insufficient credentials return `401` with `{ "error": "Unauthorized" }`. An authenticated account missing the required current role permission receives `403`. Server failures return `500`. Submit valid JSON: malformed JSON can currently reach the general `500` handler rather than a distinct parse-error response.

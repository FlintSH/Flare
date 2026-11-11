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

The `url` property is required and must be an absolute HTTP or HTTPS URL. Other protocols, such as `file:` or `javascript:`, are rejected.

A target whose part after `#` has the form of a Flare key is rejected with **400**: 43 base64url characters, alone or after a prefix such as `p.`. That is the link of an [encrypted file](/guide/encryption#a-link-is-the-key), and a short link would store its key on the server as plain text. The error is `This link has an encryption key after #. A short link is stored on the server, so shortening it would give the server the key. Share the full link instead.` Nothing is stored, and the refused address is not written to the audit log. The dashboard form applies the same rule before it sends anything, so a browser never transmits the key; a script that sends such a link has already sent it. An ordinary fragment such as `#installation` or `#t=10` is accepted. Successful creation returns **200**:

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

Flare generates a unique six-character code. When a drawn code is already taken, including by a request that arrives at the same moment, Flare draws another, up to five times. Earlier versions answered that concurrent case with `500`. There is no API parameter for a custom code, link password, expiration, or editable destination. Repeating creation can create another short link to the same target; it is not an idempotent lookup.

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

Links are ordered newest first. The endpoint returns the account's whole list; it has no pagination or filtering parameters. An empty account receives `data.urls: []`. The answer carries `Cache-Control: private, no-store`; earlier versions sent no caching header with it.

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

`GET /u/{shortCode}` is a public redirect route. It increments the link's click count and sends the visitor to the target URL. It does not require a Flare account. A missing/deleted code returns `404`. The [audit log](/admin/audit) records each redirect as an `http.get` request event that names the link by its short code; the click increment itself is not a separate change event.

The count reflects redirect requests, including requests from bots and link previews. It is not a unique-person analytics metric. A short link does not change the destination's permissions: a target private file remains private.

## Error handling

Invalid destinations return `400` with an `error` message and `success: false`. Missing or insufficient credentials return `401` with `{ "error": "Unauthorized" }`. An authenticated account missing the required current role permission receives `403`. Server failures return `500`. Malformed JSON returns `400` with `{ "success": false, "error": "Invalid JSON." }`. A request a browser session makes must also follow the [browser-session write rule](./authentication#browser-session-writes): from another origin it returns `403`, and with a body not sent as `application/json` it returns `415`. Token requests aren't checked this way.

## Moderation routes

**Admin → Users → View content** uses two routes to inspect and remove another account's links. Both need a browser session: named tokens and the upload credential are refused, whatever their owner's roles. Without a session they return `401` with `{ "error": "Authentication required" }`; without the permission, `403` with `{ "error": "Permission denied" }`.

**`GET /api/users/{id}/urls`** · Permission: **`content.read`**

Lists the links owned by account `{id}`, newest first, one page at a time:

| Parameter | Default | Values                                                                      |
| --------- | ------- | --------------------------------------------------------------------------- |
| `page`    | `1`     | Positive integer. A page past the last one returns the last page.           |
| `limit`   | `10`    | Positive integer, at most `100`.                                            |
| `search`  | none    | Text matched anywhere in the code or the destination, ignoring letter case. |

A `page` or `limit` that isn't a positive integer uses its default. The body has no `success` field, and its links leave out `userId`:

```json
{
  "urls": [
    {
      "id": "cm_link",
      "shortCode": "aB3_dE",
      "targetUrl": "https://example.com/a/long/path",
      "clicks": 12,
      "createdAt": "2026-09-20T12:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "pages": 1, "page": 1, "limit": 10 }
}
```

`pagination.page` is the page actually returned. With no matching links, `pages` is `0` and `page` is `1`. Earlier versions used `page` and `limit` as given: a value that wasn't a number, or a page below 1, returned `500`, a page past the end returned an empty list, and `limit` had no maximum.

**`DELETE /api/users/{id}/urls/{urlId}`** · Permission: **`content.delete`**

Deletes the link only while account `{id}` owns it; see [content moderation deletion](./roles#content-moderation-deletion).

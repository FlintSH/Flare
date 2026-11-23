---
title: Short links API
description: Create short links with random or chosen endings, change where they lead, and list and delete them with scoped tokens.
---

# Short links API

Flare can turn an HTTP or HTTPS destination into a short URL under your own domain. Short links belong to your account and track redirect counts.

Use `urls:write` to create, change or delete links and `urls:read` to list them. These scopes are independent of file-upload permissions. The token owner's current role permissions also apply: `links.read` for listing, `links.create` for creation, `links.delete` for deletion, and both `links.create` and `links.delete` for changing a destination. The `urls:write` scope does not bypass these account permissions. Losing dashboard/API permission does not disable existing public redirects; delete the link to revoke its redirect.

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

To choose the ending, add `code`:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/a/long/path","code":"launch"}' \
  "$FLARE_URL/api/urls"
```

| Field  | Required | Rules                                                                                                                                                                                                 |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`  | Yes      | Absolute `http://` or `https://` URL.                                                                                                                                                                 |
| `code` | No       | 1 to 64 of `A–Z`, `a–z`, `0–9`, `-` and `_`, after trimming spaces. Omitted, `null` or empty: a random six-character code. Case-sensitive, but refused while any link uses it in another letter case. |

Successful creation returns **200**:

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

Without `code`, Flare generates a unique six-character code. When a drawn code is already taken, including by a request that arrives at the same moment, Flare draws another, up to five times. Earlier versions answered that concurrent case with `500`.

A chosen `code` that any link already uses, in any letter case, returns `409` with `{ "success": false, "error": "That ending is already taken. Choose another." }`. Two requests choosing `Launch` and `launch` at the same moment can't both succeed. Codes from a deleted link become free again, for any account.

Earlier versions had no `code` field and ignored it if sent, so a client that sends one to an older Flare gets a random code; check `shortCode` in the answer. There is no API parameter for a link password or expiration. Repeating creation can create another short link to the same target; it is not an idempotent lookup.

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

Links are ordered newest first. The endpoint returns the account's whole list, without pagination. Add `?id=cm_link` to fetch just one of your links: `data.urls` then holds that link, or is empty when no link of yours has that id (an empty id, or one longer than 64 characters, matches nothing). Earlier builds ignored `id` and always returned the whole list. An empty account receives `data.urls: []`. The answer carries `Cache-Control: private, no-store`; earlier versions sent no caching header with it.

## Change where a link leads

**`PATCH /api/urls/{id}`** · Scope: **`urls:write`** · Body: **`application/json`** · Permissions: **`links.create`** and **`links.delete`**

```sh
curl --fail-with-body --request PATCH \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/the/new/path"}' \
  "$FLARE_URL/api/urls/$FLARE_LINK_ID"
```

The body has one field, `url`, with the same rules as creation; any other field, including `code`, returns `400`. A link's code never changes, so every copy already shared follows the new destination. Its click count is kept. Success returns **200** with the updated link, in the same shape as creation. A missing link returns `404` with `URL not found`, and another account's link `403` with `Unauthorized`, as for deletion. A role with only one of `links.create` and `links.delete` receives `403`: changing a destination retires the old redirect, as a delete would, and makes a new one.

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

Invalid destinations and codes return `400` with an `error` message and `success: false`; a taken code returns `409`. Missing or insufficient credentials return `401` with `{ "error": "Unauthorized" }`. An authenticated account missing the required current role permission receives `403`. Server failures return `500`. Malformed JSON returns `400` with `{ "success": false, "error": "Invalid JSON." }`. A request a browser session makes must also follow the [browser-session write rule](./authentication#browser-session-writes): from another origin it returns `403`, and with a body not sent as `application/json` it returns `415`. Token requests aren't checked this way.

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

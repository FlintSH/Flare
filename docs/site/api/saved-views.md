---
title: Saved views dashboard API
description: Session-only request and response contracts for private saved library views, including revisions and missing references.
---

# Saved views dashboard API

These routes support the [Saved views controls](../guide/saved-views) in Files. They require the current account's **browser session**. Neither named API tokens nor the legacy account upload token authorize them; requests with an `Authorization` header are rejected. An administrator uses their own account's views, not another user's views.

The [OpenAPI download](/openapi.json) covers the named-token API and deliberately excludes these session-only operations. The [endpoint inventory](./endpoint-inventory#dashboard-account-routes-requiring-a-browser-session) records their authentication boundary.

## Routes and responses

| Method and path                | Request                                                                | Successful result                                  |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/saved-views`         | No body.                                                               | `{ "success": true, "data": [SavedView, ...] }`    |
| `POST /api/saved-views`        | `{ "name": "Receipts", "pinned": true, "filters": { ... } }`           | `{ "success": true, "data": SavedView }`           |
| `PATCH /api/saved-views/{id}`  | Current `revision` and at least one of `name`, `pinned`, or `filters`. | `{ "success": true, "data": SavedView }`           |
| `DELETE /api/saved-views/{id}` | `{ "revision": 1 }` using the current revision.                        | `{ "success": true, "data": { "deleted": true } }` |

All successful operations return `200`. Mutations require same-origin JSON requests with `Content-Type: application/json`; the body is limited to 16 KiB of UTF-8 bytes. Do not put session credentials in URLs, examples, or browser storage. Successful responses use `Cache-Control: private, no-store`.

A saved view has this shape; identifiers and revision values here are examples:

```json
{
  "id": "454162ba-b94e-435d-a9c8-55ce164d5cad",
  "name": "Screenshot journal",
  "pinned": true,
  "revision": 1,
  "filters": {
    "folder": null,
    "tag": null,
    "search": "",
    "types": ["image/jpeg", "image/png"],
    "visibility": [],
    "dateFrom": null,
    "dateTo": null,
    "sortBy": "newest",
    "groupBy": "month"
  },
  "unavailableReason": null
}
```

Create defaults `pinned` to `true`. Names are trimmed, must contain 1–40 characters, and must be unique within the account ignoring capitalization. Each account can save at most 20 views. The server generates a UUID identifier and starts `revision` at `1`.

## Filter contract

The `filters` object is required on create. An update replaces the saved filter object; it does not merge individual filter fields. Missing filter fields use these defaults:

| Field                | Default    | Accepted value                                                                                                                                           |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`             | `null`     | `null` for all files, `"unfiled"`, or an owned folder ID, at most 100 characters. A folder includes only its direct files.                               |
| `tag`                | `null`     | `null` for all tags, `"untagged"`, or an owned tag ID, at most 100 characters.                                                                           |
| `search`             | `""`       | A string of at most 500 characters.                                                                                                                      |
| `types`              | `[]`       | Up to 50 MIME strings, each at most 127 characters.                                                                                                      |
| `visibility`         | `[]`       | Up to three entries from `"public"`, `"private"`, and `"hasPassword"`.                                                                                   |
| `dateFrom`, `dateTo` | `null`     | `null` or an ISO timestamp with `Z` or an explicit offset, normalized to UTC; the end cannot precede the start. Dates are absolute, not relative ranges. |
| `sortBy`             | `"newest"` | `"newest"`, `"oldest"`, `"largest"`, `"smallest"`, `"most-viewed"`, `"least-viewed"`, `"most-downloaded"`, or `"least-downloaded"`.                      |
| `groupBy`            | `"none"`   | `"none"`, `"week"`, `"month"`, or `"year"`. Grouping other than `"none"` requires newest or oldest sorting.                                              |

Unknown fields are rejected, including `page` and `limit` inside filters. MIME type and visibility arrays are deduplicated and sorted. Opening a view in the dashboard starts at page one and preserves the current page size. The request only stores preferences: it does not search files, run OCR, assign tags, or change file access.

## Revisions and unavailable views

Use the `revision` returned by GET, POST, or PATCH for the next PATCH or DELETE. A successful update increments the revision. If another request changed the same view, the old revision returns `409` with `code: "SAVED_VIEW_STALE"`; fetch the latest list and review the current state before retrying. Do not automatically overwrite another device's changes. Other `409` errors, such as duplicate names and the view limit, do not carry that code.

If a referenced folder or tag no longer belongs to the account or no longer exists, listing keeps the view and returns a non-null `unavailableReason`. Clients must not silently remove that filter or open a broader library. Renaming, pinning, and deleting the unavailable view remain possible. To repair it, submit a complete replacement `filters` object with valid references. Creating or updating filters with an unknown or foreign reference returns `404`.

Deleting a saved view deletes only that preference. Its files, folders, tags, and public links are unchanged. These operations do not emit webhook events or create uploads.

## Runnable browser-session example

[Download the complete example](/saved-views.js), or read its [repository source](https://github.com/FlintSH/Flare/blob/main/examples/saved-views.js).

Sign in to a disposable Flare account, open **Files**, then run the downloaded JavaScript in that page's developer console. Inspect the code first. It uses relative URLs and the browser's existing same-origin session; it does not ask you to copy cookies or create a token. It lists views, creates one uniquely named temporary view, updates its pin setting using the returned revision, and deletes that same temporary view in `finally`. The account needs one available view slot.

The essential create request is:

```js
const response = await fetch('/api/saved-views', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Screenshot journal',
    pinned: true,
    filters: {
      types: ['image/png', 'image/jpeg'],
      sortBy: 'newest',
      groupBy: 'month',
    },
  }),
})
const result = await response.json()
if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
console.log(result.data)
```

This shorter snippet leaves the new view in the account. Open **Saved views → Manage views**, select the view, and choose **Delete view…** when finished. The full downloaded example cleans up its own view; if cleanup fails, it prints that view's identifier so you can remove it in the dashboard.

## Error responses

Errors use `{ "success": false, "error": "…" }`, with the additional `code` field for a stale revision described above. Check the HTTP status before using `data`.

| Status | Meaning and recovery                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid JSON, fields, filter combination, or revision. Correct the request.                                                                                            |
| `401`  | Missing or ineligible browser session, or an `Authorization` header. Sign in and send a session request.                                                               |
| `403`  | Origin check failed. Run the request on the Flare page's own origin.                                                                                                   |
| `404`  | The view is missing or not owned, or a submitted folder/tag reference is unavailable. Reload and choose valid references.                                              |
| `409`  | Duplicate name, the 20-view limit, or a stale revision. Rename, remove an unused view, or reload before retrying.                                                      |
| `413`  | JSON body exceeds 16 KiB. Reduce the request.                                                                                                                          |
| `415`  | Unsupported content type. Send `application/json`.                                                                                                                     |
| `500`  | The request failed on the server, or stored preferences could not be read. Retry; if it persists, ask the operator to inspect the server logs and account preferences. |

No migration or environment setting is needed. Saved views are stored in `User.preferences.savedViews`; ordinary PostgreSQL backups preserve them. Existing accounts with no saved-view preferences return an empty list.

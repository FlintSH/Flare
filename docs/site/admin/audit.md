---
title: Instance audit log
description: Investigate file activity, processing failures, account actions, role changes, and settings with searchable instance audit events.
---

# Investigate activity in the audit log

Open **Audit log** in the dashboard navigation, or visit `/dashboard/audit`. You need `audit.read`; Administrator includes it. The log brings recorded application activity into one view, with the time, actor, action, outcome, target, and available request or change details. It is useful for answering “who deleted this file?”, “why did processing fail?”, or “which account changed that role?”.

<Screenshot src="/screenshots/audit/audit-desktop.webp" alt="Flare Audit log on desktop showing searchable instance events with time, actor, action, target filename, and outcome" caption="Start with recent instance activity, then narrow the investigation using the filters." />

## Find an event

1. Open **Audit log**. The newest events appear first.
2. Search for an actor name, action, filename, target ID, or request ID.
3. Choose **Category**, **Action**, and **Outcome** as needed. **Time range** defaults to **All time**, with **Last 24 hours**, **Last 7 days**, **Last 30 days**, and **Custom range** options. Custom **From** and **To** use your browser’s local time; event details also show **Timestamp (UTC)**.
4. Expand **Filter by actor, target, or request ID** when you know an exact identifier. Choose **Apply filters**, then **Previous** / **Next** for older matches. Each page shows up to 50 events. **Refresh** reloads the currently applied filters.
5. Select an event row to expand **Recorded details**, available request context, and **Actor ID**, **Target ID**, and **Request ID**. Select one of those IDs to apply its exact filter immediately; the other applied filters remain in place.
6. Choose **Clear filters** to return to all recent instance activity. Filter edits remain drafts until **Apply filters**; refreshing uses the applied choices.

<Screenshot src="/screenshots/audit/audit-filtered.webp" alt="Audit log narrowed by filters to a smaller set of matching instance events" caption="Combine search, outcome, and time filters to focus an investigation." />

File snapshots in **Recorded details** use the database file-size unit: `size` is in MiB (1,048,576 bytes), so a small text file can have a fractional value. Timestamps in expanded details are UTC; row times use your browser’s locale.

For supported database changes, `after` snapshots use the values returned by that write, so a later concurrent edit is not substituted into the earlier actor’s event. `beforeObserved: true` marks a `before` snapshot gathered as pre-write context; it is not a guaranteed immediately preceding version when operations race. `changedFields` identifies submitted mutation fields, while differences between observed snapshots can also include concurrent changes. Deletion snapshots instead describe rows actually removed; some bulk operations expose only counts without per-record snapshots. Snapshots contain selected fields rather than a complete revision history, and missing fields should not be inferred from the object’s current state.

A successful event describes the recorded application step. It is not proof that every later asynchronous step finished: an uploaded file can have a successful creation followed by a failed OCR or cleanup event. A denied request means Flare rejected that request; it does not prove the actor obtained the content. A request ID helps join work from one request; background work can have different context. Events inserted together can share a timestamp, and overlapping requests have no guaranteed total causal order. Use request/target IDs and the recorded changes rather than relying on row order alone.

<Screenshot src="/screenshots/audit/audit-details.webp" alt="Expanded audit event details showing recorded actor and target context with selected metadata" caption="Details retain useful operation context without exposing submitted passwords, token secrets, or file contents." />

## What is recorded

The log combines application mutations, selected file-access activity, authentication activity, failed requests, and background work. The exact event rows depend on the operation and what the application can safely identify.

| Area                        | Useful evidence                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Files and pastes            | Creation, updates, deletion, organization/sharing metadata, available filenames and IDs, and selected access requests.                  |
| Archives                    | Browsing, entry reads, extraction, creation, source filenames, and selected member paths where available.                               |
| Folders, tags, and links    | Changes to organization, rules, shares, and shortened-link records.                                                                     |
| OCR and background work     | Processing outcomes and failures, file context where available, expiration and cleanup activity.                                        |
| Accounts and authentication | Sign-in/session events, account changes, credential-management actions, and failed or denied operations where attribution is available. |
| Roles and assignments       | Changed roles, permissions, membership, and the acting account.                                                                         |
| Instance configuration      | Settings, email, storage, and appearance changes with safe changed-field metadata.                                                      |
| Integrations                | Credential and webhook configuration/lifecycle activity without secret values.                                                          |

Some operations produce several events: a request result and individual changes made while handling it can both be relevant. Bulk and background operations may provide counts or IDs instead of a separate readable filename for every affected object. Anonymous or unresolvable activity cannot always name an account; background jobs can be attributed to the system. The audit viewer is not a complete HTTP access log or a replacement for application error logs.

Direct S3 requests after a signed URL has been issued, CDN hits, external identity-provider activity, direct database/storage edits, and actions outside the Flare process are outside this audit boundary. File-access events show what the application served or authorized, not proof of a completed download or a person reading a file. A request status is recorded when the handler returns its response; streaming may still be in progress, and a later network disconnect may not produce a second audit event. Use your reverse proxy, provider, and database logs when an investigation crosses those boundaries.

Successful audit-list reads do not add a new event on every refresh. Failed or denied audit requests can appear as `audit.read`, so malformed filter checks and access refusals remain visible without the viewer filling itself with successful reads.

### Follow an OCR or storage failure

Search the filename or apply its **Target ID**, then review the event sequence. `ocr.started`, `ocr.completed`, and `ocr.failed` identify recognition work without storing extracted text. `file.view`, `file.read`, `file.download`, and `file.thumbnail` identify selected access paths; the recorded method/route distinguishes raw and direct responses. A later `storage.delete_failed` means a byte-removal attempt failed; successful metadata deletion does not prove the object was erased. Follow the [storage cleanup guide](/hosting/maintenance#account-storage-cleanup) and application diagnostics before reconciling remaining objects.

Expiration records use `file.expiration.scheduled`, `file.expiration.cancelled`, and `file.expiration.applied`, retaining the file context and selected expiry metadata. Applied background work is attributed to the system. Scheduling success alone does not prove that the later action ran; inspect the applied event and current file state.

For [archive activity](/guide/archives), filter **Category** to `archives`. `archive.browse`, `archive.entry.read`, `archive.extract`, and `archive.create` record request outcomes. `archive.source.read` identifies staged source files; `archive.member.read` identifies the selected member prepared for preview or download; `archive.member.extract` links a newly published file to its source archive and member path. Source/member read sizes are bytes, unlike file-snapshot sizes. A preview and a later download can produce separate reads. Entry contents and file passwords are excluded, and a successful response still does not prove complete delivery.

<Screenshot src="/screenshots/audit/archive-events.webp" alt="Audit log filtered to archives showing real extraction and member events for Team handoff.zip alongside denied and failed archive requests" caption="Archive activity keeps source and output context alongside request outcomes. This capture comes from real operations on the disposable demonstration instance." />

## Access and privacy

`audit.read` exposes history across the whole instance, including actors and filenames associated with private or deleted content. It is separate from `content.read`, `users.read`, and `users.sessions`; reading the log does not grant file-content access or the ability to revoke another person's sessions. Ordinary accounts can inspect only their own [login history and active sessions](/guide/account#login-history-and-active-sessions).

Only Administrator has this access by default. A role manager with the necessary delegation authority can grant `audit.read` to a trusted reviewer. Removing the permission takes effect on the next authenticated request, including requests from an already open log page. There is no audit-log editing or deletion control, and neither named API tokens nor the legacy upload credential can read this API.

Authentication events can include a validated client IP and bounded user-agent string, when available. These are request metadata, not verified identities or locations; see [trusted proxy configuration](/hosting/reverse-proxy#client-addresses-in-session-history).

The logger uses selected metadata, not a dump of request bodies or settings. Passwords, authorization/cookie values, API-token secrets, authenticator/recovery secrets, file contents, OCR text, and raw configuration secret values are not intended audit fields. Actor names, filenames, IDs, and operational metadata can still be sensitive. Restrict access to the database and backups as carefully as access to the viewer. Review event details before sharing a screenshot outside your instance.

## Retention and operational limits

Audit events start with this feature's installation; there is no backfill of earlier activity. They are stored in PostgreSQL and survive deletion of the actor account or target file. The viewer does not provide a purge or export button. There is currently **no automatic audit retention limit**: monitor database storage and establish an operator retention policy before relying on the log for a long-running instance.

Most audit writes are best effort: a logging failure is reported in application diagnostics and does not deliberately prevent the user's underlying operation. **Account deletion is an exception:** the per-file deletion evidence is inserted in the same database transaction as account removal and cleanup jobs. If that insert fails, the whole deletion rolls back; resolve the database failure before retrying. Transactional change events are buffered until the transaction commits so rolled-back writes are not represented as successful committed changes. An unavailable database, abrupt process termination, logging failure, or activity outside the instrumented application can leave gaps. An empty search result does not prove that nothing happened.

These records are ordinary application database data. Operators with database access can modify them; there is no cryptographic tamper evidence, independent archival service, or guarantee of exhaustive security/compliance evidence. Include the database in [backups and restore checks](/hosting/maintenance#sessions-and-audit-log-migration), and retain infrastructure diagnostics appropriate to your own requirements. A database restore restores audit history only to that backup's point in time.

## Investigate from a phone

Open the navigation menu, select **Audit log**, and use the same filters and event details. Narrowing the result first helps when reviewing a busy instance on a small screen.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/audit/audit-mobile.webp" alt="Mobile Audit log header with search, category, and outcome filters in a single-column layout" caption="Event filtering and details remain available on narrow screens." />
</div>

[Watch the recorded investigation](/demos#investigate-instance-activity) or use the [browser-session request examples](/api/activity#audit-query) against a disposable instance.

## Troubleshoot missing or confusing activity

| Symptom                                  | Check                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit log is missing from navigation     | Confirm your effective roles include `audit.read`; `users.read` alone is insufficient.                                                                                      |
| A filename search returns no rows        | Clear other filters, widen the time range, search the target ID, and check whether the activity predates installation. Some bulk events retain IDs/counts instead of names. |
| An actor or target no longer exists      | Recorded metadata survives deletion; use its ID and neighboring events rather than assuming the current account/file is still present.                                      |
| A file was created but processing failed | Inspect later OCR/background events and application diagnostics; upload acceptance and later processing have separate outcomes.                                             |
| Expected events stop appearing           | Check application logs and PostgreSQL health/storage, then reproduce one disposable operation. Do not infer success from missing events.                                    |
| An operation appears more than once      | Compare action, request ID, and details; one request can cause multiple recorded changes.                                                                                   |

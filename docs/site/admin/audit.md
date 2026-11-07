---
title: Instance audit log
description: Investigate file activity, processing failures, account actions, role changes, and settings with searchable instance audit events.
---

# Investigate activity in the audit log

Choose **Admin → Audit log** in the dashboard bar, or visit `/dashboard/audit`. You need `audit.read`; Administrator includes it. If `audit.read` is your only administration permission, **Audit log** sits in the bar by itself instead of in the **Admin** menu. The log brings recorded application activity into one view, with the time, actor, action, outcome, target, and available request or change details. It is useful for answering “who deleted this file?”, “why did processing fail?”, or “which account changed that role?”.

<Screenshot src="/screenshots/audit/audit-desktop.webp" alt="Flare Audit log on desktop with Quick views, More filters, and recorded activity visible below" caption="Changes leaves out request telemetry and routine successful access; All activity includes them, and Requests focuses on request telemetry." />

The viewer resets its filters and displayed events to **Changes** when you switch accounts or sign in with a new browser session. When the tab detects sign-out or loss of `audit.read`, it clears the previous viewer; a refresh rejected for either reason also clears the loaded events. Sign in with an authorized account before reopening the log. These checks do not remove events from the instance’s history.

## Find an event

1. Open **Admin → Audit log**. **Changes** is the starting quick view, with newest events first, request telemetry and routine successful access hidden. Failed and denied access outside the `requests` category remains visible. Choose **All activity** for comprehensive activity, or **Requests** for the `requests` category alone.
2. **Search activity** and **Apply filters** stay visible on every screen. Quick views also stay visible: phones use the **Quick view** picker and wider screens show buttons. Additional fields start collapsed. Choose **More filters** to reveal category, event scope, outcome, action, time range, exact IDs, and **Clear filters**. **Hide filters** preserves your draft and applied choices.
3. Choose a quick view, or search for an actor name, action, filename, target ID, or request ID. Quick views apply immediately, including your draft search, time range, and exact IDs. Their explanation names the displayed scope; when edits are pending, it also explains that choosing a quick view applies them.
4. Choose **Category**, **Event scope**, **Action**, and **Outcome** as needed. **Event scope → Changes** hides the activity listed below; **All activity** includes it without changing your other filter fields. Selecting **Category → requests** automatically switches the scope to **All activity** and disables the conflicting **Changes** option. **Time range** defaults to **All time**, with **Last 24 hours**, **Last 7 days**, **Last 30 days**, and **Custom range** options. Custom **From** and **To** use your browser’s local time; event details also show **Timestamp (UTC)**.
5. Expand **Filter by actor, target, or request ID** when you know an exact identifier. Choose **Apply filters**, then **Previous** / **Next** for older matches. Each page shows up to 50 events. **Refresh** reloads the currently applied filters.
6. Select an event row to expand **Recorded details**, available request context, and **Actor ID**, **Target ID**, and **Request ID**. Select one of those IDs to apply its exact filter immediately; the other applied filters remain in place.
7. Remove an applied filter chip to clear just that constraint immediately, preserving other applied filters and unrelated draft edits. The active-filter count matches these removable chips; **Event scope** appears separately. Choose **Clear filters** to return to all instance activity, including successful access and requests, with no search or other restrictions. Manual filter edits remain drafts until **Apply filters** or a quick view is chosen; refreshing uses the applied choices. A message marks unapplied edits, and the activity panel lists the filters and event scope it is actually displaying.

### Start an investigation

| Quick view          | Applied criteria                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Changes**         | The browser default. Hides category `requests` and the known routine successful access actions listed below. Failed and denied access outside `requests` remains visible.   |
| **All activity**    | Scope `all`, with category, action, and outcome cleared. Includes requests and routine successful access.                                                                   |
| **Failed activity** | Outcome `failure`, across all categories and actions, including requests. Denied requests are separate: select **Denied** under **Outcome** to investigate access refusals. |
| **Sign-ins**        | Category `authentication` and action `auth.login`, with all outcomes. Includes the login attempts Flare recorded, not every operation performed by an identity provider.    |
| **Account changes** | Category `accounts`, with all actions and outcomes in that category. Authentication, roles, and invitations have their own categories.                                      |
| **Requests**        | Category `requests`, with all actions and outcomes in that category. This isolates recorded HTTP request outcomes; it is not a complete infrastructure access log.          |

Choosing a quick view applies your current draft search, time range, and exact actor/target/request IDs as well; it replaces category, event scope, action, and outcome. The highlighted quick view and phone picker follow the applied criteria even while edits are pending. On a phone, **Reapply** appears beside **Quick view** when a preset is selected and edits are pending; use it to apply those drafts with the same preset. Wider screens let you select the highlighted quick-view button again. **Custom filters** means the applied category, event scope, action, and outcome do not match a preset; use **Apply filters** to apply drafts without replacing those fields.

**All activity** keeps the rest of an investigation’s scope; **Clear filters** clears everything. If a quick view has no matches, remove a chip or reset the filters. The empty panel suggests widening the time range only when an actual time bound is applied. A custom range with both endpoints blank adds no time constraint or chip; removing a time chip clears both endpoints. **Reset filters** clears every draft and applied constraint and returns to **All activity** without opening **More filters**.

**Changes** hides all events in category `requests`, plus **successful** `file.thumbnail`, `file.view`, `file.read`, `file.download`, `archive.browse`, `archive.entry.read`, `archive.member.read`, and `archive.source.read` events. It keeps failed and denied events for those access actions outside `requests`, alongside mutations, sign-ins, processing events, and other activity. Folder API reads use the `requests` category; there is no separate folder-read action. Archive creation, extraction, and `archive.member.extract` stay visible.

Successful access events remain available through **All activity**; generic request telemetry remains available through **All activity** or **Requests**. **Failed activity** uses the comprehensive scope, so it includes failures from the `requests` category too. Existing installations now open the browser viewer in **Changes** instead of **All activity**. This only changes what the viewer requests: no events are deleted, recording and retention are unchanged, and [API requests](/api/activity#audit-query) still default to the comprehensive scope.

Request events use a compact row: method and path, actor, and local time share one line on a wider screen; actor and time wrap below the request on a phone. Select the row to inspect the full request, exact IDs, and recorded context. Successful events use a quieter presentation without a repeated success badge. **Failure** and **Denied** remain visible badges, and every expanded event names its **Outcome**. The Outcome filter still distinguishes all three results.

Row labels use readable operation names, such as **Sign-in**, **Account update**, and **Short link creation**. They name the recorded step; check its outcome before treating a change as successful. The **Action** choices and applied chip include the raw action ID, and expanded **Event** details retain it. Search still matches recorded action IDs such as `auth.login` or `link.create`, rather than translating friendly labels into a different query.

Targets show their recorded name when available, otherwise their record type and a distinguishing ID suffix; bulk events can show their recorded count. Full target IDs remain in expanded details and can still be selected to filter. A failed sign-in with no recorded account is **Account not identified**. The actor column preserves its recorded label, such as **Anonymous**; when no actor name or ID was recorded, it uses **Unauthenticated**. These labels do not establish that an account exists or that the submitted address was recorded. An unnamed actor with an ID is identified by its account ID suffix, without assuming the account was deleted. No destination, password, token value, or new identifying data is added to the log.

<Screenshot src="/screenshots/audit/audit-filtered.webp" alt="Audit log filtered by Alex with one removable search chip and the Changes event scope" caption="Remove a chip to clear that constraint while keeping the event scope and other filters." />

File snapshots in **Recorded details** use the database file-size unit: `size` is in MiB (1,048,576 bytes), so a small text file can have a fractional value. Timestamps in expanded details are UTC; row times use your browser’s locale.

For [recorded database changes](#what-is-recorded), `after` snapshots use the values returned by that write, so a later concurrent edit is not substituted into the earlier actor’s event. `beforeObserved: true` marks a `before` snapshot gathered as pre-write context; it is not a guaranteed immediately preceding version when operations race. `changedFields` identifies submitted mutation fields, while differences between observed snapshots can also include concurrent changes. Deletion snapshots instead describe rows actually removed; some bulk operations expose only counts without per-record snapshots. Snapshots contain selected fields rather than a complete revision history, and missing fields should not be inferred from the object’s current state.

A successful event describes the recorded application step. It is not proof that every later asynchronous step finished: an uploaded file can have a successful creation followed by a failed OCR or cleanup event. A denied request means Flare rejected that request; it does not prove the actor obtained the content. A request ID helps join work from one request; background work can have different context. Events inserted together can share a timestamp, and overlapping requests have no guaranteed total causal order. Use request/target IDs and the recorded changes rather than relying on row order alone.

<Screenshot src="/screenshots/audit/audit-details.webp" alt="Expanded audit event details showing recorded actor and target context with selected metadata" caption="Details retain useful operation context without exposing submitted passwords, token secrets, or file contents." />

## What is recorded

The log combines application mutations, selected file-access activity, authentication activity, failed requests, and background work. The exact event rows depend on the operation and what the application can safely identify.

| Area                        | Useful evidence                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Files and pastes            | Creation, updates, deletion, organization/sharing metadata, available filenames and IDs, and selected access requests.                  |
| Archives                    | Browsing, entry reads, extraction, creation, source filenames, and opened member paths where available.                                 |
| Folders, tags, and links    | Changes to organization, rules, shares, and shortened-link records.                                                                     |
| OCR and background work     | Processing outcomes and failures, file context where available, expiration and cleanup activity.                                        |
| Accounts and authentication | Sign-in/session events, account changes, credential-management actions, and failed or denied operations where attribution is available. |
| Roles and assignments       | Changed roles, permissions, membership, and the acting account.                                                                         |
| Invites                     | Invite creation, uses, revocation, account-deletion removal, and the accounts that joined, without invite tokens.                       |
| Instance configuration      | Settings, email, storage, and appearance changes with safe changed-field metadata.                                                      |
| Integrations                | Credential and webhook configuration/lifecycle activity without secret values.                                                          |

Flare records the changes it writes to these records as events named after the record and the database operation, such as `file.update`, `role.upsert`, or `file_tag.deleteMany`: files and pastes (`file`), folders (`folder`), tags (`tag`) and their file assignments (`file_tag`), accounts (`user`), roles (`role`), settings (`setting`), invites (`invite`), API tokens (`token`), upload profiles (`upload_profile`), webhooks (`webhook`) and their deliveries (`delivery`), queued email (`mail`), short links (`link`), and passkeys (`passkey`). A change that marks a webhook delivery or queued email failed, or records an error without cancelling it, has outcome **failure**. Sign-ins, sessions, storage cleanup, and file expiry record their own events instead. Other records, such as recovery codes, email links, and rate limits, have no change events.

Some operations produce several events: a request result and individual changes made while handling it can both be relevant. Bulk and background operations may provide counts or IDs instead of a separate readable filename for every affected object. Anonymous or unresolvable activity cannot always name an account; background jobs can be attributed to the system. The audit viewer is not a complete HTTP access log or a replacement for application error logs.

A password or sign-in address change records one `user.update` event for the account, whether the person changes it, an administrator edits it, or a reset or confirmation link applies it.

View, download, and short-link click counters are not change events. Each counted request already has its own request event: a share-page visit is `file.view`, a raw or `/api/files/{path}` read is `file.read`, a download is `file.download` (including `/api/files/{path}?download=true`), and a short-link redirect is an `http.get` event whose target is the link, named by its short code. The totals remain on the file and link records. An update that changes another field together with a counter is still a change event, and its snapshots include the counter. Logs from earlier versions still contain `file.update` and `link.update` events whose `changedFields` list only `views`, `downloads`, or `clicks`; upgrading does not remove or rewrite them. In those earlier logs, short-link `http.get` events have no link target and `?download=true` reads appear as `file.read`.

Direct S3 requests after a signed URL has been issued, CDN hits, external identity-provider activity, direct database/storage edits, and actions outside the Flare process are outside this audit boundary. File-access events show what the application served or authorized, not proof of a completed download or a person reading a file. A request status is recorded when the handler returns its response; streaming may still be in progress, and a later network disconnect may not produce a second audit event. Use your reverse proxy, provider, and database logs when an investigation crosses those boundaries.

Successful audit-list reads, and the reloads of **Profile → Integrations**, do not add a new event on every refresh. Earlier versions recorded every Integrations reload, one every five seconds while the panel was open. Failed or denied audit requests can appear as `audit.read`, so malformed filter checks and access refusals remain visible without the viewer filling itself with successful reads.

### Follow an OCR or storage failure

Search the filename or apply its **Target ID**, then review the event sequence. `ocr.started`, `ocr.completed`, and `ocr.failed` identify recognition work without storing extracted text. `file.view`, `file.read`, `file.download`, and `file.thumbnail` identify selected access paths; the recorded method/route distinguishes raw and direct responses. A later `storage.delete_failed` means a byte-removal attempt failed; successful metadata deletion does not prove the object was erased. Follow the [storage cleanup guide](/hosting/maintenance#account-storage-cleanup) and application diagnostics before reconciling remaining objects.

Expiration records use `file.expiration.scheduled`, `file.expiration.cancelled`, and `file.expiration.applied`, retaining the file context and selected expiry metadata. Applied background work is attributed to the system. Scheduling success alone does not prove that the later action ran; inspect the applied event and current file state.

For [archive activity](/guide/archives), filter **Category** to `archives`. `archive.browse`, `archive.entry.read`, `archive.extract`, and `archive.create` record request outcomes. `archive.source.read` identifies source files staged for extraction or creation; browsing does not stage files. `archive.member.read` identifies a member whose preview or download starts at its first byte, with `details.size` and the bytes being sent in `details.bytes`; continuing ranges, such as seeking in a video, add only `archive.entry.read` request outcomes. Earlier versions dropped `details.bytes`, so older `archive.member.read` events don't have it. `archive.member.extract` links a newly published file to its source archive and member path. Source/member read sizes are bytes, unlike file-snapshot sizes. A preview and a later download can produce separate reads. Entry contents and file passwords are excluded, and a successful response still does not prove complete delivery.

For [invite links](/admin/users#invite-links), filter **Category** to `invites`. `invite.create` records the note, creator, use limit, expiry, and granted role IDs. `invite.update` records a use or a revocation. `invite.redeem` records the account that joined, with its name and the role IDs it received; registration is anonymous, so its actor is not an existing account. `invite.delete` appears when deleting an account removes the invites it created. Invite tokens and their digests are never recorded.

<Screenshot src="/screenshots/invites/audit-invites.webp" alt="Audit log filtered to the invites category showing invite update, redeem, and create events with their actors and invite notes" caption="Invite events trace who created each link and which account used it." />

<Screenshot src="/screenshots/audit/archive-events.webp" alt="Audit log filtered to archives showing real extraction and member events for Team handoff.zip alongside denied and failed archive requests" caption="Archive activity keeps source and output context alongside request outcomes. This capture comes from real operations on the disposable demonstration instance." />

## Access and privacy

`audit.read` exposes history across the whole instance, including actors and filenames associated with private or deleted content. It is separate from `content.read`, `users.read`, and `users.sessions`; reading the log does not grant file-content access or the ability to revoke another person's sessions. Ordinary accounts can inspect only their own [login history and active sessions](/guide/account#login-history-and-active-sessions).

Only Administrator has this access by default. A role manager with the necessary delegation authority can grant `audit.read` to a trusted reviewer. Removing the permission takes effect on the next authenticated request, including requests from an already open log page. There is no audit-log editing or deletion control, and neither named API tokens nor the legacy upload credential can read this API.

Authentication events can include a validated client IP and bounded user-agent string, when available. These are request metadata, not verified identities or locations; see [trusted proxy configuration](/hosting/reverse-proxy#client-addresses-in-session-history) for which forwarding headers supply the address.

The logger uses selected metadata, not a dump of request bodies or settings. Passwords, authorization/cookie values, API-token secrets, authenticator/recovery secrets, file contents, OCR text, and raw configuration secret values are not intended audit fields. Actor names, filenames, IDs, and operational metadata can still be sensitive. Restrict access to the database and backups as carefully as access to the viewer. Review event details before sharing a screenshot outside your instance.

## Retention and operational limits

Audit events start with this feature's installation; there is no backfill of earlier activity. They are stored in PostgreSQL and survive deletion of the actor account or target file. The viewer does not provide a purge or export button.

By default Flare keeps every audit event. The server operator can set **`FLARE_AUDIT_RETENTION_DAYS`** to a whole number of days, such as `365`, to delete older events automatically. It is an environment variable rather than a setting on purpose: someone who can change instance settings could otherwise shorten the log to remove evidence of their own actions. Only someone who controls the server's environment can change it, and the change takes effect when Flare restarts.

With the variable set, each Flare process checks about a minute after it starts and then every hour. It deletes events older than the cutoff, oldest first, in batches of 5,000, with at most 100 batches per run; a larger backlog continues a minute later. Only one process deletes at a time. Everything older than the cutoff is removed, including the per-file evidence recorded when an account was deleted. Each run that deletes events records one `audit.retention.applied` event in category `system`, attributed to **System**, whose details give `retentionDays`, the `cutoff` timestamp (UTC), the `count` of events removed, and whether the run reached the cutoff (`complete`). A run that stops on a database error still records the events it already removed, with `complete: false`, and the next run continues. Filter **Category** to `system` to see when pruning ran.

Deleting events from the live table does not remove them from database backups made earlier. Keep backups for at least as long as you need to investigate past activity, and expire old backups under the same policy. Unset, empty, or `0` keeps every event. A value that is not a whole number from 1 to 36,500 is ignored with an error in the startup log, and every event is kept.

Most audit writes are best effort: a logging failure is reported in application diagnostics and does not deliberately prevent the user's underlying operation. **Account deletion is an exception:** the per-file deletion evidence is inserted in the same database transaction as account removal and cleanup jobs. If that insert fails, the whole deletion rolls back; resolve the database failure before retrying. Transactional change events are buffered until the transaction commits so rolled-back writes are not represented as successful committed changes. An unavailable database, abrupt process termination, logging failure, or activity outside the instrumented application can leave gaps. An empty search result does not prove that nothing happened.

These records are ordinary application database data. Operators with database access can modify them; there is no cryptographic tamper evidence, independent archival service, or guarantee of exhaustive security/compliance evidence. Include the database in [backups and restore checks](/hosting/maintenance#sessions-and-audit-log-migration), and retain infrastructure diagnostics appropriate to your own requirements. A database restore restores audit history only to that backup's point in time.

## Investigate from a phone

Open the navigation menu, select **Audit log** under **Admin**, and use the same filters and event details. Narrowing the result first helps when reviewing a busy instance on a small screen.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/audit/audit-mobile.webp" alt="Mobile Audit log with Search activity, Apply filters, a Quick view picker, and recorded activity below" caption="Search and quick views stay visible; More filters reveals the additional fields." />
</div>

[Watch the recorded investigation](/demos#investigate-instance-activity) or use the [browser-session request examples](/api/activity#audit-query) against a disposable instance.

## Troubleshoot missing or confusing activity

| Symptom                                                        | Check                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audit log is missing from the Admin menu                       | Confirm your effective roles include `audit.read`; `users.read` alone is insufficient.                                                                                               |
| A filename search returns no rows                              | Clear other filters, widen the time range, search the target ID, and check whether the activity predates installation. Some bulk events retain IDs/counts instead of names.          |
| Successful access or request telemetry is missing from Changes | Choose **All activity** for successful access and every category, **Requests** for generic request telemetry alone, or **Clear filters** to remove the entire investigation scope.   |
| An actor or target no longer exists                            | Recorded metadata survives deletion; use its ID and neighboring events rather than assuming the current account/file is still present.                                               |
| A file was created but processing failed                       | Inspect later OCR/background events and application diagnostics; upload acceptance and later processing have separate outcomes.                                                      |
| Expected events stop appearing                                 | Check application logs and PostgreSQL health/storage, then reproduce one disposable operation. Do not infer success from missing events.                                             |
| An operation appears more than once                            | Compare action, request ID, and details; one request can cause multiple recorded changes.                                                                                            |
| Views, downloads, or clicks have no change events              | Counter increments are not change events. Filter by the file or link target and look for `file.view`, `file.read`, `file.download`, or the link's `http.get` request events instead. |

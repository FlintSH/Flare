# A cohesive Flare workspace

The workspace continues the design introduced by the unified setup, Settings, and
Profile pages: generous headings, calm theme-aware surfaces, clear primary actions,
and the familiar Flare identity. Instance branding and personal appearance still
apply throughout the app.

## Everyday tasks

- **Files:** search, sort, filter, and reset the library; copy or open a file without
  hovering; use its menu for visibility, password, expiration, and deletion. Loading,
  no results, an empty library, and a failed request have distinct states.
- **Upload:** choose files in the main workspace and review sharing defaults beside
  the queue. Completed files retain their open/copy actions. Saved upload profiles,
  explicit overrides, progress, queue removal, and retry remain available. Partial
  failures keep completed links and retry only the files that still need uploading.
- **Paste:** start with content and an optional filename; review sharing options in
  the adjoining panel. The result stays visible with open/copy/create-another actions.
- **Links:** create an address, copy its result, and find it in a searchable list.
  Destination and traffic are readable on phones. Deletion requires confirmation.
- **Users:** search all accounts by name/email, filter by role, review content and
  storage, and manage accounts from responsive cards. Pagination follows filtered
  results and recovers after deleting the last item on a page.

Navigation groups workspace, account, and administrator destinations on mobile.
A keyboard skip link leads to page content. Dialogs retain margins and scrolling
on smaller screens. The global file-drop overlay uses the same design and refreshes
an open library when the upload completes.

## Public pages

Login, registration, account recovery, verification, and exceptional states share a
branded shell with clear next actions. Public files keep all three share layouts
(minimal, framed, and delivery), disclosure choices, and access checks. Their actions
and image, text, code, CSV, audio, video, PDF, loading, error, and unsupported states
use the same surface and typography conventions. Protected video playback preserves
the exact password when resolving a local streaming URL.

## Review coverage

Screenshots in `docs/images/workspace` use disposable local accounts and fixtures.
The pull request embeds the gallery, including desktop and mobile views, new
completion states, dialogs, empty/error states, all public viewer types, and the
existing preferences and setup flows under the shared shell changes.

The review covers every rendered route family:

| Routes                         | Checks                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `/dashboard`                   | Search, sort/filter/reset/history, refresh, file actions, protection, pagination, empty/retry, mobile |
| `/dashboard/upload`            | File selection, queue, real upload, profile/visibility/password/expiry, completion copy, mobile       |
| `/dashboard/paste`             | Content, filename, real creation, result copy/open, mobile                                            |
| `/dashboard/urls`              | Create, search, copy/open, delete/cancel, empty/error, mobile                                         |
| `/dashboard/users`             | Create, edit, search/roles, content, delete/pagination, administrator gating, mobile                  |
| `/dashboard/settings`          | General, Access, Storage, Appearance, Email, Advanced, About; desktop/mobile                          |
| `/dashboard/profile`           | Account, Appearance, Uploads, Integrations, Security, Your data; desktop/mobile, light appearance     |
| `/auth/*`                      | Login, registration, recovery, reset, verification; status/error and mobile states                    |
| `/setup`                       | Fresh Account → Storage → Access → Appearance → Email → Ready; validation/back/reload and mobile      |
| `/[userUrlId]/[filename]`      | Public viewer types, layouts, protected and private access, long content, mobile                      |
| Error and not-found boundaries | Clear recovery actions and responsive layout                                                          |
| Legacy and utility routes      | Home/setup/preferences redirects; raw/direct file delivery and short-link redirects                   |

Recorded-session visual comparisons supplement these real-browser checks. Intended
layout differences are reviewed as design changes; replay/authentication or fixture
limitations are recorded separately in the pull request rather than counted as a
successful browser pass.

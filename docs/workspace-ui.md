# A cohesive uplift of Flare’s existing UI

The UI extends the theme-aware surfaces, readable controls, and consistent spacing
introduced by the unified setup, Settings, and Profile pages. Existing layouts,
control order, and information density remain familiar: Flare’s floating navigation,
compact file grid, stacked creation forms, tables, centered authentication cards,
and public share layouts remain the foundation. Instance branding and personal
appearance apply throughout the app.

## Everyday tasks

- **Files:** square previews in the original four-column desktop grid, compact
  filename/size and activity rows, and familiar preview actions. A small menu makes
  every action available on touch screens; keyboard focus reveals preview actions.
  Search, sort, filters, refresh, compact pagination, and retry stay together.
- **Upload:** the original vertical flow of file selection, queue, upload profile,
  visibility, password, expiration, and upload. Inline completion links, explicit
  progress, and retry support the existing form. Partial failures retain completed
  links and retry only files that still need uploading.
- **Paste:** the original profile, editor, filename/visibility row, password, and
  create action. A compact result provides open/copy/create-another actions.
- **Links:** the original URL input and Shorten action above the five-column table.
  Tables scroll on narrow screens, copy failures are explained, and deletion asks
  for confirmation.
- **Users:** the original seven-column table and direct edit/content/avatar/delete
  actions, with search and role filtering in a compact toolbar. Mobile rows retain
  account metadata and accessible actions. Pagination follows filtered results.

Navigation retains its original floating bar, tab group, and flat mobile menu.
A keyboard skip link leads to page content. Dialogs keep Flare’s translucent surface
with reliable margins and scrolling on smaller screens. The existing file-drop
overlay refreshes an open library when an upload completes.

## Profile and Settings

Profile groups identity, password, and the personal workspace theme under **Account**.
**Uploads** contains upload profiles, defaults, and capture tools; **Integrations**
contains API tokens and webhooks; **Your data** contains storage usage, export, and
account deletion.

Instance Settings groups version information with everyday features in **General**.
**Appearance** contains branding, themes, sharing, favicon, and a **Custom CSS and HTML**
disclosure for advanced styling. **Access**, **Storage**, and **Email** keep their own
sections for their larger configuration forms.

Existing links to Profile’s Appearance and Security sections, and Settings’ About
and Advanced sections, still open the corresponding controls in their new groups.
Section changes retain unfinished edits, and browser Back/Forward follows section
and anchored links.

## Public pages

Login, registration, account recovery, verification, and exceptional states share a
centered card and brand badge with clear next actions. Public files keep all three share layouts
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
| `/dashboard/urls`              | Create, copy/open, delete/cancel, empty/error, mobile                                                 |
| `/dashboard/users`             | Create, edit, search/roles, content, delete/pagination, administrator gating, mobile                  |
| `/dashboard/settings`          | General, Access, Storage, Appearance, Email; desktop/mobile                                           |
| `/dashboard/profile`           | Account, Uploads, Integrations, Your data; desktop/mobile, light appearance                           |
| `/auth/*`                      | Login, registration, recovery, reset, verification; status/error and mobile states                    |
| `/setup`                       | Fresh Account → Storage → Access → Appearance → Email → Ready; validation/back/reload and mobile      |
| `/[userUrlId]/[filename]`      | Public viewer types, layouts, protected and private access, long content, mobile                      |
| Error and not-found boundaries | Clear recovery actions and responsive layout                                                          |
| Legacy and utility routes      | Home/setup/preferences redirects; raw/direct file delivery and short-link redirects                   |

Recorded-session visual comparisons supplement these real-browser checks. Intended
layout differences are reviewed as design changes; replay/authentication or fixture
limitations are recorded separately in the pull request rather than counted as a
successful browser pass.

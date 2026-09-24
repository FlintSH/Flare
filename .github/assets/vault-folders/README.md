# Folder UI evidence

Captured on September 24, 2026 from the production Next.js build using local
Playwright Chromium and an isolated PostgreSQL 16 database. Accounts, files, tags,
folder links, and uploads are disposable fixtures. Screenshots show the rendered
application; the demos record real browser interactions and application requests.
No production data or external visual-testing credits were used.

Desktop screenshots use a 1440 × 1000 viewport. Mobile screenshots use 390 × 844;
layout checks also passed at 320px. Dialogs were captured after animations settled.
The GIFs are compact 1024px copies of the 1280 × 900 recordings; MP4s retain the
recorded resolution.

| Demo                             | Recording                                               | Shows                                                                                                                  |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Organize and upload (23 seconds) | [GIF](organizing-demo.gif) · [MP4](organizing-demo.mp4) | Create a folder, move two files, create a subfolder, upload directly into it, and open the uploaded file's folder.     |
| Share and revoke (15 seconds)    | [GIF](sharing-demo.gif) · [MP4](sharing-demo.mp4)       | Folder sharing controls, the public collection, protected-file presentation, disabling the link, and the revoked page. |

| Screenshot                                          | Surface                                                   |
| --------------------------------------------------- | --------------------------------------------------------- |
| [Default](default-no-folders.jpg)                   | Existing files with no folders created.                   |
| [All files](all-files.jpg)                          | Root folders alongside the complete file library.         |
| [Folder](folder-desktop.jpg)                        | Direct contents, tags, child folders, and folder actions. |
| [Nested folder](nested-folder.jpg)                  | Breadcrumbs and files inside a subfolder.                 |
| [Bulk move](bulk-move.jpg)                          | Selected files and a nested destination.                  |
| [Upload destination](upload-folder.jpg)             | Upload directly into a selected folder.                   |
| [Remove folder](remove-folder.jpg)                  | Keep files and warn when the parent has a shared link.    |
| [Sharing controls](share-folder.jpg)                | Share link, privacy explanation, and revoke control.      |
| [Public folder](shared-folder-desktop.jpg)          | Public files only and a generic password-protected tile.  |
| [Mobile folder](mobile-folder.jpg)                  | Responsive navigation and folder browsing.                |
| [Mobile move](mobile-move.jpg)                      | Moving a file on a phone-sized screen.                    |
| [Mobile sharing](mobile-share.jpg)                  | Sharing controls on a phone-sized screen.                 |
| [Public folder on mobile](shared-folder-mobile.jpg) | Responsive public collection.                             |

Browser checks passed for folder creation and duplicate-name recovery; nested
navigation and browser history; folder-scoped tag filtering and clearing filters;
single and bulk moves; real upload placement; renaming and removal while retaining
files; private-file and subfolder exclusion from public sharing; password-protected
metadata and thumbnail suppression; file-link navigation; link revocation and token
rotation; mobile overflow and controls; and folder-list/save failure recovery.
Normal application flows produced no browser exceptions or HTTP 5xx responses.
Failure-recovery checks deliberately injected temporary folder API failures.

Next.js streams its not-found page with HTTP 200 when rendering has already
started. The revoked-link check verifies that the not-found page is rendered and
that the folder name and contents are absent.

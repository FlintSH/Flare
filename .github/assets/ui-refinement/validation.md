# Validation

This follow-up is stacked on the exact `d01f150` UI baseline. The latest refinement adds a browser-local, account-scoped **Gallery / List** choice, puts complete filenames first, keeps file menus within the viewport, and places effective sharing settings beside the Upload and Create paste actions. Connection failures use recovery wording while preserving cancellation, HTTP refusal details and original diagnostic causes. The handbook ships with the behavior changes.

## Current implementation evidence

The rendered application is Build `ThdjH6IW6IJPg9vWh7x-Z`, Node 24.21.0 / Next 16.4.3. Its frozen application/configuration inventory has 687 inputs, SHA `077d09e62340e91eeb25d00a56b203f49a75f947d3cbcdc828c4e49b36d17752`; the separate QA inventory has 301 inputs, SHA `04e63058150409cdd378bd1d3d328ecdcebb92c646dbb6fca9160ff6c2868c7f`. The complete immutable dependency runtime contains 62,229 files. Application source stayed unchanged through the browser captures; later handbook/media edits do not change this application build.

- Type generation, type checking, lint, production build and packaging passed. Unit results: **2,437 passed, 0 failed, 312 skipped**.
- Maintained Library-view checks passed 12 contexts, including 48 settled menu-bound checks and the separate 12,000-file fixture. Sharing-summary checks passed 32 cases/40 frames, including 12 native focus observations. Gallery geometry 16, Library interactions 38 and polish 27 passed on this build.
- Transport recovery passed 14 cases/34 native frames. Public preview and resumed Appearance cover both rendered themes, desktop, phone and CSS text enlargement. The fresh Account fixture rendered Light under both OS preferences; fresh Dark Account coverage is not claimed. Failure cases intercept the relevant requests and forward no setup writes.
- Eighty fresh native page images cover 20 main routes at desktop and phone sizes in both rendered themes, including filtered-empty and dashboard404 states. All pages, contexts and browsers closed; source/runtime and fixture observations were retained. Changed-flow checks additionally cover tablet layouts, permissions, dialogs and enlarged text.
- Eighty ready axe scans reported 0 automated violations and 0 operational errors. **1,054 contrast-incomplete node occurrences remain**; these are not automated contrast passes. Native focus/geometry checks are bounded samples, not certification of every focus perimeter or palette.
- Twenty-three canonical still sources were refreshed from actual rendered UI. List and sharing-summary examples are new; the summary examples are explicitly unsubmitted local drafts. The enlarged Account navigation uses a labeled CSS text-size simulation and one native locator crop. No application pixels were painted, masked or retouched.

## Real-operation checks and limits

Disposable uploads, a new-image OCR operation and a Paste lifecycle exercised the actual server. OCR started and completed a real worker, with API/cache/UI agreement; the English model was already provisioned. Paste creation was followed by a 750ms offline/online observation: no hidden profile query ran on the success view, and returning to the draft mounted a fresh profile query. All four newly created file IDs were accounted for and deleted; the OCR worker settled before cleanup. Original file/User business state and webhook configuration were checked, and exact owned `file.ready` outbox effects were retained rather than reset.

The private operation suites **remain failed on their strict network assertions**. Upload and OCR observed a same-route, non-prefetch RSC request receiving HTTP 200 and then being client-canceled before browser closure; a read-only framework refresh reproduced that pattern. Its cancellation-call cause remains unproven. Paste observed a marked public-link prefetch cancellation outside the verifier's dashboard-only allowance. Successful API/native/data/cleanup subchecks do not turn those whole-suite failures into passes. The published Upload/OCR stills are independently reviewed native frames from those operations; the incomplete phone upload-result crop was not published.

No new full Timeline/coarse/mixed continuity run, role-fixture capture, contrast/focus sweep, Meticulous replay or recording refresh is claimed for this build. Earlier results remain earlier evidence. The desktop and phone library movies retain their previous Gallery appearance, explicitly labeled in the demos guide. Linux Chromium, native CDP touch and CSS text enlargement do not establish physical-device, other-engine, assistive-technology or native-OS-zoom coverage. No hosted Meticulous run was requested or performed.

## Handbook delivery checks

Coverage, full builds and browser checks passed at `/` and `/flare-refinement/`: 36 script tests, 17 browser checks and 50 HTML pages per base. Credits, local links, anchors, assets and OpenAPI references passed; owned preview listeners closed. Both local builds retained automatic version 3.0.1 / commit 04b47b31 / dirty-source provenance, accurately describing the uncommitted source used for these checks. The initial build's broken Feature Explorer fragment remains a failed attempt; the final link targets the canonical Library guide.

## Earlier comparisons

| Area                   | Exact-parent and earlier follow-up capture |
| ---------------------- | ------------------------------------------ |
| Files on a phone       | [View](library-phone.webp)                 |
| Profile on a phone     | [View](profile-phone.webp)                 |
| Audit on a phone       | [View](audit-phone.webp)                   |
| Public text preview    | [View](text-phone.webp)                    |
| Paste on a phone       | [View](paste-phone.webp)                   |
| Short links on a phone | [View](links-phone.webp)                   |
| Settings on desktop    | [View](dark-settings.webp)                 |

These seven panels belong to the earlier `04b47b31` follow-up. They compare exact-parent development captures with that production-mode build; they do not show the latest List/sharing-summary refinement. Phone inputs retain 390×844 pixels, while desktop panels use explicitly labeled contain fitting. Dates and capture methods remain literal. [The original real-page directions](directions.webp) also retain their historical prototype labels. No production deployment is represented.

The current Library and sharing examples are the canonical sources under `docs/images/refinement/`, with behavior described in the Library, Uploading, Pastes, Sharing, Account and Setup handbook pages. Large raw execution/comparison evidence remains outside product source. Automatic handbook provenance, creator credit and icon attribution are preserved.

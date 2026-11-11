# UI Hillclimb validation

The [before/after gallery](gallery.md) covers 372 matching route/state/viewport combinations across the dashboard, authentication, public viewers, shared folders and fresh setup, in dark and light themes at desktop and phone sizes. Another 50 focused states are explicitly after-only. There are no missing capture pairs. The [preset gallery](presets.md) adds 132 after-only frames. [Directions](directions.md) document the two real prototypes and [palette cards](palette.md) retain the runtime color inventory.

Screens show disposable `.test` accounts and demonstration files. Full-page before/after frames use identical CSS to extend the fixed background; actual interface pixels and content are retained. New states have no fabricated baseline. The manifest records capture provenance and expected runtime notices, including deliberately rejected authentication and missing-page requests. Sensitive setup, token and invite fields were masked before capture. Public videos were genuinely decoded and paused at 1.5 seconds on both versions; [readiness evidence](reports/video-readiness.json) is retained.

## Measurements and limits

| Text measurement                                 | Desktop samples | Phone samples | Nonexempt WCAG AA failures |
| ------------------------------------------------ | --------------: | ------------: | -------------------------: |
| Baseline dark, nine dashboard routes             |             869 |           728 |                          0 |
| Final dark, nine routes plus three error states  |             955 |           774 |                          0 |
| Baseline light, nine dashboard routes            |             866 |           722 |                          0 |
| Final light, nine routes plus three error states |             967 |           782 |                          0 |
| Final public dark, ten routes                    |             171 |           165 |                          0 |
| Final public light, ten routes                   |             171 |           165 |                          0 |

Samples include disabled text, which is exempt from the failure count. Covered/offscreen text is reported separately and is not a pass. The before and after dashboard scopes differ; medians and counts are not presented as a paired improvement. Raw WCAG/APCA rows, advisory APCA weak-body counts and unmeasured reasons are retained in `reports/*contrast*.json.gz`. These samples do not certify every arbitrary custom palette or whole-app accessibility compliance.

For the eleven preset/stress states, the initial raw reports measured 5,522 text samples and reported 22 failures. All 22 were the clipped, aria-hidden **Skip to content** link under an open user menu: the sampler incorrectly measured text outside its clipped box. The original reports remain in `reports/preset-*-original.json.gz`. A real keyboard check also found that the focused link's old screen-reader utility reset its fixed positioning. The implementation now keeps it offscreen until focused, with explicit fixed positioning and a visible ring.

The current production build remeasured the actual user-action menu in every preset. Combining those later menu rows with the unchanged routes yields **5,456 nonexempt measured text samples and zero AA failures**, minimum ratio **4.95:1**. No computed row was edited. [The summary](reports/preset-summary.json) names the replaced route and build; the corresponding original and verified-menu reports remain alongside it.

[Keyboard verification](reports/skip-link.json) independently passed Tab to the visible skip link, bounded positioning and Enter to main content in all thirteen default/preset/stress states at 1440 and 390 pixels, 26 checks total. Focused link contrast is at least 4.95:1. Actual examples: [dark phone](reports/skip-dark-390.png), [light phone](reports/skip-light-390.png), [Ember light phone](reports/skip-ember-light-390.png), [white accent desktop](reports/skip-extreme-1440.png).

The broader phone focus sweep records 146 stops per default theme, with no missing-indicator flags and 10 dark / 3 light weak pixel-change flags. Manual native-frame inspection found visible rings on the flagged card controls; hover veils affect this heuristic. Public sweeps record 104 stops per theme with no flags. The broader sweeps precede the final skip-link positioning fix; its later 26 actual keyboard checks are authoritative for that link. Baseline light focus is retained; no baseline dark sweep is claimed.

Raw contrast/focus reports are losslessly gzip-compressed to keep the source diff readable. [Compression hashes](reports/compressed-metrics.json) verify each exact decompressed JSON. For local inspection, use `gzip -dc <report.json.gz>`. Summary and behavior-result JSON stays directly readable.

Additional open-invalid-password audits measured 112 text samples per default theme across desktop and phone, with zero nonexempt AA failures. The exact two reports are `reports/open-state-contrast-*.json.gz`. Phone capture contexts use touch emulation: all four configs set `mobile:true`, and the installed constructor sets both `isMobile` and `hasTouch`. [Actual context verification](reports/capture-context.json) records a coarse pointer and touch points; physical devices are not claimed.

## Executed checks

- Production Next.js build and ESLint passed. Vitest passed **199 files, 2,184 tests**; **15 database-dependent files, 312 tests skipped**. An ignored temporary standalone copy initially caused third-party dependency tests to be collected; moving that copy outside the repository and rerunning the unchanged test command passed.
- [Maintained UI regression results](reports/ui-regression-results.json): desktop 1440, tablet 820, phones 390/320, remembered folder disclosure, independent filter removal, complete Section navigation and dirty form retention, role search, audit presets, safe user menus and dialog focus return, real private/password Upload/Paste persistence with collapsed options, actual coarse switch taps and calendar selection, tablet tabs and no uncaught browser errors. The date popover and its selected-range Clear control stay bounded and usable at 320/390 pixels wide and both 740/844 pixels tall. The footer stays fully visible without scrolling the popover. Actual selected-range frames: [320×740](reports/filter-date-selected-320-740.png), [390×844](reports/filter-date-selected-390-844.png). Actual after-clearing frames: [320×740](reports/filter-date-320-740.png), [390×844](reports/filter-date-390-844.png). The 200% check is layout emulation at 720 CSS pixels with DPR 2, not physical OS zoom.
- [Large-library results](reports/timeline-results.json): **12,000 files, 16 checks**, at most 40 mounted cards, two requests for the deep date jump, **zero-pixel forward/reverse seams**, desktop/mobile axe arrays empty and no JavaScript errors. Width-only resize and cross-breakpoint historical anchors pass. Separate maintained account-switch and tag-refresh runs passed 6 and 7 checks. The two real refreshed walkthroughs were fully decoded and sampled visually, and Chromium playback/seeks passed.
- [Remembered-open directory assurance](reports/remembered-open-results.json): eight core deep-history checks passed through Back, reload and resizing. An extra strict tail pixel-equality assertion failed; the closed/open control showed the same existing 254px rank-to-start placement in both cases, with the file/month retained. The failed stronger assertion is preserved rather than reported as a full passing probe.
- [Restricted-account results](reports/restricted-results.json): desktop and phone made zero unauthorized profile requests, hid unavailable controls, created two real PRIVATE uploads and deleted both through the permitted administrator endpoint with 204 responses. The original five private files, folder and permissions were preserved. No authorization was widened.
- Handbook coverage checks include 100 API route files, 13 named-token operations, 60 environment options, 40 permissions and the canonical webhook schema. Production builds at `/` and `/flare/` validate 50 pages, links, anchors, assets and OpenAPI references. All 17 handbook browser checks passed at both `/` and `/flare/`.

## Build provenance

The complete default/public/setup and preset capture sets were produced serially from immutable production snapshots. Later fixes preserve the same pixels except for the focused skip link and restricted picker. The full 12,000-file suite and recordings use build `CNRaf1fQr3_0P9GkDxdii`; the 26 keyboard checks and eleven menu contrast reruns use `LjrzqbRACLi2egsZ3OOTl`. The latest restricted suite uses `6qGxSIGHgwcBzmARE6tpa`, after the permission-aware Upload description fix. All 26 default/preset date-popover retakes use `Hdz3G1eXJAVhCV5yuxnoO`, with a scrolling calendar and always-visible grouping/clear footer. The latest ordinary suite, open/closed password retakes and the combined remembered-open directory probe use `4YZIRT4WBaFbMFf4ybwba`. This avoids presenting earlier screenshots as a full rerun of later behavior.

Headless Chromium is the browser tested. Physical devices, other operating systems and other browser engines were not tested. OCR was disabled only on the isolated restricted fixture because the manually copied standalone dependency slice lacked its worker's parent module; this PR changes no OCR behavior and claims no OCR runtime validation.

## Council result

After three rounds, Claude Opus 5.5 and GPT-6.1 Sol each independently scored the app-wide UI/UX **9.0/10**, with no remaining high or medium findings. The accepted minor trade-offs and evidence limits above remain part of that assessment.

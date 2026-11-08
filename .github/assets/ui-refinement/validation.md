# Validation

Filenames now use natural wrapping, compact previews leave more files visible on phones, and measured row heights keep date jumps and scrolling aligned. Phone dialogs place Cancel or Keep before the confirmation action. Password hints are shorter, and placeholder contrast follows the configured palette without rewriting saved colors.

## Comparisons

| Area                   | Baseline and current capture |
| ---------------------- | ---------------------------- |
| Files on a phone       | [View](library-phone.webp)   |
| Profile on a phone     | [View](profile-phone.webp)   |
| Audit on a phone       | [View](audit-phone.webp)     |
| Public text preview    | [View](text-phone.webp)      |
| Paste on a phone       | [View](paste-phone.webp)     |
| Short links on a phone | [View](links-phone.webp)     |
| Settings on desktop    | [View](dark-settings.webp)   |

[The two initial direction prototypes](directions.webp) retain their historical labels. Their pixels are not current application captures.

## Verification

The current application is compiled V15, Build `F67hmVCP6dIstDv04AqQ7`, from frozen source 675/SHA `70928462…f773f32`, readable 673 and QA 245. Its full locked-dependency runtime closure is 62,219 files/SHA `6b9a5f44…ab2f490`. Source, compiled bundle, owned processes/config/environment and declared fixture state are checked by the relevant before/after receipts.

Type checking, lint, production build and packaging passed. Unit tests:2,355 passed,0 failed,312 skipped. The 30 coordinated jobs completed with actual child exits 0; retained failed attempts remain separate. Maintained Core (38), Refinement (35), Library (38) and Polish (27) passed, alongside compiled Select (8)/settings (12)/SaveBar (12)/gallery (16)/preview (12) and the current navigation/font/filename/state checks. Strict coarse (2), mixed (4) and Timeline (17) passed; mixed continuity includes 28 native drags and 4,994 animation-frame observations, followed by original Timeline/coarse checks after exact fixture restoration. In the reverse-wheel cases, a retained focused file below the viewport displaced 56px on fine-pointer layouts and 49px on coarse layouts as intervening intrinsic rows acquired their measured heights. The reference and residual calculations both report 0px and share those observations; they are coupled checks. The raw displacement remains in the receipt.

The six capture groups contain 212 native frames, with 16 expected missing-page 404 diagnostics and 0 unexpected errors. Settings (11)/Audit (4) have their own read-only capture proofs and source/runtime brackets. All 227 capture/staging originals decode and match their native hashes. Separate real disposable upload/link cleanup, GET-only API (27) and actual OCR receipts retain their operation boundaries. OCR recognized 489 characters/confidence 85 with the preprovisioned English model and restored the original 37-file/OCR state; no uncached or network-isolated OCR claim follows.

Current canonical media contains 49 fresh V15 assets plus two explicitly older V4 audit/session movies. The older recordings establish their original operations only. Current desktop media preserves 529 raw/encoded frames/21.16 seconds. Phone media preserves 655 raw frames/26.2 seconds and a continuous 561-frame/22.44-second excerpt. Full decode/hash proofs passed; loading transitions remain. Wall-clock markers are not video-PTS calibrated, and full human frame-by-frame playback is not claimed.

Axe:80 ready scans,0 violations/operational issues, with 80 contrast incompletes/1,104 node occurrences retained. Contrast:5,654 candidates;2,312 measured, including 2,300 nonexempt/12 disabled;0 measured nonexempt threshold failures; sampled minimum 6.2 dark/5.41 light. The 3,342 unmeasured candidates remain explicit. Focus:272 desktop stops with one raw weak flag;104 direct sample points include 38 off-band points below 3 and minimum strongest edge-band 4.76. The 21 inspected native focus crops are bounded evidence, not every-stop or whole-perimeter certification.

The seven current before/after panels use recorded exact-d01 development-rendered inputs and current production-rendered captures; desktop inputs use 960×600 contain fitting and phones retain 390×844 native pixels. One additional directions panel remains historical prototype evidence. Capture dates/method differences remain literal. The separate paired numeric file has 424 matched keys/212 per theme but an unbound historical source at capture; it is not a fresh d01 performance or contrast-improvement claim.

Three retained pipeline attempts are disclosed separately: the initial missing Main80 dependency before upload creation, the offline projection's missing final output directory, and the interrupted desktop attempt. Current successful receipts and explicit recovery do not change those original statuses.

Handbook verification passed at `/` and `/flare/`:50 HTML pages/49 content stamps,36 script tests and 17 browser checks per base; coverage 100 API/13 named-token/60 environment/40 permission entries plus webhook schema. Source hashes for 51 canonical assets and 174 generated-to-dist asset copies per base matched. Optimized images are not claimed identical to source pixels. Hydrated 404, automatic version/commit/dirty provenance, official 88×31 creator button, xNefas credit and license checks passed; preview browsers/listeners closed. The documentation-change gate passed against exact d01f150 for the implementation and verification commits, with no pre-policy commits skipped.

Primary receipts are under `.agent-artifacts/refinement/evidence/`: `final29-unit/results.json`, the maintained groups' `run.json`, `final29-mixed/run.json`, `final29-accessibility/results.json`, `final29-metrics-stage/completion-companion.json`, `final29-api-example/results.json`, `final29-ocr-worker/results.json`, the seven current canonical-copy groups, `final29-supporting-operation-media/results.json`, and `final29-docs/results.json`.

These are JavaScript-enabled headless Linux Chromium checks. Segmenter fallback has unit coverage only; Firefox 111, physical devices, native OS zoom, physical assistive technology, other engines, Meticulous replay and hosted testing were not run.

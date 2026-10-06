---
description: Build, publish, and maintain Flare’s documentation alongside the code it describes.
---

# Keep the handbook useful

Documentation ships with the feature. If a change affects what a person can do, what an integration sends or receives, or how an operator runs Flare, update the corresponding guides in the same commit. This applies to coding agents and human contributors alike. The repository’s [AGENTS.md](https://github.com/FlintSH/Flare/blob/main/AGENTS.md) makes this part of the definition of done.

## Why the same repository?

The implementation, examples, screenshots, and documentation can be reviewed and released together. A separate docs repository would make it easier for a feature to ship without its guide. The docs are still an **independent static site**: Flare does not need VitePress, Vue, or a documentation server at runtime.

Markdown and theme sources live in `docs/site/`. Its dependencies and lockfile are separate. Build output and prepared media are ignored by Git and excluded from Flare’s Docker build. The asset script reuses the existing `docs/images/` and `.github/assets/` libraries, converts referenced images to WebP, and copies only the needed recordings. Do not commit duplicates of generated media.

## Run locally

Use Node.js 24 (the CI version), then run from the repository root:

```sh
npm ci --prefix docs/site
npm run dev --prefix docs/site
```

The development server prints its address. Content, theme, and local-search changes update as you work. Restart `dev` after adding a new screenshot reference so the asset preparation step runs again.

To build and inspect the actual static output:

```sh
npm run check:coverage --prefix docs/site
npm run build --prefix docs/site
npm run preview --prefix docs/site
```

The output is `docs/site/.vitepress/dist/`. `build` checks links, anchor targets, assets, and OpenAPI references after rendering. A missing guide or image should fail the build instead of becoming a broken page for readers.

This preview describes the checked-out source, including unreleased changes. The public site uses the separate release build below: the homepage follows stable, and readers must explicitly open the rolling preview for development prerelease instructions.

### Build the release site

From a checkout with the complete Git history and release tags:

```sh
git fetch origin main 'refs/tags/v*:refs/tags/v*'
npm ci --prefix docs/site
DOCS_BASE=/Flare/ npm run build:releases --prefix docs/site
DOCS_BASE=/Flare/ npm run test:releases --prefix docs/site
```

The release builder reads GitHub's published release metadata and resolves each stable release tag to its source commit. The latest stable release supplies the root handbook; every published stable release also has an archive at `/versions/TAG/` below `DOCS_BASE`. A release without the handbook uses the README and any earlier guides from its own tag. The builder does not fill missing historical guides with current instructions.

The same build adds `/rolling/` from the immutable commit recorded in the published rolling release's `flare-commit-sha` marker. The application uses this marker for rolling update checks too. The mutable local `rolling` tag and the publishing checkout are not substitutes: a local tag can be stale, and `main` can be ahead of published Docker images. The fetch command retrieves version tags without attempting to overwrite an existing local `rolling` tag. The builder fetches the published rolling commit if it is missing locally. Drafts and other prereleases are excluded; rolling is separate from the stable archive list and comparisons.

The output is `docs/site/.vitepress/releases/`. `build:releases` validates the assembled site; `test:releases` serves that output and checks stable content, archive navigation, dated releases, comparisons, and explicit rolling access in a browser. Install Chromium as described in [Browser checks](#browser-checks) before the first test run. Keep this generated output, intermediate checkouts, and downloaded release metadata out of Git.

Run one release build at a time. The builder copies the verified site into a sibling staging directory before replacing the previous output, then keeps a backup until the replacement succeeds. A failed copy leaves the old site intact; a failed replacement rolls back, retaining the backup if rollback cannot finish. The output path can briefly be absent between the two directory renames. If a build is interrupted there, the next `build:releases` run restores the backup before starting its build; after a completed replacement, it removes any leftover backup. The staging and backup directories are generated files and stay out of Git.

The build needs GitHub API access. In CI, `GH_TOKEN` receives the read-only repository token. Locally, `GH_TOKEN` or `GITHUB_TOKEN` can supply authentication, or the builder uses your authenticated GitHub CLI. Public release metadata also works without authentication within GitHub's unauthenticated rate limit. Keep tokens in your environment; never place one in a command committed to this repository. If fetching metadata or a source commit fails, resolve the reported access or Git error and rebuild. Do not substitute `main` for a missing stable release or rolling commit, or reuse a partial output directory as a deployment.

## What a complete update includes

| If you change…             | Update and verify…                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A user workflow            | Steps, labels, expected result, privacy/limits, troubleshooting, and current screenshots                                         |
| An admin control           | Who can change it, default, effect on existing users, related user-facing behavior, and recovery                                 |
| Hosting or persistence     | Configuration reference, deployment commands, backup/restore, upgrade and migration steps                                        |
| An API route               | Endpoint inventory, actual authentication, request and response schema, statuses, units, examples, OpenAPI where token-supported |
| A webhook                  | Event schema, signature verification, retry behavior, operating limits, and working receiver example                             |
| A capability or navigation | Feature explorer, sidebar, cross-links, tour, and examples that mention it                                                       |

Trace claims to the source. A route existing under `/api/` does not mean a named token can call it. A “private” checkbox does not mean administrators cannot read the data. An account export is not a server backup. Explain these boundaries directly.

Do not add filler to satisfy a gate. For an internal change with no user-visible effect, record why the existing guidance remains correct in the PR and review the relevant pages. Coverage checks are structural aids; they cannot establish that the prose is complete or true.

## Screenshots and recordings

Use a local instance and demonstration data. Never photograph a real token, secret, private file, or customer account. Capture the real interface; do not reconstruct it in an image generator. Inspect the image before adding it, especially after feature removals or renamed controls.

Use the globally registered component:

```vue
<Screenshot
  src="/screenshots/handbook/upload-profiles.webp"
  alt="Flare’s upload profile editor showing saved sharing defaults"
  caption="Choose which options a profile overrides; leave others inherited."
/>
```

`/screenshots/` maps to source images under `docs/images/`; `/evidence/` maps to `.github/assets/`. Use a literal source path so asset preparation can find it. PNG and JPG source paths automatically become generated WebP URLs. New source images should normally already be compact WebP files. Keep one canonical source and let the build prepare it.

Recordings need a useful written transcript, manual playback, and `preload="none"`. Respect reduced-motion preferences. Clearly distinguish recorded real app behavior from the local educational simulations in the interactive labs. Do not add an unlabeled fake server or a demo that secretly calls a reader’s instance.

## Project credits and the author button

The handbook footer credits Flare’s creator, **FlintSH**, and links to [fl1nt.dev](https://fl1nt.dev). Keep this credit on the homepage and every guide, alongside the MIT license and xNefas’s icon credit.

`ProjectCredit.vue` uses the official **88 × 31** button from `https://fl1nt.dev/images/mybutton.gif`. This follows the website’s **Hotlink my Button! → Copy Code** snippet. Keep its original dimensions, colors, and pixel art; do not stretch, recolor, or redraw it. The image is hotlinked, so no duplicate brand asset is added to the repository. The visible author name and website remain a working link if the image cannot load.

## Browser checks

From `docs/site/`:

```sh
npx playwright install chromium
npm test
```

Tests use the production build and cover local search, feature filtering, screenshot keyboard dismissal, upload-option precedence, additive role permissions and token scope intersection, safe API code generation, version/commit provenance, desktop/mobile overflow, failed asset requests, and automated WCAG checks in light and dark themes. The Git policy fixture also proves that a later documentation commit cannot cover an earlier undocumented feature commit. Linux machines may need Playwright's system dependencies; CI uses `npx playwright install --with-deps chromium`.

The separate `npm run test:releases` suite verifies the assembled stable site, release archives, and rolling preview after `npm run build:releases`. Run both suites when changing version navigation, comparisons, or publishing. Source-preview tests cannot establish that deployment selected the correct stable and rolling revisions.

When changing links or theme components, also test a subpath build:

```sh
DOCS_BASE=/flare/ npm run build
DOCS_BASE=/flare/ npm test
```

`DOCS_BASE` must begin and end with `/`. Afterward rebuild without that variable if you want a root deployment. For Vue components, use `withBase()` for local links and assets. Regular Markdown links are handled by VitePress.

## Dependency maintenance

Keep Flare's `pnpm-lock.yaml` and the handbook's `package-lock.json` separate. Use Node.js 24 and the pnpm version in the root `package.json`; install with `pnpm install --frozen-lockfile` and `npm ci --prefix docs/site`. Check both dependency trees with `pnpm audit` and `npm audit --prefix docs/site` before a release. A clean audit describes the advisories known at that time, not a guarantee against future findings.

The 2.1 dependency refresh keeps the existing application framework versions compatible. The root overrides update Prisma's configuration merger and Meticulous's browser installer to address vulnerable transitive packages. The browser installer includes its proxy and ZIP extraction dependencies so local testing still works without requiring a system `unzip` command. The handbook separately overrides Vite to its patched 6.4 line while retaining stable VitePress. Recheck these overrides against upstream releases before removing them, and run application tests, database migrations, production builds, and local browser checks after changes.

## Database permission and avatar regression tests

The role/cleanup and avatar race suites require **two separate disposable PostgreSQL databases**. Create them on a loopback server with names beginning `flare_roles_test_` and `flare_avatar_test_`. Use a local test database role allowed to apply migrations and manage fixture tables. Both suites clear fixture tables in their dedicated databases. Do not use an application or browser-demo database for these tests.

From the repository root, set connection URLs appropriate to that disposable server. These examples assume the local test role can connect without a password; supply your test server's authentication and port when needed:

```sh
export FLARE_ROLES_DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_roles_test_local?schema=public'
export FLARE_AVATAR_DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_avatar_test_local?schema=public'
DATABASE_URL="$FLARE_ROLES_DATABASE_URL" pnpm exec prisma migrate deploy
DATABASE_URL="$FLARE_AVATAR_DATABASE_URL" pnpm exec prisma migrate deploy
pnpm exec vitest run \
  __tests__/permissions/database.test.ts \
  __tests__/storage/avatar-database.test.ts
```

Apply migrations to both databases before running the suites. Missing either environment variable **skips that suite**; check the test output rather than treating a skipped run as coverage. CI supplies both URLs. The database checks exercise role authority, recovery safeguards, bulk account cleanup, original storage targets, upload/deletion races, and durable avatar intents. They use real PostgreSQL and local files, with controlled S3 SDK responses; they do not substitute for testing a real S3-compatible provider.

The [browser/API role recipes](/admin/roles#reproduce-the-permission-checks-locally) cover the rendered controls and real session behavior separately.

## Security browser checks and demos

The [sign-in security guide](/guide/security) includes real application captures for authenticator setup, both recovery methods, passkeys, and the optional passkey requirement. The passkey recordings use Chromium's virtual authenticator: the application and server perform real WebAuthn ceremonies, while the virtual device stands in for a physical authenticator. They do not show or test a native biometric prompt or a live external SSO provider.

Use a **disposable local PostgreSQL database named exactly `flare_auth_demo`**. The seed script accepts only `localhost` or `127.0.0.1` and rejects other database names, including `flare_auth_demo_backup`. Omit the `schema` URL parameter or set it once to `public`; other schemas, duplicate schema parameters, and all other URL query parameters are rejected. It resets its two public fixture accounts and security rate counters. Never use an existing application database. With the dependencies installed, create the database using your local PostgreSQL tools, then start the app from the repository root:

```sh
export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_auth_demo'
export NEXTAUTH_URL='http://localhost:3061'
export NEXTAUTH_SECRET='public-disposable-security-demo-secret-2026-only'
export METICULOUS_RECORDING_ENABLED=false
export NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN=''
pnpm exec prisma migrate deploy
pnpm exec next dev --hostname 127.0.0.1 --port 3061
```

The database role, port, and authentication must match your disposable server. In another terminal with the same `DATABASE_URL`, initialize the app configuration by opening `http://localhost:3061/auth/login`, then run:

```sh
node scripts/security/seed.cjs
node scripts/security/verify-ui.cjs
```

The fixture emails are `security-demo-alex@example.test` and `security-demo-jamie@example.test`; both use the deliberately public password `Security-demo-only-2026!`. The browser checks use real requests to enroll an authenticator, require a second factor at login, consume and reject reused authenticator recovery codes, replace codes, disable 2FA, register and use a passkey, rename/remove it, reject assertion replay and removed credentials, reject bearer/origin misuse, and invalidate old sessions. The required-passkey flow additionally blocks the correct password, refuses last-key removal, signs in with dedicated emergency codes without a password, rejects their reuse and replaced sets, and restores password sign-in only after an explicit disable operation. The ordinary browser run uses a 390 × 844 viewport for recovery and replacement flows. Recordings keep a stable desktop viewport; separate mobile stills use the same 390px width with extra height so the complete controls remain visible. A fresh TOTP time step may require waiting up to 30 seconds. Run the seed again before repeating the suite.

To refresh visual evidence, set `FLARE_SECURITY_SCREENSHOTS` to an output directory and `FLARE_SECURITY_VIDEOS` to a separate temporary directory before running the browser script. It captures screenshots as WebP and three completed walkthroughs as `two-factor-demo.webm`, `passkey-demo.webm`, and `passkey-required-demo.webm`. Secrets are hidden by capture-only CSS installed before application scripts: QR codes, manual keys, both recovery-code sets, and sensitive inputs never appear in recorded frames. The capture CSS does not alter the shipped UI. Inspect every resulting image and recording before replacing the canonical sources in `docs/images/security/` and `.github/assets/security/`. Include updated written transcripts in the guide and [demos](/demos). Keep temporary browser output and failed recordings out of Git.

To check a recent sign-in expiring while password/email edits or an **Add a passkey** dialog remain open, run this separate regression after reseeding:

```sh
node scripts/security/seed.cjs
node scripts/security/verify-proof-expiry.cjs
```

This check uses the exact public demonstration secret above and an HTTP `localhost` origin. It performs real authenticator enrollment and recovery sign-in, then adjusts only the demonstration session's authentication timestamp to just beyond five minutes. Server responses are real; elapsed time is controlled. It exercises three open forms:

1. Enter password changes, expire the recent recovery proof, submit, and verify the code prompt appears without a profile mutation. Complete the proof and verify the password change succeeds.
2. Repeat for a plain email change, verifying the entered address remains and no update is sent before the restored proof fields are completed.
3. Open **Add a passkey** and enter a name while recovery proof is fresh. Expire that proof while the dialog stays open. Verify the name remains, password/code controls appear, and no security mutation is sent. Complete the proof and the virtual authenticator's real WebAuthn registration, then verify the saved passkey retains its name.

Optional `FLARE_SECURITY_SCREENSHOTS` output includes `proof-expired.webp` with password values masked. The check changes Alex's email/password and registers a passkey; reseed before another suite or demo run.

For the separate authentication database regression suite, create and migrate a disposable local database named exactly `flare_security_test_local` (or `flare_security_test_ci` for CI), then run:

```sh
export FLARE_SECURITY_DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_security_test_local'
DATABASE_URL="$FLARE_SECURITY_DATABASE_URL" pnpm exec prisma migrate deploy
pnpm exec vitest run __tests__/auth/security-database.test.ts
```

Without that variable the database suite is skipped. The guard accepts only PostgreSQL URLs on `localhost` or `127.0.0.1`, using one of the two exact database names above and either no `schema` parameter or a single `schema=public`. Other URL query parameters are rejected. CI supplies its dedicated database. These tests cover atomic redemption for both code sets, stale-session fences, enrollment, encrypted secret handling, required-passkey transitions and fallback guards, and recovery for local and SSO-only accounts. They complement the browser ceremonies; neither substitutes for testing actual platform authenticators or a live identity provider.

## Sessions and audit browser checks and demos

The [profile session guide](/guide/account#login-history-and-active-sessions), [audit guide](/admin/audit), and [recorded walkthroughs](/demos#review-and-revoke-browser-sessions) use real application operations with disposable accounts. They do not rely on production accounts or fabricated audit rows.

Create a **disposable local PostgreSQL database named exactly `flare_audit_demo`** using your local PostgreSQL tools. The seed guard accepts only `localhost` or `127.0.0.1`, with `schema` omitted or set once to `public`; suffix database names, other schemas, duplicate schema parameters, and other URL query parameters are rejected. Use isolated uploads too. Never point this recipe at an existing application database: the seed replaces its demonstration accounts, clears security rate counters, and disables automatic OCR and OIDC in the fixture configuration.

With application dependencies installed, run from the repository root:

```sh
export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_audit_demo'
export NEXTAUTH_URL='http://localhost:3071'
export NEXTAUTH_SECRET='public-disposable-audit-demo-secret-2026-only'
pnpm exec prisma migrate deploy
pnpm dev --port 3071
```

Adjust the database role, port, and authentication to match your disposable PostgreSQL server. Open `http://localhost:3071/auth/login` once so the app initializes its configuration. In a second terminal with the same `DATABASE_URL`, run:

```sh
npm ci --prefix docs/site
cd docs/site
npx playwright install chromium
cd ../..
node scripts/audit/seed.cjs
node scripts/audit/verify-ui.cjs
```

The deliberately public fixture password is `Audit-demo-only-2026!`. The accounts are **Alex Morgan** (`audit-demo-alex@example.test`, administrator), **Jamie Rivera** (`audit-demo-jamie@example.test`), and **Casey Chen** (`audit-demo-casey@example.test`). Use `FLARE_AUDIT_TEST_ORIGIN` to select another `localhost` application origin; its default is `http://localhost:3071`. The script uses the documentation Playwright installation and can use `PW_CHROMIUM_EXECUTABLE_PATH` for an installed Chromium binary. Install Chromium's required system libraries on a new Linux host.

Run the seed before repeating the browser checks and inspect the JSON results and exit status. The workflow performs real account/file/security operations and OCR of a generated receipt test image, verifies that recognized text is absent from audit details, leaves demonstration evidence for inspection, and should run only against its disposable server. Discard its database and upload directory after verification. API examples in [sessions and audit contracts](/api/activity) can be executed in an authenticated console on this same instance.

Capture screenshots and videos in separate runs, reseeding before each. Set only `FLARE_AUDIT_SCREENSHOTS` to a temporary directory for desktop/mobile stills; for the recording pass, leave that variable unset and set only `FLARE_AUDIT_VIDEOS`. Element screenshots can briefly resize the browser and spoil a simultaneous recording. The videos keep desktop dimensions; mobile coverage is recorded separately in the stills and browser assertions. Review every image and both recordings for credentials, private data, readable pauses, and the final sign-in screen. Only then replace canonical sources under `docs/images/audit/` and `.github/assets/audit/`. Keep generated copies under `docs/site/public/`, failed recordings, and temporary browser output out of Git. Update the descriptive transcripts on the demos page when the recorded steps change. The documentation browser checks verify that both recordings load without autoplay and that the new guides fit desktop and mobile viewports.

### Audit database regression checks

Create and migrate a separate local PostgreSQL database named exactly **`flare_audit_test`** before running the database suite. The guard accepts only `localhost` or `127.0.0.1`; supported URL options are `schema=public` and `connection_limit`. These tests erase users, roles, settings, and audit rows in that disposable database, so keep it separate from both the browser demo and an existing instance.

```sh
export FLARE_AUDIT_DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_audit_test?connection_limit=1'
DATABASE_URL="$FLARE_AUDIT_DATABASE_URL" pnpm exec prisma migrate deploy
pnpm exec vitest run __tests__/audit
```

Without `FLARE_AUDIT_DATABASE_URL`, database cases are skipped while core/API tests still run. The PostgreSQL cases verify commit/rollback handling, transaction connection use, safe settings and role snapshots, bulk filename retention beyond 1,000 files, tag metadata, email-failure outcomes, and avoiding recursive logging. The one-connection example also checks that transaction snapshots do not wait on a second connection. These checks complement the rendered browser flows and the session-security tests.

## Local visual testing with Meticulous

Flare no longer runs Meticulous in GitHub Actions or uploads builds for hosted test runs. The CLI, repository skills under `.agents/skills/`, browser/backend recorders, and disposable test image remain available for local visual checks. Agents can use `meticulous-simulate-and-diff` to replay relevant sessions against a local app and inspect screenshots during development. Follow the repository's `AGENTS.md` policy when a skill includes a final hosted run: that step is disabled here.

Local replay runs Chromium locally, but still uses Meticulous services for authentication, execution configuration, and session/replay data; simulation results are uploaded to Meticulous. It is not an offline service or a guarantee of free access to every command. Use the capabilities available to your account without starting paid hosted work. Do not run `meticulous ci`, `meticulous agent upload-build`, or `meticulous agent trigger-test-run` as part of routine validation. If service access or a usable session is unavailable, report that limitation and use local browser checks instead.

### Start a disposable app

Run these commands from the repository root with Docker available:

```sh
docker build --build-arg METICULOUS_BUILD=true -t flare-meticulous-app .
docker build -f Dockerfile.meticulous -t flare-meticulous .
docker run --rm -p 127.0.0.1:3000:3000 flare-meticulous
```

Wait for startup to finish, then open `http://localhost:3000/auth/login`. The fixture administrator is `meticulous@example.test` with password `Flare-test-only-2026!`. These credentials and the image's session secret are deliberately public test fixtures; use this image only for isolated local testing.

`Dockerfile.meticulous` extends the normal app image with PostgreSQL and a process supervisor. Every container start creates a fresh database, runs migrations, seeds the fixture administrator, and starts Flare with its normal authentication guards. PostgreSQL listens only on loopback inside the container. The entrypoint ignores an external `DATABASE_URL`; no hosted database is needed. Stopping the container discards this test state. Rebuild both images after changing application code.

### Replay and compare locally

If needed, install the CLI outside Flare's runtime dependencies:

```sh
npm install --global @alwaysmeticulous/cli@latest
meticulous auth whoami
meticulous schema simulate
```

If authentication is missing, run `meticulous auth login` in an interactive terminal. OAuth project selection is available through `meticulous auth set-project`. An existing `METICULOUS_API_TOKEN` can also authenticate the CLI; keep it in your environment or secret store, never in commands committed to this repository. The public recording token described below is a different credential.

Choose a session recorded against the same disposable fixtures that exercises the changed UI, or [record one](#record-a-local-session). Replace `SESSION_ID` with its actual ID. With a known-good version of the local app running, make a baseline:

```sh
METICULOUS_SESSION_ID='SESSION_ID'
meticulous simulate \
  --sessionId="$METICULOUS_SESSION_ID" \
  --appUrl=http://localhost:3000 \
  --headless --takeSnapshots --storyboard
```

Save the replay ID from the command's `View simulation at:` URL. Run the changed app at the same address, then replay the same session with that baseline:

```sh
METICULOUS_BASE_REPLAY_ID='BASE_REPLAY_ID'
meticulous simulate \
  --sessionId="$METICULOUS_SESSION_ID" \
  --appUrl=http://localhost:3000 \
  --baseReplayId="$METICULOUS_BASE_REPLAY_ID" \
  --headless --takeSnapshots --storyboard
```

Inspect the per-screenshot results, screenshots, and changed DOM metadata under `~/.meticulous/replays/`. Diffs are stored under the new replay's `diffs/BASE_REPLAY_ID/` directory. Without `--baseReplayId`, the command captures screenshots for inspection but does not establish that the UI is unchanged. Report the exercised routes, expected changes, unexpected differences, and any failed or incomplete replay. Keep session downloads, replay output, and caches out of Git; a repository-local `.meticulous/` directory is excluded from Git and the Docker build context.

For an HTTP `--appUrl`, the CLI does not configure backend replay inside the running app. These commands combine browser network stubs with server rendering against the live disposable database. Recorded cookies must match the fixture account and session secret, and any server-visible data the flow needs must exist in that database. A browser-stubbed write does not populate the local database. If a session depends on missing state, prepare matching demonstration fixtures or choose another session; an incomplete replay is not a passing visual check. Setting `METICULOUS_BACKEND_RECORDER_MODE=replay` alone cannot restore recorded backend state because it also needs session-specific mock data.

### Record a local session

Flare passes the browser session ID to its backend recorder, which instruments server rendering and Prisma calls. Ordinary production recording stays off unless explicitly enabled. Development/preview recording requires `NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN`; for local development it can live in gitignored `.env.local`. Keep recording limited to demonstration data because recordings include interactions, network data, and account context.

To record the disposable production build, stop the first container, export your project's public recording token in your shell, then run:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e METICULOUS_RECORDING_ENABLED=true \
  -e NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN \
  flare-meticulous
```

In another terminal, run `meticulous record session`. Sign in with the fixture user in its recording browser, then open `http://localhost:3000/dashboard` in a new tab of that same browser to start an authenticated recording. Its initial state must include the authentication cookie: a stubbed sign-in response cannot create a real server session for later server-rendered requests. The CLI recorder captures HTTP-only cookies, unlike the page script alone. When driving that browser automatically, call `window.Meticulous.record.flush()` before closing it so final interactions are uploaded.

For server-rendered replay, the project's Network Stubbing setting must be **Stub all requests, apart from requests for server components and static assets**. This lets the current app render its own server components instead of returning recorded development-build responses. Backend recordings remain available to tooling configured to use them, but the local HTTP URL recipe above does not automatically inject them. A replay is a simulation using recorded network responses; it does not prove that a real upload, email, or webhook was delivered.

### Retire existing hosted CI setup

The former `.github/workflows/meticulous.yaml` workflow has been removed. Once that change is on the default branch, repository administrators should remove any Meticulous required status checks from branch protection or rulesets, disable any separately configured Meticulous GitHub integration automation, and remove the repository Actions secret `METICULOUS_API_TOKEN` if nothing else uses it. Already queued runs and external integration settings are not canceled by deleting the workflow file. Local CLI credentials and recording tokens are separate from the retired Actions secret.

## Automatic coverage checks

`npm run check:coverage` checks every API route file against the inventory, verifies all named-token operations, scopes, and current role requirements against `openapi.json`, checks that every permission key is covered in the roles guide, compares the downloadable webhook schema to its canonical version, and checks that supported environment variables appear in the configuration guide.

Changes to role and user-management components or `lib/permissions/` require administration guidance; changes to the permission-to-route map also require the API reference. The gate tests these paths with an isolated Git fixture.

CI also checks each non-merge commit on pull requests and direct pushes to `main`:

```sh
npm run check:changes -- --base BASE_COMMIT_SHA
```

Replace `BASE_COMMIT_SHA` with the actual hexadecimal commit SHA you are comparing against. The gate requires related documentation areas to change in the same commit as user, administrator, hosting, or API code. A documentation follow-up commit does not cover an earlier feature commit; amend or reorganize the commits before submitting. It cannot verify semantic completeness; reviewers and agents must still use the coverage matrix in `AGENTS.md`.

## Publish the site

The [VitePress deployment guide](https://vitepress.dev/guide/deploy) describes the static hosting model. No database, authentication secret, server-side renderer, or app environment variables are needed for this site.

### GitHub Pages

The repository includes `.github/workflows/docs.yml`. On pull requests and pushes it checks and browser-tests the current source, then builds and tests the stable site, release archives, and rolling preview from the same checkout. Pull requests never upload a Pages artifact or deploy. Publishing is opt-in through the repository variable below.

1. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
2. Add the repository Actions variable `DOCS_PAGES_ENABLED` with the value `true`.
3. The workflow defaults to the repository subpath, such as `/Flare/`. If you use a custom domain at its root, set the Actions variable `DOCS_BASE` to `/` and configure that domain in Pages settings.
4. Run the **Documentation** workflow on `main`, or push a docs change to `main`.

The build job uploads only `docs/site/.vitepress/releases/` as the Pages artifact, and the deployment job reports the actual published URL. The root content comes from GitHub's latest stable release, even when the workflow runs after a push containing unreleased application changes. `/rolling/` comes from the published rolling commit. The navigation and archive tooling can improve independently while application guidance remains tied to its release or rolling commit.

Publishing runs after a successful **Release** or **Rolling Release** workflow from this repository's `main`, when a stable or rolling release is manually published or edited, on pushes to `main`, and on manual **Documentation** runs from `main`. The `workflow_run` trigger is necessary because tags and releases created with `GITHUB_TOKEN` do not trigger another push/release workflow. Failed release workflows, draft releases, and other prereleases do not publish docs. A push may build before rolling images are ready; the successful **Rolling Release** completion rebuilds the website with the newly published rolling commit. Publishing runs are serialized across trigger types so their builds and deployments cannot overtake one another. A failed build or browser check leaves the previous Pages deployment in place; fix the failure and rerun **Documentation** on `main`.

Release events, completed release workflows, and manual publishing use the tooling checked out from `main`. Source checks and release builds share that one checkout, so an intervening commit cannot change the tooling between validation and building. No checkout reference or build artifact from a pull request or another workflow is used to publish. Git credentials are not persisted, and the workflow does not restore or save dependency caches. Only the separate deployment job receives Pages write permissions, after all checks pass.

### Any other static host

Use the repository as the build source, set the build root to the repository root, and configure:

| Setting           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Node version      | `24`                                                           |
| Install command   | `npm ci --prefix docs/site`                                    |
| Build command     | `npm run build:releases --prefix docs/site`                    |
| Publish directory | `docs/site/.vitepress/releases`                                |
| Base path         | `DOCS_BASE=/` for a domain root; otherwise the mounted subpath |

The repository root, complete Git history and tags, and GitHub release API access are required during the build. Screenshots and runnable examples come from the selected stable or rolling source directories. Keep `GH_TOKEN`, if needed, in the host's build environment; it must not be embedded in the site. Deploy only the output directory afterward. Ordinary `.html` URLs are intentional: deep links work on basic static hosts without a catch-all rewrite. Configure the host to serve `index.html` for directory URLs and `404.html` for missing pages.

For an existing web server, build locally and copy the output into a dedicated static document root. Do not route documentation requests through the Flare application or expose the repository, `.env`, source maps containing private code, or build credentials.

## Releases and older guides

The [versions and changes page](./versions) lists dated archives for every published stable release and compares their original documentation sources. Dates in the list come from the release's `published_at` metadata in UTC. They are separate from source commit dates and website build dates. A rebuild can update the website's presentation without changing the archived application documentation.

The same page offers **Open rolling docs (unreleased)** as an explicit choice. Rolling pages show **Rolling preview · Unreleased**, an explanation that they describe a rolling build, and **Read stable docs** to return to the default handbook. Rolling is never selected automatically or remembered as the homepage default. Its update date uses the rolling release's `updated_at`, because `published_at` belongs to the first publication of the reused release. Its commit identifies the actual source; its build date identifies the website build. The rolling path is mutable and does not archive every development commit. Rolling pages request `noindex`; this limits search discovery and is not access control.

Every page displays its Flare version and the source commit that supplied the documentation, with a link to that exact commit. **Build details** opens the corresponding `build-info.json`, including the full hash and UTC build time. Release builds identify their tagged content and publishing source separately. Local previews with modified or untracked source show **Uncommitted changes**; they must not be presented as an exact clean-commit build. Source archives without Git metadata show that the commit is unavailable (or use `GITHUB_SHA` when a CI archive provides it).

The preview stamp is regenerated by `npm run assets`, which runs before `dev` and `build`; release builds generate provenance for each archived source. No release label, date, or hash needs to be maintained by hand. Keep release-sensitive notes in the relevant guide and tell users where to see their installed version. A version selector links to the matching archive; do not assume current stable instructions apply to an older installation.

The handbook first shipped in 2.1.0. Version 2.0.0 has its original README and nine engineering guides; earlier stable releases have only their README. The archive presents these as legacy documentation, preserving the coverage that existed at the time. It does not claim that later handbook topics or interactive demonstrations existed in those releases. Historical examples may contain mutable `latest` image tags or external service links; archive readers should use explicit release tags when reproducing an older setup.

Comparisons show added and removed source lines between the selected releases. Handbook snapshots include `docs/site/` Markdown, theme components, and downloadable JSON contracts such as OpenAPI; legacy snapshots include `README.md` and `docs/*.md`. Comparing a legacy release with a handbook release therefore shows earlier engineering guides as removed and handbook pages as added. These comparisons help locate changed instructions, but do not replace application release notes, migrations, or upgrade guidance. A moved page can appear as a removal and an addition. Preserve historical source content; update present-day explanations in the version browser or the current relevant guide.

The same-commit documentation gate starts when the policy is introduced; it does not retroactively reject commits that predate the handbook.

If a feature is renamed or removed, update navigation and incoming links in the same change. Keep a short redirect/link page when there are established external links. OpenAPI and example clients must change with the implementation; do not promise a versioning policy the server does not implement.

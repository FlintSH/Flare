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

Tests use the production build and cover local search, feature filtering, screenshot keyboard dismissal, upload-option precedence, safe API code generation, version/commit provenance, desktop/mobile overflow, failed asset requests, and automated WCAG checks in light and dark themes. The Git policy fixture also proves that a later documentation commit cannot cover an earlier undocumented feature commit. Linux machines may need Playwright's system dependencies; CI uses `npx playwright install --with-deps chromium`.

When changing links or theme components, also test a subpath build:

```sh
DOCS_BASE=/flare/ npm run build
DOCS_BASE=/flare/ npm test
```

`DOCS_BASE` must begin and end with `/`. Afterward rebuild without that variable if you want a root deployment. For Vue components, use `withBase()` for local links and assets. Regular Markdown links are handled by VitePress.

## Automatic coverage checks

`npm run check:coverage` checks every API route file against the inventory, verifies all named-token operations and scopes against `openapi.json`, compares the downloadable webhook schema to its canonical version, and checks that supported environment variables appear in the configuration guide.

CI also checks each non-merge commit on pull requests and direct pushes to `main`:

```sh
npm run check:changes -- --base BASE_COMMIT_SHA
```

Replace `BASE_COMMIT_SHA` with the actual hexadecimal commit SHA you are comparing against. The gate requires related documentation areas to change in the same commit as user, administrator, hosting, or API code. A documentation follow-up commit does not cover an earlier feature commit; amend or reorganize the commits before submitting. It cannot verify semantic completeness; reviewers and agents must still use the coverage matrix in `AGENTS.md`.

## Publish the site

The [VitePress deployment guide](https://vitepress.dev/guide/deploy) describes the static hosting model. No database, authentication secret, server-side renderer, or app environment variables are needed for this site.

### GitHub Pages

The repository includes `.github/workflows/docs.yml`. It builds and browser-tests docs on pull requests and pushes. Publishing is opt-in so introducing documentation does not unexpectedly replace an existing Pages site.

1. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
2. Add the repository Actions variable `DOCS_PAGES_ENABLED` with the value `true`.
3. The workflow defaults to the repository subpath, such as `/Flare/`. If you use a custom domain at its root, set the Actions variable `DOCS_BASE` to `/` and configure that domain in Pages settings.
4. Run the **Documentation** workflow on `main`, or push a docs change to `main`.

The deployment job reports the actual published URL. Do not advertise a public documentation URL until that deployment succeeds.

### Any other static host

Use the repository as the build source, set the build root to the repository root, and configure:

| Setting           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Node version      | `24`                                                           |
| Install command   | `npm ci --prefix docs/site`                                    |
| Build command     | `npm run build --prefix docs/site`                             |
| Publish directory | `docs/site/.vitepress/dist`                                    |
| Base path         | `DOCS_BASE=/` for a domain root; otherwise the mounted subpath |

The repository root is required during the build because screenshots and runnable examples are copied from shared source directories. Deploy only the output directory afterward. Ordinary `.html` URLs are intentional: deep links work on basic static hosts without a catch-all rewrite. Configure the host to serve `index.html` for directory URLs and `404.html` for missing pages.

For an existing web server, build locally and copy the output into a dedicated static document root. Do not route documentation requests through the Flare application or expose the repository, `.env`, source maps containing private code, or build credentials.

## Releases and older guides

Every page displays the Flare version from the root `package.json` and the source commit that produced the docs, with a link to that exact commit. **Build details** opens `/build-info.json`, which also includes the full commit hash and UTC build time. Local previews with modified or untracked source show **Uncommitted changes**; they must not be presented as an exact clean-commit build. Source archives without Git metadata show that the commit is unavailable (or use `GITHUB_SHA` when a CI archive provides it).

The stamp is regenerated by `npm run assets`, which runs before `dev` and `build`. No version string or hash needs to be edited by hand. The handbook describes that source revision. Keep release-sensitive notes in the relevant guide and tell users where to see their installed version. For a pinned older release, check the documentation in that Git tag instead of assuming the current handbook applies.

The same-commit documentation gate starts when the policy is introduced; it does not retroactively reject commits that predate the handbook.

If a feature is renamed or removed, update navigation and incoming links in the same change. Keep a short redirect/link page when there are established external links. OpenAPI and example clients must change with the implementation; do not promise a versioning policy the server does not implement.

# Make Flare yours

Open **Settings → Appearance** (`/dashboard/settings?section=appearance`) to manage the instance design. Every account can save a light, dark, system, or inherited dashboard preference under **Profile → Account** (`/dashboard/profile?section=account#workspace-appearance`). Public share pages use the instance appearance.

Administrators can use **Settings → Appearance** to change the instance name, tagline, light/dark logos and footer text; choose paired color palettes, typeface, background and corner radius; and configure Minimal, Framed or Delivery share pages. Turn on **Use studio theme** to apply studio palettes. Existing color and favicon controls are in the same Appearance section. Custom CSS and head HTML are under **Settings → Appearance → Custom CSS and HTML**.

Sharing controls configure uploader attribution, filename, size, footer, image fit and social preview text. Templates accept `{{instanceName}}`, `{{filename}}`, `{{size}}` and `{{uploader}}`. A hidden detail is also omitted from generated social text. These are presentation choices: existing URLs and downloaded files can still contain their original names. Visibility and passwords continue to control file access. Upload profiles can select a share style; files with no stored style inherit the instance default.

**Save draft** keeps edits separate from the live instance. Preview light/dark, image/code and protected examples, then **Publish appearance**. Publishing retains the previous appearance; **Restore previous** restores it. Saves detect concurrent changes and ask you to reload instead of overwriting another administrator's work.

**Appearance packs** export the design being previewed as versioned JSON. Packs include identity, embedded PNG/JPEG/WebP logos, palettes, surfaces and sharing choices. They exclude users, uploaded files, credentials and executable code. Importing creates a saved draft; review it before publishing. Logo uploads are limited to 256 KB each, and packs to 1 MB.

## Recover an unusable appearance

Sign in as an administrator and open `/dashboard/settings?section=appearance&recovery=1` directly. This page uses the original Flare theme and suppresses legacy custom CSS/head HTML without modifying saved settings. Restore a previous studio appearance, or follow **repair custom CSS and HTML below** to `/dashboard/settings?section=appearance&recovery=1#advanced-styles` and fix the CSS/head fields. Return to `/dashboard/settings?section=appearance` to check the live result.

Recovery is limited to Settings and the legacy appearance link. It requires the signed session and a current administrator role; adding a request header cannot activate it on public pages. It does not disable authentication or change file access.

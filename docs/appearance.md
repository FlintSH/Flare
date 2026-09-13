# Make Flare yours

Open **Workspace → Appearance** (`/dashboard/customize`). Every account can save a light, dark, system, or inherited dashboard preference under **My workspace**. Public share pages use the instance appearance.

Administrators can use **Instance appearance** to change the instance name, tagline, light/dark logos and footer text; choose paired color palettes, typeface, background and corner radius; and configure Minimal, Framed or Delivery share pages. Turn on **Use studio theme** to apply studio palettes. Existing colors, custom CSS/head HTML and favicon settings remain available in Settings.

Sharing controls configure uploader attribution, filename, size, footer, image fit and social preview text. Templates accept `{{instanceName}}`, `{{filename}}`, `{{size}}` and `{{uploader}}`. A hidden detail is also omitted from generated social text. These are presentation choices: existing URLs and downloaded files can still contain their original names. Visibility and passwords continue to control file access. Upload profiles can select a share style; files with no stored style inherit the instance default.

**Save draft** keeps edits separate from the live instance. Preview light/dark, image/code and protected examples, then **Publish appearance**. Publishing retains the previous appearance; **Restore previous** restores it. Saves detect concurrent changes and ask you to reload instead of overwriting another administrator's work.

**Appearance packs** export the design being previewed as versioned JSON. Packs include identity, embedded PNG/JPEG/WebP logos, palettes, surfaces and sharing choices. They exclude users, uploaded files, credentials and executable code. Importing creates a saved draft; review it before publishing. Logo uploads are limited to 256 KB each, and packs to 1 MB.

## Recover an unusable appearance

Sign in as an administrator and open `/dashboard/customize?recovery=1` directly. This page uses the original Flare theme and suppresses legacy custom CSS/head HTML without modifying saved settings. Restore a previous studio appearance, or follow **repair advanced styles in Settings** to `/dashboard/settings?recovery=1` and fix the CSS/head fields. Return to `/dashboard/customize` to check the live result.

Recovery is limited to those two administrator pages. It requires the signed session and a current administrator role; adding a request header cannot activate it on public pages. It does not disable authentication or change file access.

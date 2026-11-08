---
description: Brand Flare with the appearance studio, paired palettes, share layouts, portable packs, custom styles, and a recovery path.
---

# Make Flare yours

Publishing and managing instance appearance requires `appearance.manage`; Administrator includes it. Personal theme preference uses the separate `appearance.personal` permission. Delegate design with a role containing `settings.read` and `appearance.manage`; it need not grant account, email, or storage administration.

Open **Settings → Appearance** to design the instance's identity and public share experience. Start with a preset, preview the result, then publish when it feels right. A separate draft lets you work without changing the site everyone is using.

## A draft-to-publish workflow

1. Choose **Identity**, **Theme**, or **Sharing** and edit the design. The preview follows your working design.
2. Check light and dark modes, image and code examples, and a protected-file example.
3. Choose **Save draft** to keep the design for later, or **Publish appearance** to make it live.
4. Open a real share page and the dashboard on desktop and mobile.
5. If you need to go back, choose **Restore previous**.

These actions are in the bar under the studio, which also shows whether you have unsaved changes, a saved draft, or the published design. Flare keeps a saved draft, the published design, and the previous published design. This is a one-step restore, not an unlimited history. **Discard** removes the draft without changing the published appearance; with unsaved edits and no draft, it returns the studio to the published design. Concurrent saves use revisions, so a stale editor must reload instead of silently overwriting another administrator's work.

The share-page preview simulates the draft. Its light and dark controls change only the preview, including its secondary text; they do not change your workspace mode or publish the design. Check a real share page after publishing.

Classic colors, the favicon, and custom CSS/head HTML use the instance-settings bar. On phones it says **Unsaved settings**, with **Discard** and **Save** visible side by side even with enlarged text. **Save** is announced as **Save settings**; larger screens show that full label and the changed-section summary. The form can scroll above the bar. The studio keeps its own **Save draft** and **Publish appearance** actions.

On a phone, **Section** and **Appearance section** share one row above the studio when there is room. Enlarged text stacks the controls when they need more width. **Section** changes the Settings area; **Appearance section** chooses **Identity**, **Theme**, **Sharing**, or **Appearance packs**. Selected names wrap instead of being clipped, and both controls stay at least 44px tall. The studio opens directly below them without a repeated section introduction. Its concise **Instance identity**, **Theme and colors**, **Shared pages**, and **Appearance packs** headings keep the controls close to their navigation. Phone headings and navigation use tighter spacing; the pickers keep comfortable side padding, grow taller for wrapped words, and scale their arrows with the text. Their menus stay within the available window and scroll when the full list does not fit, including with enlarged text. On tablets, the selected Settings area and subsection tabs replace a repeated Appearance introduction. On larger screens, choose a subsection tab; touch screens keep larger tap targets. Changing sections keeps your unsaved edits.

<Screenshot src="/screenshots/refinement/appearance-mobile.png" alt="Phone Appearance settings with Section and Appearance section pickers above the Identity controls" caption="The phone navigation keeps Settings areas and appearance destinations together without clipping their names." />

## Identity

| Control            | Effect / limit                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| Instance name      | Your public instance identity, 1–60 characters                                       |
| Tagline            | Short description, up to 180 characters                                              |
| Light / dark logos | Separate images suited to each theme; embedded PNG, JPEG, or WebP, up to 256 KB each |
| Footer text        | Your footer wording, up to 200 characters                                            |

<Screenshot src="/screenshots/customization/appearance-identity.png" alt="Appearance studio identity section with instance name, tagline, and logo fields" caption="Identity controls give the workspace and shared files a recognizable home." />

Logos are embedded into the appearance document, making exported designs portable. SVG and external logo URLs are not accepted for these studio assets. Email branding has its own settings, including an optional external logo URL; publishing an appearance is not an email-template rollout.

Choose **Light logo** or **Dark logo** and select a PNG, JPEG, or WebP image of at most 256 KB. A larger file shows **Please upload a logo of at most 256 KB.** and a file your browser reports as another format **Please upload a PNG, JPEG, or WebP image.**; nothing is uploaded. The server applies the same rules and reads the file's content, so a file that isn't really one of those images is refused with **File content is not a PNG, JPEG, or WebP image.** An image with the wrong extension, such as a PNG named `logo.jpg`, is saved as the format it really is. A refused upload answers as a favicon upload does: `413`, `415` or `400`, with `Invalid form data.` for a body that isn't a form and `Request body is too large.` for one over 320 KB, the image plus room for the form. Earlier versions said **Choose a logo smaller than 256 KB.** or **Only PNG, JPEG, and WebP images are supported.**, accepted any reported type, and refused bodies over 300,000 bytes with **Logos must be smaller than 256 KB.**

## Theme

Enable **Use studio theme** to apply the studio palettes. Leaving it off keeps the original/legacy theme behavior while allowing identity and sharing choices to be saved. With it off, light mode uses Flare's original light palette too; light colors you changed in the studio, including a preset you tried, apply only once the studio theme is on. Earlier builds kept applying a saved studio light palette to light mode after the studio theme was switched off.

Start with **Midnight**, **Orbit**, **Tide**, or **Ember**, then customize the light and dark palettes. A preset sets the primary and focus color for both modes. In dark mode it also sets the page color and gives borders, fields, and secondary text the same hue, so the violet, teal, or warm page doesn't show slate lines. A preset applied before this change keeps its stored colors; choose it again, then **Publish**, to pick up the matching neutrals. Palette fields accept six-digit hex colors. Foreground/background pairs exist for cards, popovers, primary, secondary, muted, accent, and destructive states, alongside page colors, borders, inputs, and focus rings. Preview text, buttons, error states, and keyboard focus when choosing colors. The selected typeface also applies to navigation. Narrow controls can grow vertically to retain complete names with large text, including Monospace.

A few colors are derived from the palette to support readable text and controls:

- **Destructive** fills buttons such as **Delete**. Error messages and destructive menu items use the same hue, lightened in dark mode and darkened in light mode when the color is too dark or too light to read as text. In dark mode a very deep destructive color is also lifted for button fills (to about 55% lightness), so **Delete** reads as a clear red next to the red text instead of a maroon that looks disabled.
- Dark-mode secondary copy and muted icons blend **Muted foreground** toward **Foreground** for more comfortable small-text reading. Light mode uses **Muted foreground** directly. Empty text fields and unselected picker prompts use italic placeholders and a separate, opaque color mixed from **Muted foreground** and **Background**, so examples and instructions differ from entered values. The hint moves toward full **Muted foreground**, then **Foreground**, to reach 7:1 contrast on field, panel, and overlay surfaces when the palette allows it. These roles follow studio and classic colors without rewriting saved values; conflicting custom surface/text colors still need checking in the preview.
- Disabled buttons use the same readable muted labels and recessed neutral fill across primary, destructive, outline, and other variants. Their subtle inset edge replaces the raised active treatment; labels keep full opacity, and unavailable actions remain native disabled controls.
- Panels use **Card** directly in light mode. In dark mode they blend a small amount of **Card foreground** into **Card**, separating content from the page without replacing the configured palette. The glow background is quieter; **Plain** and **Grid** retain their selected behavior. These finish changes apply to existing installations without rewriting saved colors.
- The outlines of text fields, selects, and unchecked switches mix **Input** with **Muted foreground**, so an empty field stays visible. With the default palettes they reach 3:1 against the page.
- Success, warning, danger, and info labels, such as an invite's **Active** status or the audit log's outcomes, use fixed green, amber, red, and blue shades for each mode. They don't change with the palette.

| Control       | Choices                      |
| ------------- | ---------------------------- |
| Default mode  | Follow device, Light, Dark   |
| Background    | Soft glow, Plain, Quiet grid |
| Typeface      | Inter, System, Monospace     |
| Corner radius | 0–1.5 rem                    |

<Screenshot src="/screenshots/customization/appearance-theme.png" alt="Appearance studio theme controls and a live preview" caption="Theme presets are starting points; paired palettes let both modes stay intentional." />

Accounts with `appearance.personal` can separately choose **From instance**, **System**, **Light**, or **Dark** under **Profile → Account → Appearance**, in **Your workspace, your preference**. That preference follows the account in the workspace. Public share pages use the instance appearance rather than the uploader's personal preference.

## Sharing

Choose a default share-page layout:

| Layout       | Useful for                                                              |
| ------------ | ----------------------------------------------------------------------- |
| **Minimal**  | A restrained page that gives the file most of the attention             |
| **Framed**   | A familiar file viewer with a clear surrounding frame                   |
| **Delivery** | A more spacious handoff for a file you want someone to open or download |

<Screenshot src="/screenshots/customization/share-delivery.png" alt="A real Flare public share page using the Delivery layout" caption="The Delivery layout gives a shared file a spacious presentation." />

Toggle uploader attribution, filename, and size. Set the footer to inherit the instance credit setting, always show, or always hide. The choice covers share pages, shared folders, file password pages, and the page visitors see for a missing, expired, or private link. The preview follows it too, using the saved **Show credits footer** setting from **General**; earlier versions previewed an inherited footer even when that setting was off. For images, **Show the whole image** uses contain; **Fill the frame** uses cover and may crop its displayed edges. The downloaded file is unchanged.

Upload profiles can select a share style for new files. A file with no stored style inherits the current instance default, so changing the default can change how those older files appear too.

### Social preview text

Set a title and description template, or leave them empty for automatic text. Each allows up to 500 characters and these placeholders:

| Placeholder        | Inserts             |
| ------------------ | ------------------- |
| `{{instanceName}}` | Instance name       |
| `{{filename}}`     | Displayed filename  |
| `{{size}}`         | Formatted file size |
| `{{uploader}}`     | Uploader name       |

For example:

```text
Title: {{filename}} · {{instanceName}}
Description: Shared by {{uploader}} · {{size}}
```

Hidden details are omitted from generated social text as well. These are presentation controls: original filenames can still appear in existing URLs or downloaded files. Visibility and passwords determine access. Social platforms may cache a previous preview after you change it.

## Appearance packs

Packs are versioned JSON documents you can use to back up a design or share it with another instance. Under **Appearance packs**, choose **Export appearance** to download the design currently being previewed. The file is named after the instance name in lowercase, with characters other than letters, digits, and hyphens replaced by hyphens, such as `flare-appearance.json`. It includes identity, embedded logos, paired palettes, surfaces, typography, and sharing choices.

Import a supported `flare.appearance` version 1 pack of at most **1 MB**. Importing creates a saved draft. Review it in both modes and publish explicitly; importing alone does not replace the live design.

Packs do not include accounts, uploaded files, storage credentials, custom CSS/head HTML, or other executable code. They are design exports, not complete configuration or instance backups. The separately configured favicon is not a studio logo or part of the appearance pack.

<Screenshot src="/screenshots/customization/appearance-packs.png" alt="Appearance pack import and export controls" caption="A portable pack transfers the design while keeping instance data separate." />

## Legacy colors and favicon

Existing installations retain their explicit color overrides. The Appearance section keeps the original theme controls alongside the studio, so you can continue using the classic look. A partial or empty legacy palette falls back to original Flare colors.

Open **Classic color controls**, then **Advanced color options**, to set individual colors. They apply while **Use studio theme** is off. Each color is an HSL value such as `222.2 84% 4.9%` (hue 0 to 360, saturation and lightness 0 to 100) or a hex color such as `#1e293b`. The color picker and hex values are saved in HSL form: a hex value stays as you type it, and the field shows the saved HSL value once you leave it. A value that is neither shows a message under the field when you leave it and is not saved. It stays in the field until you correct it or choose **Discard**, and **Save settings** keeps the last valid color. The classic theme mode is `dark`, `light`, or `system`.

<Screenshot src="/screenshots/customization/appearance-classic-colors.png" alt="Classic color controls with the Primary field set to red and a message saying classic colors must be HSL values or hex colors and that the value isn't saved" caption="An invalid classic color is flagged in place and never reaches the page." />

These colors are written into every page, including the sign-in page, so Flare accepts only color values here. Someone with `appearance.manage` can change the palette but cannot add CSS or scripts through it. Earlier builds accepted any text for these colors and for the theme mode, which let a delegated appearance manager add styles or scripts to every page. After upgrading:

- Saved colors that are not valid HSL or hex values, and an unrecognized theme mode, are ignored when pages render. Flare uses the original colors and `dark` in their place, and drops the invalid values the next time any settings are saved.
- Colors chosen with the picker in earlier builds were saved as hex, which the theme could not use, so the affected elements lost their color; a primary button could turn transparent. They now display as the colors that were picked. Review **Classic color controls** if your palette changes unexpectedly.
- If you delegated `appearance.manage` to people you don't fully trust, filter [Audit log](/admin/audit) to the `settings` category and review events whose `settingsKeys` include `settings.appearance`, then check the classic colors.

Under **Favicon**, choose **Upload favicon** and select a **PNG up to 1 MB**, then choose **Save settings** to apply it. The server applies the same limits and also checks the file's content, so an image that isn't really a PNG, such as a JPEG renamed to `.png`, is refused: **Settings could not be saved** appears with _File content is not a PNG image._ and the current favicon stays. After a successful save, **Current favicon** shows the new icon.

Flare accepts the upload only from its own pages, as a `multipart/form-data` request with the image in its `file` field: a request from another origin answers `403`, any other content type `415`, and a body that isn't the form its content type names `400` with `Invalid form data.` Earlier versions checked neither and answered a body that wasn't a multipart form with `500`.

Each upload gets its own address, `/api/favicon?v=` followed by a hash of the image. Browsers may cache that address for a year because its content never changes, and they load a replaced favicon from its new address on the next page view. Earlier versions served every favicon from `/api/favicon` with the same one-year caching, so a replaced favicon could stay stale for up to a year in returning visitors' browsers and in the **Current favicon** preview. A favicon uploaded with an earlier version keeps working but isn't cached long-term until you upload it again. Without an uploaded favicon, pages link only Flare's own icon and `/api/favicon` answers `404`.

The favicon is stored through the active storage provider as `uploads/favicon.png`, so it belongs in file backups as well as the database configuration.

## Custom CSS and head HTML

With the **Administrator** permission, open **Settings → Appearance → Custom CSS and HTML** for the advanced editors. The delegated `appearance.manage` permission covers the studio, branding, and favicon; it does not authorize custom CSS/head HTML. They are saved separately from studio drafts and are not included in appearance packs: a dot beside **Custom CSS** or **Custom HTML** marks an edit that isn't saved yet, and **Save settings** in the bar at the bottom of the screen applies it. Custom CSS is applied to the live app; custom head content is inserted into the page as administrator-provided HTML.

Flare marks every declaration of your style rules `!important`, including those inside `@media`, `@supports`, `@container`, and `@layer` blocks, so they win over Flare's own styles whatever their selectors. Everything else arrives as you wrote it: strings, comments, `url()` values, `@import` and `@font-face` rules, and `@keyframes`. Flare's interface font stays in place, and a `font-family` rule changes only the elements it selects; set it on `body` to change the interface text. While your CSS contains `font-family` anywhere, the rest of the interface uses the studio theme's **Typeface**, or Inter while **Use studio theme** is off. Earlier versions split declarations at every `;`, which broke data URLs such as `url(data:image/png;base64,…)`, font imports such as `wght@400;700`, and quoted values containing `;`. They also marked declarations inside `@font-face` and `@keyframes`, where browsers ignore marked declarations, and dropped Inter whenever the CSS mentioned `font-family`, so even `code { font-family: monospace }` switched the rest of the interface to the browser's default font.

Head HTML goes into the page head, before the custom CSS, as its own elements: `base`, `link`, `meta`, `noscript`, `script`, `style`, `template`, and `title`. Anything else, such as text or a `div`, would end the head, so Flare leaves it out; head elements inside it are kept. An `iframe`, `math`, `noembed`, `noframes`, `svg`, `textarea`, or `xmp` element is left out with everything inside it, because what it holds isn't the page's own head content: a `script` in an `iframe` or a `title` in an `svg` doesn't reach the head. Inline event handlers such as `onload` and `style` attributes are left out too; put scripts in a `script` element. Earlier versions wrapped the HTML in a `div`, which made browsers move it into the page body, where services that read `meta` tags, such as site verification, don't look for them.

Use these controls for an intentional site-wide change and test the login, dashboard, share, and mobile layouts after saving. Prefer studio fields for colors and identity when they provide the behavior you need. CSS selectors tied to internal components may need adjustment after upgrades. Treat head HTML as code with access to your site's browser context; only add content you understand and control.

Saving custom CSS removes blank space before and after it and keeps at most one empty line in a row, whether you save it from **Settings** or through the older whole-settings form. Earlier versions tidied it only from the older form, so CSS saved from **Settings** kept every blank line.

## Recover an unusable appearance

Sign in as an administrator and open:

```text
/dashboard/settings?section=appearance&recovery=1
```

This view uses the original Flare theme and suppresses custom CSS/head HTML for the recovery page without changing the saved settings. Restore the previous studio appearance there. With the **Administrator** permission, repair custom styles at the address below. **Custom CSS and HTML** appears only with that permission, so for a delegated designer the studio's recovery notice and its **Identity** section don't link to it; ask an administrator to repair custom styles.

```text
/dashboard/settings?section=appearance&recovery=1#advanced-styles
```

<Screenshot src="/screenshots/customization/appearance-recovery.png" alt="Appearance recovery screen using the original Flare design" caption="Recovery gives an authenticated administrator a clean place to repair the design." />

Return to the normal Appearance page to verify the live result. Recovery is limited to authorized Settings views; it does not disable authentication, change file access, or activate on public pages. It helps when appearance is broken and you can authenticate; it is not a password-reset mechanism.

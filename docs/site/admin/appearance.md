---
description: Brand Flare with the appearance studio, paired palettes, share layouts, portable packs, custom styles, and a recovery path.
---

# Make Flare yours

Publishing and managing instance appearance requires `appearance.manage`; Administrator includes it. Personal theme preference uses the separate `appearance.personal` permission. Delegate design with a role containing `settings.read` and `appearance.manage`; it need not grant account, email, or storage administration.

Open **Settings → Appearance** to design the instance's identity and public share experience. Start with a preset, preview the result, then publish when it feels right. A separate draft lets you work without changing the site everyone is using.

## A draft-to-publish workflow

1. Edit Identity, Theme, Sharing, or Embeds. The preview follows your working design. On a phone, the section tabs stay on one row; swipe it sideways to reach **Appearance packs**.
2. Check light and dark modes, image and code examples, and a protected-file example.
3. Choose **Save draft** to keep the design for later, or **Publish appearance** to make it live.
4. Open a real share page and the dashboard on desktop and mobile.
5. If you need to go back, choose **Restore previous**.

These actions are in the bar under the studio, which also shows whether you have unsaved changes, a saved draft, or the published design. Flare keeps a saved draft, the published design, and the previous published design. This is a one-step restore, not an unlimited history. **Discard** removes the draft without changing the published appearance; with unsaved edits and no draft, it returns the studio to the published design. Concurrent saves use revisions, so a stale editor must reload instead of silently overwriting another administrator's work.

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

Start with **Midnight**, **Orbit**, **Tide**, or **Ember**, then customize the light and dark palettes. Midnight uses the default dark palette: a deeper navy page, panels and dialogs a step above it at about their original depth, dialogs and menus one soft step above panels, separate hover and selection fills, and soft slate borders. Choose Midnight again and publish to adopt these defaults in an already saved studio palette. A preset sets the primary and focus color for both modes. In dark mode it also sets the page color and gives borders, fields, and secondary text the same hue, so the violet, teal, or warm page doesn't show slate lines. A preset applied before this change keeps its stored colors; choose it again, then **Publish**, to pick up the matching neutrals. Palette fields accept six-digit hex colors. Foreground/background pairs exist for cards, popovers, primary, secondary, muted, accent, and destructive states, alongside page colors, borders, inputs, and focus rings. Preview text, buttons, error states, and keyboard focus when choosing colors.

A few colors are derived from the palette so they stay readable whatever it holds:

- **Destructive** fills buttons such as **Delete**. Error messages and destructive menu items use the same hue, lightened in dark mode and darkened in light mode when the color is too dark or too light to read as text. In dark mode a very deep destructive color is also lifted for button fills (to about 55% lightness), so **Delete** reads as a clear red next to the red text instead of a maroon that looks disabled.
- Panels use **Card** directly in light mode. In dark mode they blend a small amount of **Card foreground** into **Card**, separating content from the page without replacing the configured palette. The glow background is quieter, and in dark mode its lightest layer is reduced further so a near-white **Primary** doesn't haze the page up to the panels' level; **Plain** and **Grid** retain their selected behavior. These finish changes apply to existing installations without rewriting saved colors.
- Dialogs, menus, popovers, and sheets use **Popover**. In dark mode they blend a little more **Foreground** into it than panels do, so an open menu sits one step above the panel behind it, and in dark mode they cast a deeper shadow. Separators inside dark menus and selects use **Border**. Hovered menu items and buttons use **Accent**, and the selected tab uses **Secondary**: if you customize these, keep **Secondary** at least as light as **Accent** in dark mode so a hovered tab doesn't look more selected than the active one. The default dark palette makes **Secondary** one step lighter than **Accent**.
- The outlines of text fields, selects, and unchecked switches mix **Input** with **Muted foreground**, so an empty field stays visible. With the default palettes they reach 3:1 against the page.
- Success, warning, danger, and info labels, such as an invite's **Active** status or the audit log's outcomes, use fixed green, amber, red, and blue shades for each mode. They don't change with the palette.

| Control       | Choices             |
| ------------- | ------------------- |
| Default mode  | System, Light, Dark |
| Background    | Glow, Plain, Grid   |
| Typeface      | Inter, System, Mono |
| Corner radius | 0–1.5               |

### Reset to Flare's theme

To start over, choose **Reset to Flare defaults** at the bottom of the **Theme** section, then **Reset theme** to confirm. Choose **Cancel** to leave everything as it is. The reset publishes immediately, without **Publish appearance**:

- The studio theme returns to Flare's defaults: **Use studio theme** off, **Dark** default mode, **Inter**, **Soft glow**, a corner radius of 0.75, and the default light and dark palettes.
- The classic colors return to their defaults and the classic theme mode to `dark`, so the instance looks like a fresh Flare installation.
- Identity, logos, sharing choices, the favicon, and custom CSS/head HTML are unchanged. A saved draft keeps its identity and sharing edits with the default theme, and unsaved identity or sharing edits stay in the studio for you to save or publish.

**Restore previous** brings back the studio theme you had before the reset. Customized classic colors are not kept, so note them first if you might want them again. If another administrator changed the appearance since you opened the page, the reset is refused with a message to reload, and nothing changes. The button waits while **Save settings** is saving, and **Save settings** and **Discard** wait while a reset is in progress, so one can't put back what the other changed.

<Screenshot src="/screenshots/customization/appearance-theme.png" alt="Appearance studio theme controls and a live preview" caption="Theme presets are starting points; paired palettes let both modes stay intentional." />

Every account can separately choose **Inherit**, **System**, **Light**, or **Dark** under **Profile → Account → Workspace appearance**. That preference follows the account in the workspace. Public share pages use the instance appearance rather than the uploader's personal preference.

## Sharing

Choose a default share-page layout:

| Layout       | What visitors see                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| **Minimal**  | The file's header and preview set on the page itself, without a card, so the file gets the attention |
| **Framed**   | The file in a card in the middle of the page, with the uploader in the page header                   |
| **Delivery** | A card across the full page width that opens with **A file for you** and names the uploader inside   |

Every layout shows the file's name, type, and size with its actions above the preview, as [the sharing guide describes](../guide/sharing#what-a-share-page-shows). The layout changes the framing around them.

<Screenshot src="/screenshots/customization/share-delivery.png" alt="A real Flare public share page using the Delivery layout" caption="The Delivery layout gives a shared file a spacious presentation." />

Toggle uploader attribution, filename, size, and expiration. With the filename off, a share page is titled by the file's type, such as **PNG image**, which is always shown. **Show expiration** controls the **Expires in …** notice on a file with a [scheduled expiration](../guide/sharing#give-a-file-a-lifetime); it is on by default, including for appearances and packs saved before the setting existed, because the notice tells a recipient how long the link will keep working. Turn it off if expirations on your instance are not the recipient's business. Set the footer to inherit the instance credit setting, always show, or always hide. The choice covers share pages, shared folders, file password pages, and the page visitors see for a missing, expired, or private link. The preview follows it too, using the saved **Show credits footer** setting from **General**; earlier versions previewed an inherited footer even when that setting was off. For images, **Show the whole image** uses contain; **Fill the frame** uses cover and may crop its displayed edges. The downloaded file is unchanged.

Upload profiles can select a share style for new files. A file with no stored style inherits the current instance default, so changing the default can change how those older files appear too.

The details you hide here stay out of every [embed](#embeds) too, whoever wrote its card. These are presentation controls: original filenames can still appear in existing URLs or downloaded files. Visibility and passwords determine access.

## Embeds

**Embeds** decides what chat apps and social networks show when someone pastes a link to a file. [Embeds and link previews](/guide/embeds) describes the result for each kind of file and app; this section covers the instance's side.

| Control                           | Initial value              | Effect                                                                                                                               |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Direct media** / **Rich embed** | Direct media               | Whether images and videos appear on their own where an app can show them that way, or every link shows the card                      |
| **Site name**                     | `{{instanceName}}`         | The small line above the title, up to 100 characters                                                                                 |
| **Author**                        | Empty                      | A line apps read through oEmbed, up to 100 characters                                                                                |
| **Title**                         | `{{filename}} ({{size}})`  | Up to 500 characters. An empty title shows the file's name.                                                                          |
| **Description**                   | `Uploaded by {{uploader}}` | Up to 500 characters, on one or more lines                                                                                           |
| **Accent color**                  | None                       | The colored edge of the card in Discord                                                                                              |
| **Let people design their own**   | On                         | Accounts with `files.share` can choose their own mode and card under **Profile → Embeds**. Off, every link uses this embed, at once. |

Every line takes the [placeholders](/guide/embeds#placeholders) `{{filename}}`, `{{size}}`, `{{type}}`, `{{uploader}}`, `{{date}}`, `{{views}}`, and `{{instanceName}}`, and an empty line is left off the card. The preview beside the fields draws the card for a sample image, video, and file as you type.

<Screenshot src="/screenshots/embeds/studio-embeds.webp" alt="Appearance studio, Embeds section: Direct media and Rich embed options, the card's site name, author, title and description fields with placeholder buttons, an accent color, the Let people design their own switch, and a preview of the embed" caption="The instance's embed is part of the draft, with a preview that follows each change." />

The mode and card are part of the draft, so they go live when you publish and return with **Restore previous**. Turning **Let people design their own** off does not delete what accounts saved: their choices apply again when you turn it back on. Apps keep previews they already made, so a published change shows on links pasted from then on.

A person's own card can say anything the placeholders and their wording allow, including a site name other than this instance's. If that is unwelcome on your instance, turn personal embeds off. To stop one account's card and leave the rest, remove `files.share` from that account: Flare reads the owner's roles each time a preview is fetched, so its links return to the instance's embed at once. The same permission lets the account change visibility and passwords, so it loses those too.

`{{type}}`, `{{date}}`, and `{{views}}` have no switch like **Show filename**. A file's type, upload date, and view count appear in an embed only where this card or an account's own card names them.

### Upgrading from social preview text

Earlier versions had two fields under **Sharing**, **Social preview title** and **Social preview description**, and left them empty to mean Flare's own wording. They are now the card's **Title** and **Description**:

- Text you wrote is kept as it is.
- An empty title becomes `{{filename}} ({{size}})`, which reads as before.
- An empty description becomes `Uploaded by {{uploader}}`. Earlier versions wrote `name - size, uploaded by …` for files that aren't media, repeating the title, and fell back to the instance tagline when uploader names were hidden. Those previews now show `Uploaded by …`, or no description when uploader names are hidden. WhatsApp and Signal, which show nothing without a description, still get the tagline then.
- Nothing is rewritten in the database until any setting or appearance is next saved, which stores the whole configuration with these values. Until then Flare reads the saved appearance this way each time.

Earlier versions also showed this text mostly to apps Flare didn't recognize, because recognized ones were sent the file's bytes instead. It now reaches every app that draws a card.

## Appearance packs

Packs are versioned JSON documents you can use to back up a design or share it with another instance. Under **Appearance packs**, choose **Export appearance** to download the design currently being previewed. The file is named after the instance name in lowercase, with characters other than letters, digits, and hyphens replaced by hyphens, such as `flare-appearance.json`. It includes identity, embedded logos, paired palettes, surfaces, typography, sharing choices, and the instance's embed.

Import a supported `flare.appearance` version 1 pack of at most **1 MB**. A pack exported before embeds had their own settings imports with the default embed, keeping any social preview text it had. A pack exported by this version names the embed settings, which earlier versions of Flare refuse as unsupported. Importing creates a saved draft. Review it in both modes and publish explicitly; importing alone does not replace the live design.

Packs do not include accounts, uploaded files, storage credentials, custom CSS/head HTML, or other executable code. They are design exports, not complete configuration or instance backups. The separately configured favicon is not a studio logo or part of the appearance pack.

<Screenshot src="/screenshots/customization/appearance-packs.png" alt="Appearance pack import and export controls" caption="A portable pack transfers the design while keeping instance data separate." />

## Legacy colors and favicon

Existing installations retain their explicit color overrides. The Appearance section keeps the original theme controls alongside the studio, so you can continue using the classic look. A partial or empty legacy palette fills missing colors from the current defaults. A complete untouched earlier default (the original classic palette, or the lighter palette that replaced it for a short time) upgrades automatically, including the values shown in the controls; customized palettes keep their saved colors. **Reset to default** in the classic color controls restores the current defaults.

Open **Classic color controls**, then **Advanced color options**, to set individual colors. They apply while **Use studio theme** is off. Each color is an HSL value such as `222.2 84% 4.9%` (hue 0 to 360, saturation and lightness 0 to 100) or a hex color such as `#1e293b`. The color picker and hex values are saved in HSL form: a hex value stays as you type it, and the field shows the saved HSL value once you leave it. A value that is neither shows a message under the field when you leave it and is not saved. It stays in the field until you correct it or choose **Discard**, and **Save settings** keeps the last valid color. The classic theme mode is `dark`, `light`, or `system`.

<Screenshot src="/screenshots/customization/appearance-classic-colors.png" alt="Classic color controls with the Primary field set to red and a message saying classic colors must be HSL values or hex colors and that the value isn't saved" caption="An invalid classic color is flagged in place and never reaches the page." />

These colors are written into every page, including the sign-in page, so Flare accepts only color values here. Someone with `appearance.manage` can change the palette but cannot add CSS or scripts through it. Earlier builds accepted any text for these colors and for the theme mode, which let a delegated appearance manager add styles or scripts to every page. After upgrading:

- Saved colors that are not valid HSL or hex values, and an unrecognized theme mode, are ignored when pages render. Flare uses the original colors and `dark` in their place, and drops the invalid values the next time any settings are saved.
- Colors chosen with the picker in earlier builds were saved as hex, which the theme could not use, so the affected elements lost their color; a primary button could turn transparent. They now display as the colors that were picked. Review **Classic color controls** if your palette changes unexpectedly.
- If you delegated `appearance.manage` to people you don't fully trust, filter [Audit log](/admin/audit) to the `settings` category and review events whose `settingsKeys` include `settings.appearance`, then check the classic colors.

Under **Favicon**, choose **Upload favicon** and select a **PNG up to 1 MB**, then choose **Save settings** to apply it. The server applies the same limits and also checks the file's content, so an image that isn't really a PNG, such as a JPEG renamed to `.png`, is refused: **Settings could not be saved** appears with _File content is not a PNG image._ and the current favicon stays. After a successful save, **Current favicon** shows the new icon.

Flare accepts the upload only from its own pages, as a `multipart/form-data` request with the image in its `file` field: a request from another origin answers `403`, any other content type `415`, and a body that isn't the form its content type names `400` with `Invalid form data.` Earlier versions checked neither and answered a body that wasn't a multipart form with `500`.

<Screenshot src="/screenshots/customization/appearance-favicon.png" alt="The Favicon card in Settings, Appearance, showing the current custom favicon with a Remove button above the Upload favicon drop zone" caption="The current favicon, with Remove to go back to Flare's icon." />

To go back to Flare's own icon, choose **Remove** beside the favicon, then **Save settings**. The row then shows **Flare icon (unsaved)** until you save, and **Discard** keeps the current favicon. Saving stops pages linking the custom icon and queues its image for deletion from storage. Removal succeeds even while storage is unreachable; the image is deleted once storage answers again. When one administrator removes the favicon while another uploads one, whichever is saved last wins, and a saved upload always keeps its image. Earlier versions had no way to remove a favicon; only a new upload replaced it.

Pages link only one icon: the custom favicon when there is one, otherwise Flare's icon. Earlier versions linked both, and browsers chose between them differently, so a custom favicon showed in some browsers and Flare's icon in others. If a browser still shows the old icon after an upgrade, reload the page; some browsers keep a tab icon until the page is loaded again. Pages that link no icon, such as an image or PDF opened on its own, get the custom favicon from `/favicon.ico`.

Each upload gets its own address, `/api/favicon?v=` followed by a new random version. Browsers may cache that address for a year because its content never changes, and they load a replaced favicon from its new address on the next page view. Earlier versions served every favicon from `/api/favicon` with the same one-year caching, so a replaced favicon could stay stale for up to a year in returning visitors' browsers and in the **Current favicon** preview. A favicon uploaded with an earlier version keeps working but isn't cached long-term until you upload it again. Without an uploaded favicon, pages link only Flare's own icon and `/api/favicon` and `/favicon.ico` answer `404`. Flare serves the image itself with every storage provider. Earlier versions redirected S3 storage to a signed bucket URL, so the icon failed to load wherever browsers couldn't reach the bucket address and was never cached long-term.

The favicon is stored through the active storage provider as `uploads/favicons/<version>.png` (S3 key `favicons/<version>.png`), so it belongs in file backups as well as the database configuration. Each upload writes a new object and queues the one it replaced for Flare's [storage cleanup](/hosting/maintenance#inspect-pending-cleanup), which deletes it within seconds and retries while storage refuses; those jobs have the owner ID `instance`. Earlier versions kept every favicon in `uploads/favicon.png`; Flare keeps serving it until the next upload or removal, which queues it for deletion.

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

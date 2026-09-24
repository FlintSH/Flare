---
description: Brand Flare with the appearance studio, paired palettes, share layouts, portable packs, custom styles, and a recovery path.
---

# Make Flare yours

Open **Settings → Appearance** to design the instance's identity and public share experience. Start with a preset, preview the result, then publish when it feels right. A separate draft lets you work without changing the site everyone is using.

## A draft-to-publish workflow

1. Edit Identity, Theme, or Sharing. The preview follows your working design.
2. Check light and dark modes, image and code examples, and a protected-file example.
3. Choose **Save draft** to keep the design for later, or **Publish appearance** to make it live.
4. Open a real share page and the dashboard on desktop and mobile.
5. If you need to go back, choose **Restore previous**.

Flare keeps a saved draft, the published design, and the previous published design. This is a one-step restore, not an unlimited history. **Discard draft** removes the draft without changing the published appearance. Concurrent saves use revisions, so a stale editor must reload instead of silently overwriting another administrator's work.

## Identity

| Control            | Effect / limit                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| Instance name      | Your public instance identity, 1–60 characters                                       |
| Tagline            | Short description, up to 180 characters                                              |
| Light / dark logos | Separate images suited to each theme; embedded PNG, JPEG, or WebP, up to 256 KB each |
| Footer text        | Your footer wording, up to 200 characters                                            |

<Screenshot src="/screenshots/customization/appearance-identity.png" alt="Appearance studio identity section with instance name, tagline, and logo fields" caption="Identity controls give the workspace and shared files a recognizable home." />

Logos are embedded into the appearance document, making exported designs portable. SVG and external logo URLs are not accepted for these studio assets. Email branding has its own settings, including an optional external logo URL; publishing an appearance is not an email-template rollout.

## Theme

Enable **Use studio theme** to apply the studio palettes. Leaving it off keeps the original/legacy theme behavior while allowing identity and sharing choices to be saved.

Start with **Midnight**, **Orbit**, **Tide**, or **Ember**, then customize the light and dark palettes. Palette fields accept six-digit hex colors. Foreground/background pairs exist for cards, popovers, primary, secondary, muted, accent, and destructive states, alongside page colors, borders, inputs, and focus rings. Preview text, buttons, error states, and keyboard focus when choosing colors.

| Control       | Choices             |
| ------------- | ------------------- |
| Default mode  | System, Light, Dark |
| Background    | Glow, Plain, Grid   |
| Typeface      | Inter, System, Mono |
| Corner radius | 0–1.5               |

<Screenshot src="/screenshots/customization/appearance-theme.png" alt="Appearance studio theme controls and a live preview" caption="Theme presets are starting points; paired palettes let both modes stay intentional." />

Every account can separately choose **Inherit**, **System**, **Light**, or **Dark** under **Profile → Account → Workspace appearance**. That preference follows the account in the workspace. Public share pages use the instance appearance rather than the uploader's personal preference.

## Sharing

Choose a default share-page layout:

| Layout       | Useful for                                                              |
| ------------ | ----------------------------------------------------------------------- |
| **Minimal**  | A restrained page that gives the file most of the attention             |
| **Framed**   | A familiar file viewer with a clear surrounding frame                   |
| **Delivery** | A more spacious handoff for a file you want someone to open or download |

<Screenshot src="/screenshots/customization/share-delivery.png" alt="A real Flare public share page using the Delivery layout" caption="The Delivery layout gives a shared file a spacious presentation." />

Toggle uploader attribution, filename, and size. Set the footer to inherit the instance credit setting, always show, or always hide. For images, **Show the whole image** uses contain; **Fill the frame** uses cover and may crop its displayed edges. The downloaded file is unchanged.

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

Packs are versioned JSON documents you can use to back up a design or share it with another instance. Under **Appearance packs**, export the design currently being previewed. The file includes identity, embedded logos, paired palettes, surfaces, typography, and sharing choices.

Import a supported `flare.appearance` version 1 pack of at most **1 MB**. Importing creates a saved draft. Review it in both modes and publish explicitly; importing alone does not replace the live design.

Packs do not include accounts, uploaded files, storage credentials, custom CSS/head HTML, or other executable code. They are design exports, not complete configuration or instance backups. The separately configured favicon is not a studio logo or part of the appearance pack.

<Screenshot src="/screenshots/customization/appearance-packs.png" alt="Appearance pack import and export controls" caption="A portable pack transfers the design while keeping instance data separate." />

## Legacy colors and favicon

Existing installations retain their explicit color overrides. The Appearance section keeps the original theme controls alongside the studio, so you can continue using the classic look. A partial or empty legacy palette falls back to original Flare colors.

The favicon control accepts a **PNG up to 1 MB** in the dashboard. Save your changes to apply the pending favicon. It is stored through the active storage provider, so it belongs in file backups as well as the database configuration.

## Custom CSS and head HTML

Open **Settings → Appearance → Custom CSS and HTML** for the advanced editors. They are saved separately from studio drafts and are not included in appearance packs. Custom CSS is applied to the live app; custom head content is inserted into the page as administrator-provided HTML.

Use these controls for an intentional site-wide change and test the login, dashboard, share, and mobile layouts after saving. Prefer studio fields for colors and identity when they provide the behavior you need. CSS selectors tied to internal components may need adjustment after upgrades. Treat head HTML as code with access to your site's browser context; only add content you understand and control.

## Recover an unusable appearance

Sign in as an administrator and open:

```text
/dashboard/settings?section=appearance&recovery=1
```

This view uses the original Flare theme and suppresses custom CSS/head HTML for the recovery page without changing the saved settings. Restore the previous studio appearance or repair custom styles at:

```text
/dashboard/settings?section=appearance&recovery=1#advanced-styles
```

<Screenshot src="/screenshots/customization/appearance-recovery.png" alt="Appearance recovery screen using the original Flare design" caption="Recovery gives an authenticated administrator a clean place to repair the design." />

Return to the normal Appearance page to verify the live result. Recovery is limited to authorized Settings views; it does not disable authentication, change file access, or activate on public pages. It helps when appearance is broken and you can authenticate; it is not a password-reset mechanism.

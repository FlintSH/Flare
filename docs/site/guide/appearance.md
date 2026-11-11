---
title: Make your workspace comfortable
description: Choose a personal light, dark, or system theme and understand how instance branding and share-page styles fit together.
---

# Make your workspace comfortable

Changing personal appearance requires `appearance.personal`. Instance branding is a separate permission, `appearance.manage`, which can be delegated through [roles](/admin/roles) without giving full Administrator access.

Every account can choose how the signed-in workspace looks. Administrators can also change the instance's identity, colors, typography, surfaces, and public share pages. Those are separate settings with different scopes.

<Screenshot src="/screenshots/preferences-grouping/profile-account-desktop.png" alt="Account settings with personal workspace theme choices below identity and password controls" caption="Your personal workspace theme lives in Profile → Account and follows your account across devices." />

## Choose your workspace theme

1. Open **Profile → Account**. On a phone, choose **Account** from the **Section** selector.
2. Choose the **Appearance** shortcut to reach **Your workspace, your preference**.
3. Choose a mode.
4. Select **Save preference**. It becomes available once you choose a mode other than your saved one.

| Mode              | What happens                                                  |
| ----------------- | ------------------------------------------------------------- |
| **From instance** | Use the operator's selected theme behavior.                   |
| **System**        | Follow the light/dark preference on the device you are using. |
| **Light**         | Keep your dashboard in light mode.                            |
| **Dark**          | Keep your dashboard in dark mode.                             |

The preference is stored with your account, so it follows you when you sign in on another device. With System selected, two devices can show different modes if their operating-system preferences differ.

Your personal setting changes the dashboard. Public share pages retain the instance's brand and public appearance behavior.

## Default dark-mode contrast

The default dark theme keeps Flare's navy palette but separates its layers: the page is the darkest navy, cards and panels sit one step lighter, and dialogs and menus one step above that, so each layer reads clearly without turning grey or bright. Borders, field outlines and secondary text are clearer, and hovered items have their own fill on panels and in menus. Menus keep a visible line between groups of options, and the folder lists in the **Move to folder** dialog and the archive destination picker highlight the folder under your pointer while the selected folder keeps its own highlight. Notices and progress tracks inside dialogs, such as the shared-folder note when deleting a folder and the confidence bar in **Extracted text**, keep a visible fill. These changes apply across the workspace and public pages that use the default palette.

Existing installations using the complete original classic palette receive these colors automatically when pages reload. Empty classic palettes use the new defaults too. A customized classic palette or a published studio palette keeps its saved colors. Administrators can adjust those colors in [instance appearance](../admin/appearance); personal mode preferences continue to choose light or dark within the instance's palette.

<Screenshot src="/screenshots/dark-contrast/library-desktop.webp" alt="Default dark-mode file library: navy panels and file cards a step lighter than the deep navy page, with outlined search and filter controls" caption="The default dark palette separates panels and controls from the page without changing the layout." />

<Screenshot src="/screenshots/dark-contrast/folder-mobile.webp" alt="New folder dialog on a phone: a dark navy surface a step above the dimmed library, with a readable description and an outlined folder-name field" caption="Dialogs sit one step above the page in the same navy, with a visible keyboard focus ring." />

## What your administrator controls

The instance may have its own name, tagline, light/dark logos, and footer, as well as custom colors, typeface, background, and corner radius. These choices appear across the workspace and public pages.

Administrators use an appearance studio with drafts, previews, publishing, restore, and exportable appearance packs. If you operate the instance, continue with the [appearance administration guide](../admin/appearance).

A personal mode choice does not select a completely separate color palette or override the instance logo. The administrator's light and dark designs still provide the appearance within your selected mode.

## Pick the style of new share pages

An [upload profile](./upload-profiles) can set the share-page style for its new uploads:

- **Minimal:** emphasize the uploaded content.
- **Framed:** show the content within a more structured share page.
- **Delivery:** give the handoff and file actions a prominent role.
- **Inherit:** use the instance's starting style when the upload's settings are resolved.

<Screenshot src="/screenshots/customization/share-framed.png" alt="Framed share-page layout" caption="Framed is one of three presentation choices available for sharing files." />

<Screenshot src="/screenshots/customization/share-delivery.png" alt="Delivery share-page layout with prominent file actions" caption="Delivery gives a file handoff its own presentation." />

Changing a profile applies to future uploads; it does not redesign every existing file. A file with a stored share style keeps that style. Files without a stored style inherit the instance's default.

## Presentation and access are independent

The administrator can choose whether share pages show uploader attribution, filename, file size, and a footer. They can also set image fit and social-preview text.

These choices affect what a page presents. Hiding a name does not remove it from an existing URL or the downloaded file. A Minimal page can be private, and a Delivery page can be public: choose [visibility and passwords](./sharing) separately.

## If the appearance is unexpected

First check your selected personal mode and whether you saved it. If System is selected, check the device's own appearance setting. If public pages look different from your dashboard, that can be expected: public pages use instance appearance.

For problems caused by instance customization, contact the administrator. An administrator can open the appearance recovery page to repair custom styling and restore a usable design; see [appearance administration](../admin/appearance).

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

The default dark theme keeps Flare's deep navy and slate look. It separates the layers by making the page darker rather than making surfaces lighter: the page is the deepest navy, cards and panels sit a step above it at about their original depth, and dialogs and menus sit one soft step above those with a deeper shadow. The soft glow behind the page is fainter in dark mode, so it no longer lightens the page next to panels. Borders and field outlines stay a soft slate, and secondary text is slightly brighter. Tabs use separate fills for the tab under your pointer and the selected tab, and the selected section in **Profile** and **Settings** is filled like a panel. Menus keep a visible line between groups of options, and the folder lists in the **Move to folder** dialog and the archive destination picker highlight the folder under your pointer while the selected folder keeps its own, slightly lighter highlight and a heavier label. Notices and progress tracks inside dialogs, such as the shared-folder note when deleting a folder and the confidence bar in **Extracted text**, keep a visible fill. These changes apply across the workspace and public pages that use the default palette.

Existing installations using a complete, untouched earlier default (the original palette, or the lighter palette that replaced it for a short time) receive these colors automatically when pages reload. This covers both the classic palette and a studio theme whose dark palette was left at the default or set with the **Midnight** preset, including saved drafts, the version **Restore previous** returns to, and imported appearance packs. Empty classic palettes use the new defaults too. A palette with any color changed, including only the focus ring, keeps its saved colors, as do the other presets. Administrators can adjust those colors in [instance appearance](../admin/appearance); personal mode preferences continue to choose light or dark within the instance's palette.

<Screenshot src="/screenshots/dark-contrast/library-desktop.webp" alt="Default dark-mode file library: deep navy panels and file cards on a darker page, with soft slate borders and outlined search and filter controls" caption="The default dark palette separates panels from a darker page and keeps surfaces deep." />

<Screenshot src="/screenshots/dark-contrast/folder-mobile.webp" alt="New folder dialog on a phone: a deep navy surface over the dimmed library, with a readable description and an outlined folder-name field" caption="Dialogs stay deep navy and sit above the dimmed page, with a visible keyboard focus ring." />

## What your administrator controls

The instance may have its own name, tagline, light/dark logos, and footer, as well as custom colors, typeface, background, and corner radius. These choices appear across the workspace and public pages.

Administrators use an appearance studio with drafts, previews, publishing, restore, and exportable appearance packs. If you operate the instance, continue with the [appearance administration guide](../admin/appearance).

A personal mode choice does not select a completely separate color palette or override the instance logo. The administrator's light and dark designs still provide the appearance within your selected mode.

## Pick the style of new share pages

An [upload profile](./upload-profiles) can set the share-page style for its new uploads:

- **Minimal:** set the file's header and preview on the page itself, without a card.
- **Framed:** show the file in a card in the middle of the page.
- **Delivery:** use a full-width card that opens with **A file for you** and names the uploader inside it.
- **Inherit:** use the instance's starting style when the upload's settings are resolved.

<Screenshot src="/screenshots/customization/share-framed.png" alt="Framed share-page layout" caption="Framed is one of three presentation choices available for sharing files." />

<Screenshot src="/screenshots/customization/share-delivery.png" alt="Delivery share-page layout: a full-width card that opens with A file for you and the uploader's name" caption="Delivery gives a file handoff its own presentation." />

Every style keeps the same parts in the same order: the file's name, type, size, and actions, then its preview. [What a share page shows](./sharing#what-a-share-page-shows) describes them.

Changing a profile applies to future uploads; it does not redesign every existing file. A file with a stored share style keeps that style. Files without a stored style inherit the instance's default.

## Presentation and access are independent

The administrator can choose whether share pages show uploader attribution, filename, file size, the expiration notice, and a footer. They can also set image fit and social-preview text.

These choices affect what a page presents. Hiding a name does not remove it from an existing URL or the downloaded file. A Minimal page can be private, and a Delivery page can be public: choose [visibility and passwords](./sharing) separately.

## If the appearance is unexpected

First check your selected personal mode and whether you saved it. If System is selected, check the device's own appearance setting. If public pages look different from your dashboard, that can be expected: public pages use instance appearance.

For problems caused by instance customization, contact the administrator. An administrator can open the appearance recovery page to repair custom styling and restore a usable design; see [appearance administration](../admin/appearance).

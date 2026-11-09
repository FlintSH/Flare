---
title: Upload profiles and defaults
description: Save reusable sharing choices, understand inheritance, and use the same workflow in the browser and screenshot tools.
---

# Upload profiles and defaults

Managing saved profiles, importing/exporting recipes, and selecting an account default requires `uploadProfiles.manage`. Changing account upload defaults uses `profile.update`. Uploading with an existing profile still requires `files.upload`; a profile never grants a permission missing from your [roles](/admin/roles).

An upload profile saves how you want a new upload to behave. Make one for everyday screenshots, another for private work, and another for temporary clips. The same choices can follow uploads from the browser, pastes, screenshot tools, and your own integrations.

Open **Profile → Uploads** to manage profiles. [Try the upload-options lab](/demos#upload-options-lab) to explore how defaults combine before changing your account.

## Create your first profile

1. Open **Profile → Uploads**.
2. Start a new profile or select a starter.
3. Give it a clear name.
4. Choose the values you want the profile to control. Leave other fields on **Inherit**.
5. Choose **Save profile**. It becomes available once the profile has a name and, for a saved profile, once you change something.
6. Choose **Make default** if it should apply when an upload does not explicitly select another profile.

The built-in starters are starting points you can review and edit:

<Screenshot src="/screenshots/handbook/upload-profiles.webp" alt="Current upload profile editor with the Public screenshots starter selected and a Tags selector" caption="The Public screenshots starter explicitly chooses public visibility, random names, and Minimal layout. Other choices inherit your defaults." />

| Starter                | Explicit choices                                                   |
| ---------------------- | ------------------------------------------------------------------ |
| **Public screenshots** | Public visibility, randomized filenames, Minimal share page.       |
| **Private work**       | Private visibility, deletion after one day, Delivery share page.   |
| **Temporary clips**    | Public visibility, make private after one hour, Framed share page. |

Fields not explicitly set by a starter still inherit your account or instance defaults. For example, Public screenshots does not explicitly turn off an existing account expiration. Review all choices before making any starter your default.

## Everything a profile can control

| Option          | Values                                                | What it changes                                                   |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Visibility      | Inherit, Public, Private                              | Who can open new uploads.                                         |
| Expiration      | Inherit, none, one hour, one day, one week, one month | A relative lifetime calculated when the upload starts.            |
| When it expires | Inherit, Delete file, Make private                    | Whether expiration removes the stored file or keeps it privately. |
| File naming     | Inherit, original name, random name, custom pattern   | The filename portion of new file URLs.                            |
| Share page      | Inherit, Minimal, Framed, Delivery                    | The presentation used by new share pages.                         |
| Tags            | Your selected tags                                    | Organizational labels applied to new uploads.                     |

Passwords and folder destinations are chosen separately for individual uploads. They are not stored in profiles. A random URL name is not an access restriction: choose private visibility or password protection when access should be restricted.

## Name uploads with a pattern

Choose **File naming → Custom pattern** to decide what the filename part of new URLs looks like. A pattern is text with placeholders in braces. With `shot-{date}-{random:4}`, a PNG uploaded on 14 March 2026 gets a URL name like `shot-2026-03-14-x7Kp.png`.

<Screenshot src="/screenshots/handbook/name-pattern.webp" alt="Upload profile editor with File naming set to Custom pattern, the pattern shot-{date}-{random:4}, an example name beneath it, and a row of placeholder buttons" caption="The example under the pattern updates as you type. The buttons insert a placeholder at the cursor." />

1. Open **Profile → Uploads** and select or create a profile.
2. Set **File naming** to **Custom pattern**. The **Name pattern** field appears with `{date}-{random}` to start from.
3. Type your pattern, or use the placeholder buttons to insert one at the cursor.
4. Check the example under the field, then choose **Save profile**.

| Placeholder   | Becomes                                                                                             | Example               |
| ------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| `{name}`      | The original filename, made URL-safe the same way as **Keep original name**, without its extension. | `team-photo`          |
| `{random}`    | Six random letters and digits. `{random:10}` gives ten; any length from 1 to 32 works.              | `x7Kp2a`              |
| `{words}`     | Three random words joined by hyphens. `{words:2}` gives two; any number from 1 to 6 works.          | `amber-otter-lantern` |
| `{date}`      | The date the upload started.                                                                        | `2026-03-14`          |
| `{time}`      | The time the upload started, as hours, minutes and seconds.                                         | `092653`              |
| `{year}`      | Four digits. `{month}`, `{day}`, `{hour}`, `{minute}` and `{second}` are two digits each.           | `2026`                |
| `{timestamp}` | The upload's start as Unix time in seconds.                                                         | `1773480413`          |

What to know before relying on a pattern:

- **Allowed text.** Around the placeholders you can type letters, digits, hyphens and underscores, up to 100 characters in all. Spaces, dots, slashes and other characters are refused, and the field says which one to remove. Capital letters you type are kept.
- **Extension.** Flare adds the uploaded file's extension after the pattern, by the same rule as other names, so don't write one. A file without a recognized extension gets none.
- **Time zone.** Dates and times are UTC, not your local time. A screenshot taken at 9 pm in New York is dated the next day.
- **Repeated names.** A pattern doesn't need a random part. If a URL name is already used in your account, Flare adds a hyphen and 12 random characters before the extension rather than replacing the older file. With the pattern `latest`, the first PNG is `latest.png` and the next is something like `latest-3f9c2a71-b04.png`.
- **Length.** A name longer than 200 characters before its extension is cut to 200.
- **Privacy.** `{words}` draws from 256 words, so `{words:3}` has about 16.7 million combinations. Like a random name, a pattern is not an access restriction.
- **Display names.** Only the URL name changes. The library keeps showing the original filename, and [filename tag rules](./tags#automatic-tags) keep checking it.

A pattern replaces the choice between original and random names. A profile with a pattern uses it even when your account default is **Randomize file URLs**, and a profile set to **Keep original name** or **Random name** never inherits a pattern. Account upload defaults offer only original or random names. To use a pattern for every upload, save it in a profile and choose **Make default**.

**Save profile** stays unavailable while the pattern has a problem. Existing files keep their URLs when you add or change a pattern. Integrations can send a pattern with a single upload instead; see [the upload API](../api/files#select-a-profile-and-folder-before-sending-bytes).

## Understand the order of settings

Flare resolves an upload's choices in this order:

1. **Instance and account defaults** provide the starting values.
2. **The selected profile**, or your default profile, overrides the fields it explicitly sets.
3. **Allowed per-upload choices** override the result for that upload.

The browser's profile picker offers three approaches:

- **Account default:** use your saved default profile, if one is set.
- **Account settings only:** bypass the saved default profile.
- **A named profile:** use that profile for this upload.

The summary beneath the picker shows effective visibility, expiration, and filename behavior. For a profile with a name pattern it shows the pattern, as in **Filenames from shot-{date}-{random:4}**. The upload or paste form's visibility control can then override that upload's visibility.

[Creating or extracting an archive](./archives#choose-an-upload-profile-deliberately) has a separate default: **Private (no profile)** creates private files without expiration and bypasses your account's saved default profile. You can explicitly select an owned profile in either archive dialog. Its normal settings and permissions then apply to the new outputs, while **Save to** independently chooses the destination. Review a public profile carefully: it can expose extracted files or the contents of a newly packaged archive even when the source files were private.

::: details Example: make one upload public without changing your default
Suppose your default profile is Private work. Choose it on Upload, then explicitly set the form's visibility to Public. This upload is public, but the profile still provides its one-day deletion rule and Delivery layout. Your saved default stays private. The open upload form retains your one-time choices after completion, so reset visibility to From upload profile or reopen Upload before the next private upload. To bypass all profile settings, choose Account settings only instead.
:::

::: details Example: turn off an inherited expiration
If your account default expires uploads after one day, leaving a profile's expiration on Inherit keeps that lifetime. Choose No expiration in the profile to override it. On the upload form, No expiration turns it off for just that upload; Use profile expiration restores the inherited behavior.
:::

Server limits, file restrictions, and quotas apply regardless of profiles. A profile does not raise your allowed file size or storage quota.

## Account upload defaults

Under **Profile → Uploads → Account upload defaults**, you can set:

- **Vanity URL:** use a memorable path in place of the account's generated ID.
- **Randomize file URLs:** choose random names for future uploads unless a profile overrides it. A [name pattern](#name-uploads-with-a-pattern) is a profile setting.
- **When files expire:** choose delete or set private as the default expiry action.
- **Default expiration:** disabled, one hour, one day, one week, or one month.

The vanity path is account-wide and is separate from profiles. Changing or clearing it can stop older vanity links from resolving. Generated account-ID file paths remain a separate way to resolve the files. The links shown after an upload use the vanity path. **Copy link** in the library and on a file's page copies the account-ID path, which keeps working when you change or clear the vanity path.

## Connect a saved profile to a tool

On a saved profile, use **Use this profile in your tools** to download a configuration or script for ShareX, Bash, Flameshot, Spectacle, or iTake. The file includes your account upload token and selects that profile automatically. ShareX and Bash download at once. Flameshot, Spectacle, and iTake open the same setup dialog as the general [screenshot tools](./screenshot-tools), so you can choose Wayland support, a screen recording, or any other option for the profile. The buttons appear only when your role has both `files.upload` and `tokens.manage`, like the general tools.

Downloads from the general **Screenshot tools and scripts** section use your account's default behavior instead. This is useful if you want changing your default profile to change how those tools upload.

For custom integrations, a [named API token](../api/authentication) can be bound to a profile. A bound token cannot select another profile or override its upload settings. Deleting that profile makes uploads with the bound token fail until the integration is reconfigured.

## Edit or delete a profile

Edits apply to future uploads. They do not change the visibility, expiration, naming, tags, or stored style of existing files. An in-progress chunked upload uses the settings captured when it started, even if you edit the profile during transfer.

Archive creation and extraction also check the profile and effective settings shown in the dialog, including any inherited account or instance defaults. A relevant default or sharing permission changing can require another review even when the saved profile itself was not edited. If those settings change before submission or during processing, the operation fails without publishing outputs. Review the refreshed summary and submit again. The fixed **Private (no profile)** archive option does not inherit these defaults.

If another session changes a profile while you are editing, Flare checks the saved revision rather than silently overwriting the newer version. Reload the latest profile and reapply your intended changes. Deleting a tag counts as such a change for every profile that selects it: Flare takes the tag out of those profiles and keeps their other settings.

Before deleting a profile, update clients that select it explicitly and any bound tokens. A missing profile is an error rather than an automatic switch to weaker settings.

A saved profile can hold a setting this version of Flare doesn't have, such as the retired copy format. Flare leaves it out when it reads the profile. If a saved setting has a value Flare can't read, uploads that use the profile fail with **Upload could not be completed.** and the server logs which setting it couldn't read, so tell your administrator. Earlier versions answered those uploads with **Invalid upload options.**, as if the upload itself had asked for something wrong, and logged nothing.

## Export and import a recipe

**Export** downloads a versioned JSON recipe containing the name and settings. **Import recipe** creates a separate saved profile for review without making it your default. Recipes exclude credentials, passwords, and the profile's own identifier.

```json
{
  "format": "flare-upload-profile",
  "version": 1,
  "profile": {
    "name": "24-hour screenshots",
    "options": {
      "visibility": "PUBLIC",
      "expiration": "DAY",
      "expiryAction": "DELETE",
      "randomizeFileUrls": true,
      "shareStyle": "minimal"
    }
  }
}
```

Recipes can be up to 64 KiB (65,536 bytes). **Import recipe** refuses a larger file, and `POST /api/upload-profiles` answers `413` to a larger request, whether it carries a recipe or a new profile. Recipes with tags contain account-specific tag IDs. Those tags must belong to the importing account and still exist. Remove tags from a recipe intended for another account, then let that person select their own labels after import. Unsupported versions and unknown fields are rejected.

A profile with a name pattern exports it as `"nameTemplate": "shot-{date}-{random:4}"` in place of `randomizeFileUrls`. A recipe that carries a pattern together with `"randomizeFileUrls": true` is refused, because the two contradict each other. Versions of Flare from before name patterns treat `nameTemplate` as an unknown field and refuse the recipe, so share such a recipe only with instances that have this feature.

Recipes are configuration, not an export of uploaded files. Use [account data export](./account#export-your-data) to download your content.

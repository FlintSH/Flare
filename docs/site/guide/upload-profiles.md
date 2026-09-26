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
5. Save the profile.
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
| File naming     | Inherit, original name, random name                   | The filename portion of new file URLs.                            |
| Share page      | Inherit, Minimal, Framed, Delivery                    | The presentation used by new share pages.                         |
| Tags            | Your selected tags                                    | Organizational labels applied to new uploads.                     |

Passwords and folder destinations are chosen separately for individual uploads. They are not stored in profiles. A random URL name is not an access restriction: choose private visibility or password protection when access should be restricted.

## Understand the order of settings

Flare resolves an upload's choices in this order:

1. **Instance and account defaults** provide the starting values.
2. **The selected profile**, or your default profile, overrides the fields it explicitly sets.
3. **Allowed per-upload choices** override the result for that upload.

The browser's profile picker offers three approaches:

- **Account default:** use your saved default profile, if one is set.
- **Account settings only:** bypass the saved default profile.
- **A named profile:** use that profile for this upload.

The summary beneath the picker shows effective visibility, expiration, and filename behavior. The upload or paste form's visibility control can then override that upload's visibility.

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
- **Randomize File URLs:** choose random names for future uploads unless a profile overrides it.
- **When files expire:** choose delete or set private as the default expiry action.
- **Default expiration:** disabled, one hour, one day, one week, or one month.

The vanity path is account-wide and is separate from profiles. Changing or clearing it can stop older vanity links from resolving. Generated account-ID file paths remain a separate way to resolve the files. Use the current **Copy link** action when distributing a new address.

## Connect a saved profile to a tool

On a saved profile, use **Use this profile in your tools** to download a configuration or script for ShareX, iTake, Bash, Flameshot, or Spectacle. The file includes your account upload token and selects that profile automatically.

Downloads from the general **Screenshot tools and scripts** section use your account's default behavior instead. This is useful if you want changing your default profile to change how those tools upload.

For custom integrations, a [named API token](../api/authentication) can be bound to a profile. A bound token cannot select another profile or override its upload settings. Deleting that profile makes uploads with the bound token fail until the integration is reconfigured.

## Edit or delete a profile

Edits apply to future uploads. They do not change the visibility, expiration, naming, tags, or stored style of existing files. An in-progress chunked upload uses the settings captured when it started, even if you edit the profile during transfer.

If another session changes a profile while you are editing, Flare checks the saved revision rather than silently overwriting the newer version. Reload the latest profile and reapply your intended changes.

Before deleting a profile, update clients that select it explicitly and any bound tokens. A missing profile is an error rather than an automatic switch to weaker settings.

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

The browser importer accepts recipes up to 64 KiB. Recipes with tags contain account-specific tag IDs. Those tags must belong to the importing account and still exist. Remove tags from a recipe intended for another account, then let that person select their own labels after import. Unsupported versions and unknown fields are rejected.

Recipes are configuration, not an export of uploaded files. Use [account data export](./account#export-your-data) to download your content.

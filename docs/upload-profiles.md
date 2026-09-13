# Upload profiles

Open **Workspace → Upload profiles** to save how you share. Start from Public screenshots, Private work or Temporary clips, or create your own profile. Choose visibility, expiration and its action, randomized URLs, share-page style, and copied-link format. Any field set to **Inherit** follows your account or the instance default.

**Make default** applies a profile to future uploads, including dashboard drag-and-drop and existing upload clients. The upload and paste forms also let you select a profile for one upload or use account settings directly. The effective choices are resolved when an upload starts; editing a profile during a chunked upload does not change its snapshot. Changes do not alter existing files.

The order is instance/account defaults, selected or default profile, then allowed per-upload choices. Instance limits and quotas still apply. Passwords are set on individual uploads and are never saved in profiles or exported recipes. An explicitly disabled expiration overrides an inherited expiration.

## Screenshot tools and API

Select a saved profile to download a ShareX configuration or Bash, Flameshot or Spectacle script that selects it. These generated clients include your existing upload credential, so keep them private. For a credential dedicated to a single tool, create a [named token](integrations.md) under **Workspace → Integrations** and optionally bind it to a profile.

For multipart uploads, select the profile before sending file bytes using `X-Upload-Profile: PROFILE_ID` or `?profileId=PROFILE_ID`. Use the literal `none` to bypass the saved default. A profile-bound named token automatically selects its profile and rejects attempts to change it or override its upload choices. Deleting a bound profile makes subsequent uploads fail until the tool is reconfigured.

The upload response preserves `data.url` and adds `pageUrl`, `rawUrl`, `downloadUrl` and `copyText`. Copy formats include the share page, raw link, download link, Markdown and HTML. Copy format changes link formatting; it does not grant access to a private or password-protected file.

## Share recipes

**Export** downloads a versioned JSON recipe containing the profile name and preferences. **Import recipe** creates a separate saved profile for review and does not change your default. Recipes exclude identifiers, credentials and passwords; unknown fields and unsupported versions are rejected.

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
      "shareStyle": "minimal",
      "copyFormat": "markdown"
    }
  }
}
```

Normal uploads and both chunk-completion routes share final validation, quota accounting, retention scheduling and the `file.ready` event transaction. Existing retention still runs through Flare's scheduled-event worker; the new durable delivery leases apply specifically to webhooks. Resumable chunk metadata remains local to the instance, so deployments with multiple replicas need sticky routing/shared upload scratch storage as before.

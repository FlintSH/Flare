# Upload profiles

Open **Profile → Uploads** (`/dashboard/profile?section=uploads`) to save how you share. Start from Public screenshots, Private work or Temporary clips, or create your own profile. Choose visibility, expiration and its action, randomized URLs, and share-page style. Any field set to **Inherit** follows your account or the instance default.

**Make default** applies a profile to future uploads, including dashboard drag-and-drop and existing upload clients. The upload and paste forms also let you select a profile for one upload or use account settings directly. The effective choices are resolved when an upload starts; editing a profile during a chunked upload does not change its snapshot. Changes do not alter existing files.

The order is instance/account defaults, selected or default profile, then allowed per-upload choices. Instance limits and quotas still apply. Passwords are set on individual uploads and are never saved in profiles or exported recipes. An explicitly disabled expiration overrides an inherited expiration.

## Screenshot tools and API

Open **Profile → Uploads → Screenshot tools and scripts** (`/dashboard/profile?section=uploads#upload-tools`) to download a ShareX configuration or Bash, Flameshot or Spectacle script. The downloads already include your account's upload token; no API token creation or copying is required. Keep these files private.

For a tool to use a particular profile, download its configuration or script from that saved profile. [Named API tokens](integrations.md#named-api-tokens) under **Profile → Integrations** are optional for custom integrations or tools that need separate permissions, expiration, or revocation; they can also be bound to a profile.

For multipart uploads, select the profile before sending file bytes using `X-Upload-Profile: PROFILE_ID` or `?profileId=PROFILE_ID`. Use the literal `none` to bypass the saved default. A profile-bound named token automatically selects its profile and rejects attempts to change it or override its upload choices. Deleting a bound profile makes subsequent uploads fail until the tool is reconfigured.

The web upload and paste forms' **Copy link** and **Copy all links** buttons, generated screenshot tools, and scripts always copy the plain share-page URL. Saved profiles do not change this behavior. A share link does not grant access to a private or password-protected file.

The upload response exposes the share-page URL as `data.url` and `pageUrl`. The `copyText` field remains an alias for the same URL so previously downloaded clients continue to work.

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
      "shareStyle": "minimal"
    }
  }
}
```

Normal uploads and both chunk-completion routes share final validation, quota accounting, retention scheduling and the `file.ready` event transaction. Existing retention still runs through Flare's scheduled-event worker; the new durable delivery leases apply specifically to webhooks. Resumable chunk metadata remains local to the instance, so deployments with multiple replicas need sticky routing/shared upload scratch storage as before.

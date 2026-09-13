# First-run setup

Open `/setup` on a new instance. One page takes you through six steps with the same layout, progress indicator, and Flare theme:

1. **Account:** create the initial administrator account.
2. **Storage:** choose local storage or enter an S3-compatible bucket's details. Setup validates the fields but does not test the storage connection.
3. **Access:** allow public sign-ups or keep registration closed. Create the instance when these choices are ready.
4. **Appearance, optional:** choose an instance name, tagline, and starting look. The preview changes locally; **Save and continue** publishes your choices. **Set up appearance later** leaves the published appearance unchanged. The Flare default keeps the original theme active.
5. **Email, optional:** configure and test a mail provider, then save and continue. Skipping this step does not change email settings. Email can be configured later in Settings → Email.
6. **Ready:** open your workspace, upload a first file, or explore the full appearance studio. If email is configured, you can verify your address from here.

The first three steps create the administrator and instance configuration together. You can go back and edit them before creating the instance. Once creation succeeds, those steps are complete; subsequent changes belong in Settings. Passwords and storage credentials stay in form memory and are not stored in browser storage or URLs.

Refreshing before account creation starts over. After creation, refreshing resumes the optional step in the URL. If automatic sign-in fails, the account is still created and setup offers a sign-in link. A signed-out administrator can sign in to resume the same optional step; other users cannot access instance setup. Older `/setup/email` links redirect to the email step on `/setup`.

## Appearance defaults and existing installations

Creating an instance preserves Flare's default palette. Installations created by the earlier setup flow with an empty or partial color palette now fall back to the original Flare colors. Explicit legacy color overrides and published appearance themes remain supported.

Choosing a preset during onboarding changes only the preview until saved. Returning to onboarding starts from the published appearance and preserves settings that the simple editor does not expose. An existing studio draft is kept intact; review it in the studio or continue with the published appearance. Concurrent appearance changes require reloading and reviewing the latest version before saving.

After setup, instance-wide controls live in **Settings**, including the full appearance studio. Your own appearance preference, upload defaults, recipes, integrations, and account controls live in **Profile**. Both pages use the same navigation and visual style as setup.

For more control after setup, see [Appearance](appearance.md), [Upload profiles](upload-profiles.md), and [Integrations](integrations.md).

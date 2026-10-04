---
description: Walk through first-run setup from administrator creation through storage, registration, appearance, email, and a first upload.
---

# First-run setup

Open `/setup` on your new Flare instance. One guided flow takes you from an empty installation to a working workspace. Storage and registration are the essential decisions; appearance and email can be configured now or later.

Choose **Setup guide** in the header on any step to open the guide in a new tab, leaving your entered values in the setup tab. Stable builds open the guide for their installed release; rolling builds open the published rolling guide, which may be ahead of an older rolling installation. Unknown or other prerelease versions open [Versions](/versions) so you can choose documentation. Custom builds use their [package version and release channel](/hosting/configuration#core-environment-variables).

## 1. Create the administrator

Enter a username, email address, and password of at least eight characters. Flare creates an **Admin** role with the wildcard Administrator permission and assigns it to this first account, granting every permission. It also creates **Everyone**, the editable baseline inherited by all current and future accounts. [Roles](./roles) replace the former fixed account types. Keep its password available even if you plan to enable SSO later.

<Screenshot src="/screenshots/documentation-links/setup-desktop.webp" alt="First-run account form with a Setup guide link in the header" caption="Keep the setup guide alongside the form as you create the first administrator." />

::: details Find the guide on a phone
<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/documentation-links/setup-mobile.webp" alt="Mobile first-run setup with the Setup guide link above the account form" caption="Setup guide remains available at every step on narrow screens." />
</div>
:::

The initial administrator is explicitly exempt from required email verification so an optional email step cannot lock you out. That exemption does not prove ownership of the address and does not, on its own, enable password recovery. Verify a recovery address after email is configured.

## 2. Choose storage

Choose **Local storage** if you mounted persistent storage at `/app/uploads`. Choose **S3-compatible storage** if you have a bucket ready, then enter its bucket, region, access key, secret key, and optional custom endpoint/path-style preference.

<Screenshot src="/screenshots/documentation-links/setup-storage.webp" alt="Setup storage step with empty S3 bucket and connection fields and the Setup guide link above" caption="S3 lets file storage live separately from the application server." />

Setup validates required fields and URL syntax. It does **not** connect to the bucket or verify object permissions. Upload, preview, download, avatar, and delete tests after setup confirm the actual integration. See [storage behavior](/hosting/storage) before choosing a backend, especially if the bucket disables ACLs.

## 3. Choose who can join

Allow registration for an open community instance, or close registration and create accounts through Users. If closed, set a message explaining how people can request access.

You can go back and edit the first three steps before creating the instance. Creation saves the administrator and core configuration together. After it succeeds, these choices are managed in Settings and Users rather than rerunning account creation.

## 4. Make it yours, or keep the defaults

Choose an instance name, tagline, and starting look. The preview is local until **Save and continue** publishes it. **Set up appearance later** keeps the published design unchanged. Choosing the Flare default retains the original theme.

<Screenshot src="/screenshots/documentation-links/setup-appearance.webp" alt="Setup appearance step showing the Flare default starting look and the Setup guide link" caption="Keep the Flare default or preview a starting look before publishing it." />

For paired palettes, typography, backgrounds, logos, share-page layouts, and portable packs, open the [full appearance studio](/admin/appearance) after setup. Resuming onboarding begins from the published appearance, preserves fields the simple editor does not expose, and keeps an existing studio draft intact. If another administrator changes appearance while you are editing, reload and review the latest state before saving.

## 5. Add account email, optionally

Choose **Set up email later**, **Password recovery only**, or **Recovery + verify new users**. To enable email, configure SMTP and test the connection, then send a test message and check the inbox. Save when it works.

<Screenshot src="/screenshots/documentation-links/setup-email.webp" alt="Optional email setup with email left for later and the Setup guide link still available" caption="Choose whether to configure account email now or set it up later." />

Email failures do not undo completed setup. Skipping this step leaves existing email settings unchanged. You can configure sending, recovery, verification, branding, and delivery limits later under [Settings → Email](/admin/email).

## 6. Open your workspace

The ready step links to the workspace, a first upload, and the appearance studio. When email is configured, verify your own address from here. Upload a small file, copy its share link, open it in a signed-out browser, and download the bytes to confirm your storage path works.

## Refreshing or resuming setup

Before account creation, form values live only in memory. Refreshing starts over; passwords and storage credentials are not put in browser storage or URLs.

After creation, refreshing resumes the optional step identified in the URL. If automatic sign-in fails, the account has still been created; use the offered sign-in link and resume. A signed-out administrator can sign in to continue, but accounts without Administrator cannot administer setup. Older `/setup/email` links redirect to the email step in the unified flow.

Existing instances are not forced through setup after upgrading. If an established installation suddenly presents a fresh setup form, first check the database connection and persistent volumes; you may be looking at an empty database.

<div align="center">
  <img src="./public/banner.png" alt="Flare" width="600" />

  <h3>Share screenshots, files, and code from your own domain.</h3>

[![Version](https://img.shields.io/github/v/release/FlintSH/flare?style=flat-square&logo=github)](https://github.com/FlintSH/flare/releases) [![Last Commit](https://img.shields.io/github/last-commit/FlintSH/flare?style=flat-square&logo=git)](https://github.com/FlintSH/flare/commits/main) [![Stars](https://img.shields.io/github/stars/FlintSH/flare?style=flat-square&logo=github)](https://github.com/FlintSH/flare/stargazers) [![Discord](https://img.shields.io/discord/1006668059936829511?style=flat-square&color=5865F2&logo=discord&logoColor=white)](https://discord.gg/mwVAjKwPus)

  <p>
    <a href="#-quick-start"><strong>Deploy Flare</strong></a> ·
    <a href="#-features">Explore the features</a> ·
    <a href="#-configuration">Documentation</a> ·
    <a href="https://github.com/FlintSH/Flare/releases/tag/v2.0.0">What's new in 2.0</a>
  </p>
</div>

**Drop a file, grab a link, and share it.** Flare is a self-hosted home for your screenshots, files, pastes, and short links. Upload from your browser or favorite screenshot tool, give people a useful preview, and choose how your files look and who can open them.

Make it your own with branding, reusable upload profiles, and integrations. Run it with **Docker and PostgreSQL**, using **local or S3-compatible storage**, or start with the Railway template below. Flare is open source and MIT licensed.

## ✨ Features

Open a section for a closer look. Screenshots show Flare 2.0 with demonstration accounts.

<details>
<summary><strong>📸 Upload from your browser or screenshot tools</strong></summary>

Drag files onto the dashboard, upload a batch, or share a capture straight from **ShareX, Flameshot, KDE Spectacle, or Bash**. Download the configuration or script from your profile to connect your tool.

Save your visibility, expiration, file naming, share layout, and copied-link format as an **upload profile**. Pick one for an upload or paste, make it your default, or bring it to your screenshot tool. Export and import recipes to reuse the same preferences elsewhere.

![Upload-profile creation and starter recipes](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-upload-profiles-viewport.png)

[Explore upload profiles and recipes →](docs/upload-profiles.md)

</details>

<details>
<summary><strong>🖼️ Share useful previews with the access controls you need</strong></summary>

Let people view **images, video, audio, PDFs, text, code, and CSV files** in their browser. Code gets syntax highlighting; unsupported formats remain available to download. Public links include social preview metadata for services that support it.

Choose public or private visibility, add a password, or give a file an expiration. Expired files can be deleted or made private. Choose **Minimal, Framed, or Delivery** layouts for public share pages, with controls for attribution, file details, and social preview text.

[Explore public share layouts →](docs/appearance.md)

</details>

<details>
<summary><strong>🔍 Find screenshots by their text and track file activity</strong></summary>

Search filenames or text extracted from images with **OCR**. Narrow your library by file type, visibility, and upload date, then sort and page through the results.

See view and download counts on file cards, copy links, and manage visibility, passwords, and expiration from the library. File actions are available on touch screens too.

</details>

<details>
<summary><strong>📝 Share pastes and short links alongside your files</strong></summary>

Create a paste for a snippet, log, or note and share it with syntax highlighting. Upload profiles also work with pastes, so you can reuse your preferred visibility and share style.

Turn long URLs into short links under your own domain, copy them from the dashboard, and track clicks. Files, text, and links all live in the same app.

</details>

<details>
<summary><strong>🎨 Make Flare look like your own platform</strong></summary>

Set your instance name, tagline, logos, colors, fonts, and backgrounds in the **appearance studio**. Each person can choose a light, dark, system, or inherited dashboard preference.

Preview a draft before publishing, restore the previous appearance, and import or export **appearance packs**. Advanced custom CSS and head HTML remain available, with an administrator recovery view for fixing a troublesome theme.

![Appearance studio with branding controls and a public share-page preview](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-appearance-viewport.png)

[Make Flare yours →](docs/appearance.md)

</details>

<details>
<summary><strong>🔌 Connect your tools with API tokens and webhooks</strong></summary>

Give each integration a **named API token** with its own scopes, expiration, and revocation. Bind a token to an upload profile to keep that tool's uploads within your chosen defaults.

Send signed **file-ready webhooks** to external services when uploads finish. Flare records delivery history and retries eligible failures. A documented event schema and receiver example help you connect your own automations.

![The integrations overview before adding API tokens and webhook receivers](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-integrations-viewport.png)

[Connect an integration →](docs/integrations.md)

</details>

<details>
<summary><strong>🔐 Manage accounts, SSO, and optional email recovery</strong></summary>

Keep registration open or run a private instance. Manage users, administrator roles, and user content from the dashboard. Add **OIDC single sign-on** to connect your identity provider.

Configure an SMTP provider for **password recovery, email verification, and confirmed address changes**. These are optional controls, so you can choose what your instance needs. Existing local accounts are not automatically linked to SSO by matching email.

![Registration and optional OIDC sign-in controls](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-access-viewport.png)

![Optional email delivery and SMTP configuration](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-email-viewport.png)

[Configure SSO →](#single-sign-on-oidc) · [Set up account email →](docs/email.md)

</details>

<details>
<summary><strong>🏠 Run it on your infrastructure, with your storage</strong></summary>

Deploy with **Docker and PostgreSQL** or use the Railway template. Official images support **AMD64 and ARM64**. Choose local storage or an S3-compatible provider, set upload limits and default user quotas, and manage the instance through Settings.

First-run setup guides you through your account, storage, and registration settings, followed by optional appearance and email steps. Start with the Flare defaults or preview your own look before saving it.

![A demo instance previewing a custom name and Tide theme during guided setup](https://github.com/FlintSH/Flare/releases/download/v2.0.0/demo-setup-viewport.png)

[Walk through setup →](docs/onboarding.md)

</details>

## 🚀 Quick Start

Choose Railway for a guided deployment or Docker for your own server. Both take you to Flare's setup wizard.

### Railway (One-Click)

Deploy the template, set your authentication secret, and open your instance to create your administrator account.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/JVT41u?referralCode=R5s8WT)

### Docker Deployment (Self-Hosted)

1. Install Docker and the [Docker Compose plugin](https://docs.docker.com/compose/install/linux/).

2. Create `docker-compose.yml` with the template below. Replace the database password in both places and generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`. Set `NEXTAUTH_URL` to the public URL you will use to access Flare, and keep your authentication secret stable across restarts.

   <details>
   <summary>Copy the Docker Compose configuration</summary>

   ```yaml
   services:
     db:
       image: postgres:17-alpine
       container_name: flare-db
       restart: unless-stopped
       environment:
         POSTGRES_USER: flareuser
         POSTGRES_PASSWORD: your-secure-password-here
         POSTGRES_DB: flaredb # database name Flare will use
       volumes:
         - ./postgres-data:/var/lib/postgresql/data
       healthcheck:
         test: ['CMD-SHELL', 'pg_isready -U flareuser -d flaredb']
         interval: 10s
         timeout: 5s
         retries: 5

     flare:
       image: flintsh/flare:latest
       container_name: flare-app
       restart: unless-stopped
       ports:
         - '3000:3000'
       environment:
         DATABASE_URL: postgresql://flareuser:your-secure-password-here@db:5432/flaredb?schema=public
         NEXTAUTH_SECRET: replace-with-your-generated-secret
         NEXTAUTH_URL: http://localhost:3000
       volumes:
         - ./uploads:/app/uploads
       depends_on:
         db:
           condition: service_healthy
   ```

   </details>

3. Run `docker compose up -d`.

4. Open http://localhost:3000, or your configured public URL, to complete setup.

Images are available as `flintsh/flare:latest` on Docker Hub and `ghcr.io/flintsh/flare:latest` on GitHub Container Registry. You can also pin a release such as `2.0.0`.

## 📝 Configuration

Instance-wide controls live in **Settings** (`/dashboard/settings`). Personal appearance, uploads, integrations, and account controls live in **Profile** (`/dashboard/profile`).

| Guide                                      | What you can configure                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| [First-run setup](docs/onboarding.md)      | Administrator account, storage, access, and optional personalization |
| [Appearance](docs/appearance.md)           | Branding, palettes, public share layouts, packs, and recovery        |
| [Upload profiles](docs/upload-profiles.md) | Reusable defaults, recipes, and screenshot-tool configurations       |
| [Integrations](docs/integrations.md)       | Scoped tokens, signed webhooks, and delivery behavior                |
| [Account email](docs/email.md)             | SMTP, recovery, verification, and environment overrides              |

### Account email

Optional SMTP email supports password recovery, address verification, and confirmed
email changes. Configure it during first-time setup or in **Settings → Email**.
Delivery, recovery, and verification requirements are independent; upgrades leave
email disabled and preserve existing account access. See [account email setup,
environment overrides, and recovery](docs/email.md).

### Single Sign-On (OIDC)

Configure your identity provider in **Settings → Access** (`/dashboard/settings?section=access`), with
`https://your-flare-host/api/auth/callback/oidc` as its redirect URI. Keep a local
administrator login available; `/auth/login?local=1` bypasses OIDC auto-login.

SSO sign-in identifies accounts by the provider's issuer and subject, not email.
New identities can create accounts when auto-provisioning is enabled and their
email is unused. A matching email never links or replaces an existing account:
local users must use password sign-in, and already linked users must use their
original SSO identity. With auto-provisioning disabled, only already linked SSO
identities can sign in; precreating a local account with the same email does not
enable SSO. An explicit account-linking flow is not yet available.

Older development configurations containing `allowLinking` are accepted, but
that setting is ignored. Existing SSO links and local credentials are preserved.

## 💬 Support

Need help with your instance, or want to share what you've made? Join my [Discord](https://discord.gg/mwVAjKwPus) for support, discussions, and updates. Bug reports and feature ideas are welcome in [GitHub Issues](https://github.com/FlintSH/Flare/issues).

Want to contribute? Start with the [contributing guide](CONTRIBUTING.md).

## 📜 License

Flare is licensed under the [MIT License](LICENSE).

<sub>Icon designed by <a href="https://ko-fi.com/xnefas/">xNefas</a>.</sub>

<div align="center">
  <img src="./public/banner.png" alt="Flare Banner" width="600px" />
  <p><small><i>Icon designed by <a href="https://ko-fi.com/xnefas/">xNefas</a></i></small></p>
  
  ### A modern, lightning-fast file sharing platform built for self-hosting

[![Version](https://img.shields.io/github/v/release/FlintSH/flare?include_prereleases&style=flat-square&logo=github)](https://github.com/FlintSH/flare/releases)
[![Last Commit](https://img.shields.io/github/last-commit/FlintSH/flare?style=flat-square&logo=git)](https://github.com/FlintSH/flare/commits/main)
[![Stars](https://img.shields.io/github/stars/FlintSH/flare?style=flat-square&logo=github)](https://github.com/FlintSH/flare/stargazers)
[![Discord](https://img.shields.io/discord/1006668059936829511?style=flat-square&color=5865F2&logo=discord&logoColor=white)](https://discord.gg/mwVAjKwPus)

</div>
Flare is a modern, self-hostable file sharing platform designed to work seamlessly with popular screenshot and sharing tools like ShareX, Flameshot, and KDE Spectacle. Built with Next.js and designed with simplicity in mind, it offers a complete solution for all your file sharing needs with a strong focus on performance, customizability, and user experience.

## 📖 Documentation

The [Flare handbook](docs/site/guide/index.md) covers every user workflow,
instance administration, deployment, configuration, API, and webhooks. Its
independent static site includes full-text search, interactive examples, real
screenshots, and recorded app demos.

- **Get started:** [Docker](docs/site/hosting/docker.md) · [Railway](docs/site/hosting/railway.md) · [First-run setup](docs/site/admin/setup.md)
- **Use Flare:** [Upload and share](docs/site/guide/uploading.md) · [Folders](docs/site/guide/folders.md) · [Screenshot tools](docs/site/guide/screenshot-tools.md)
- **Run your instance:** [Configuration](docs/site/hosting/configuration.md) · [Administration](docs/site/admin/index.md) · [Backups and upgrades](docs/site/hosting/maintenance.md)
- **Build integrations:** [API reference](docs/site/api/index.md) · [Webhooks](docs/site/api/webhooks.md) · [OpenAPI](docs/site/public/openapi.json)
- **Explore:** [Feature guide](docs/site/features.md) · [Demos](docs/site/demos.md) · [Troubleshooting](docs/site/hosting/troubleshooting.md)

Preview the full site with `npm ci --prefix docs/site` then
`npm run dev --prefix docs/site`. See [building and publishing the docs](docs/site/contributing.md).

## ✨ Features

- 🚀 **Universal Screenshot Integration**
  - ShareX, Flameshot, KDE Spectacle, and Bash Script upload support
  - One-click configuration/script downloads
- 🔒 **Secure & Private** - Role-based permissions, private files, and password protection
- 💾 **Flexible Storage** - Local filesystem and S3-compatible storage support
- 🖼️ **Universal Preview** - Preview images, videos, PDFs, and code with syntax highlighting
- 🔍 **Smart Search** - Search by filename, OCR content, and date with filters
- 📁 **[Folders](docs/site/guide/folders.md)** - Organize files and subfolders, move files in bulk, and share a folder with one link
- 📱 **Modern UI** - Clean, responsive interface built with shadcn/ui - easily customizable
- ⚙️ **Configurable**
  - User storage quotas, registration controls, and instance settings
  - [Unified setup](docs/site/admin/setup.md): account, storage, access, optional personalization and email in one guided flow
  - [Appearance studio](docs/site/admin/appearance.md): branding, paired palettes, share layouts, previews and portable packs
  - [Upload profiles](docs/site/guide/upload-profiles.md): reusable defaults and recipes across browser and screenshot tools
  - [Integrations](docs/site/api/index.md): scoped tokens and signed file-ready webhooks
  - Personal light/dark/system preferences, CSS variables and custom colors
  - Advanced settings for custom CSS and HTML injection
- 📊 **Admin Dashboard** - Usage metrics, user management, and system configuration
- 👥 **User Management** - Role assignment, storage quotas, and content moderation
- 🔗 **URL Shortener** - Compact generated URLs under your domain with click tracking
- 📝 **Pastebin** - Code and text sharing with syntax highlighting
- 🤖 **OCR Processing** - Automatic text extraction from images uploaded
- 🔌 **Rich Embeds** - Content embeds naturally on all your social media platforms.

## 🚀 Quick Start

Flare is quick to deploy—you only need a PostgreSQL server and Docker. Choose one of these options:

### Railway (One-Click)

Click the button below to deploy Flare on Railway. Once deployed, just set your authentication secret and create your admin account.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/JVT41u?referralCode=R5s8WT)

### Docker Deployment (Self-Hosted)

Follow the [Docker Compose guide](docs/site/hosting/docker.md) for a complete
configuration with PostgreSQL, persistent storage, generated secrets, health
checks, and a first-upload check. Then add a
[domain and HTTPS](docs/site/hosting/reverse-proxy.md) and set up
[backups](docs/site/hosting/maintenance.md).

The official image is available as `flintsh/flare` on Docker Hub and
`ghcr.io/flintsh/flare` on GitHub Container Registry. The `rolling` tag tracks
pre-releases; use a tested release tag or digest for repeatable deployments.
See [release channels and updates](docs/site/hosting/maintenance.md).

## 💬 Support

Need help with your instance? Join my [Discord](https://discord.gg/mwVAjKwPus) for support, discussions, and updates!

## 📝 Configuration

Instance-wide controls live in **Settings** (`/dashboard/settings`). Personal appearance, upload defaults and recipes, integrations, and account controls live in **Profile** (`/dashboard/profile`). Both pages follow the same design as first-run setup.

In Settings, administrators can configure:

- Setting a shared ordinary-user storage quota and a maximum file size
- Choosing storage and optional OCR processing
- Configuring registration options and user permissions
- Customizing the site's appearance and branding
- Managing advanced settings like custom CSS and HTML

### Account email

Optional SMTP email supports password recovery, address verification, and confirmed
email changes. Configure it during first-time setup or in **Settings → Email**.
Delivery, recovery, and verification requirements are independent; upgrades leave
email disabled and preserve existing account access. See [account email setup,
environment overrides, and recovery](docs/site/admin/email.md).

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

## 📜 License

Flare is licensed under the MIT License.

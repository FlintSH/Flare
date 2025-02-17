<div align="center">
  <img src="./public/banner.png" alt="Flare Banner" width="600px" />
  <p><small><i>Icon designed by <a href="https://github.com/tythebeast/">xNefas</a></i></small></p>
  
  ### A modern, lightning-fast file sharing platform built for self-hosting

[![Version](https://img.shields.io/github/v/release/FlintSH/flare?include_prereleases&style=flat-square&logo=github)](https://github.com/FlintSH/flare/releases)
[![Last Commit](https://img.shields.io/github/last-commit/FlintSH/flare?style=flat-square&logo=git)](https://github.com/FlintSH/flare/commits/main)
[![Stars](https://img.shields.io/github/stars/FlintSH/flare?style=flat-square&logo=github)](https://github.com/FlintSH/flare/stargazers)
[![Discord](https://img.shields.io/discord/1006668059936829511?style=flat-square&color=5865F2&logo=discord&logoColor=white)](https://discord.gg/mwVAjKwPus)

</div>
Flare is a modern, self-hostable file sharing platform designed to work seamlessly with popular screenshot and sharing tools like ShareX and Flameshot. Built with Next.js and designed with simplicity in mind, it offers a complete solution for all your file sharing needs with a strong focus on performance, customizability, and user experience.

## ✨ Features

- 🚀 **Universal Screenshot Integration**
  - ShareX, Flameshot, and Bash Script support
  - One-click configuration downloads
- 🔒 **Secure & Private** - Role-based permissions, private files, and password protection
- 💾 **Flexible Storage** - Local filesystem and S3-compatible storage support
- 🖼️ **Universal Preview** - Preview images, videos, PDFs, and code with syntax highlighting
- 🔍 **Smart Search** - Search by filename, OCR content, and date with filters
- 📱 **Modern UI** - Clean, responsive interface built with shadcn/ui - easily customizable
- ⚙️ **Configurable**
  - User storage quotas, registration controls, and instance settings
  - Theme customization with CSS variables and custom colors
  - Advanced settings for custom CSS and HTML injection
- 📊 **Admin Dashboard** - Usage metrics, user management, and system configuration
- 👥 **User Management** - Role assignment, storage quotas, and content moderation
- 🔗 **URL Shortener** - Custom short URLs under your domain with click tracking
- 📝 **Pastebin** - Code and text sharing with syntax highlighting
- 🤖 **OCR Processing** - Automatic text extraction from images uploaded
- 🔌 **Rich Embeds** - Content embeds naturally on all your social media platforms.

## 🚀 Quick Start

Flare is quick to deploy—you only need a PostgreSQL server and Docker. Choose one of these options:

### Railway (One-Click)

Click the button below to deploy Flare on Railway. Once deployed, just set your authentication secret and create your admin account.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/JVT41u?referralCode=R5s8WT)

### Docker Deployment (Self-Hosted)

1. Clone the repository and enter the project directory:
   ```bash
   git clone https://github.com/FlintSH/flare.git
   cd flare
   ```
2. Copy the sample environment file:
   ```bash
   cp .env.example .env
   ```
3. Update environment variables (e.g. NEXTAUTH_SECRET and DATABASE_URL) to point to your Postgres server and secure your instance with a secret key.
4. Launch Flare (which runs PostgreSQL) with:
   ```bash
   docker compose up -d
   ```
5. Run the database migrations:
   ```bash
   docker compose exec app npx prisma migrate deploy
   ```
6. Open http://localhost:3000 to complete the setup and create your admin account.

Pre-built Docker images are available on both Docker Hub and GitHub's Container Registry under `flintsh/flare`.

## 📝 Configuration

Flare is built to be really configurable. Head to `/dashboard/settings` to tweak different settings like:

- Setting storage quotas and file size limits for users
- Defining upload rules and restrictions
- Configuring registration options and user permissions
- Customizing the site’s appearance and branding
- Managing advanced settings like custom CSS and HTML

For more details on each setting, visit the [Docs](https://flare.fl1nt.dev) (coming soon).

## 📜 License

Flare is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

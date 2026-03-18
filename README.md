
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

## ✨ Features

- 🚀 **Universal Screenshot Integration**
  - ShareX, Flameshot, KDE Spectacle, and Bash Script upload support
  - One-click configuration/script downloads
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

1. Install ```docker.io``` and ```docker-compose```

2. Create ```docker-compose.yml``` with the following template:

   ```bash
   version: '3.8'
   
   services:
     db:
       image: postgres:17-alpine   # lightweight, recent version; 16 or 15 also fine
       container_name: flare-db
       restart: unless-stopped
       environment:
         POSTGRES_USER: flareuser          # change if you want
         POSTGRES_PASSWORD: your-secure-password-here   #  ^f^p CHANGE THIS to something strong
         POSTGRES_DB: flaredb              # database name Flare will use
       volumes:
         - ./postgres-data:/var/lib/postgresql/data   # persistent storage
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U flareuser -d flaredb"]
         interval: 10s
         timeout: 5s
         retries: 5
   
     flare:
       image: flintsh/flare:latest
       container_name: flare-app
       restart: unless-stopped
       ports:
         - "3000:3000"                     # change left side if you want different host port
       environment:
         DATABASE_URL: postgresql://flareuser:your-secure-password-here@db:5432/flaredb?schema=public
         NEXTAUTH_SECRET: securestuffhere   # generate with: openssl rand -base64 32
         NEXTAUTH_URL: http://localhost:3000     # or https:// if using reverse proxy
       volumes:
         - ./uploads:/app/uploads          # where files/screenshots/videos are stored
       depends_on:
         db:
           condition: service_healthy

   ```
3. Run ```docker-compose up -d```

4. Open http://localhost:3000 to complete the setup and create your admin account.

The official Docker image is available on Docker Hub and GitHub Container Registry as `flintsh/flare`.

## 💬 Support

Need help with your instance? Join my [Discord](https://discord.gg/mwVAjKwPus) for support, discussions, and updates!

## 📝 Configuration

Flare is built to be as configurable as possible. Head to `/dashboard/settings` to tweak different settings like:

- Setting storage quotas and file size limits for users
- Defining upload rules and restrictions
- Configuring registration options and user permissions
- Customizing the site's appearance and branding
- Managing advanced settings like custom CSS and HTML

## 📜 License

Flare is licensed under the MIT License.

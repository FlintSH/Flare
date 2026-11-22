---
title: Features
description: Explore everything Flare can do, with practical guides for each capability.
---

# Features

Everything Flare does. Pick one to see how it works.

<FeatureExplorer />

## Not sure where to start? {#choose-your-starting-point}

| You want to…                                                   | Start here                                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up a personal file host                                    | [Docker Compose](./hosting/docker) → [first-run setup](./admin/setup)                                                                                     |
| Run a shared instance                                          | [Roles and permissions](./admin/roles) → [users](./admin/users) → [email](./admin/email) → [backups](./hosting/maintenance)                               |
| Let people join a private instance                             | [Invite links](./guide/invites) → [who can invite](./admin/users#invite-links)                                                                            |
| Send screenshots straight to your domain                       | [Screenshot tools](./guide/screenshot-tools) → [upload profiles](./guide/upload-profiles)                                                                 |
| Share a collection                                             | [Folders](./guide/folders) → [sharing and privacy](./guide/sharing)                                                                                       |
| Decide how your links look in chat apps                        | [Embeds and link previews](./guide/embeds)                                                                                                                |
| Find an older upload in a large library                        | [Continuous scrolling and the date rail](./guide/library#scroll-through-your-library) → [recorded walkthrough](./demos#browse-a-large-library)            |
| Preview files inside large archives, extract, or package files | [Archives](./guide/archives) → [large-archive walkthrough](./demos#preview-files-in-a-large-archive)                                                      |
| Protect your sign-in                                           | [Two-factor authentication and passkeys](./guide/security)                                                                                                |
| Require a passkey instead of password or SSO                   | [Passkey requirement and emergency recovery](./guide/security#require-a-passkey-for-sign-in)                                                              |
| Review sign-ins or sign out a lost device                      | [Login history and active sessions](./guide/account#login-history-and-active-sessions)                                                                    |
| Investigate activity or a failed operation                     | [Instance audit log](./admin/audit)                                                                                                                       |
| Match your own brand                                           | [Appearance studio](./admin/appearance)                                                                                                                   |
| Connect your own software                                      | [API](./api/) → [signed webhooks](./api/webhooks)                                                                                                         |
| Let an AI agent find, read, upload, and organize your files    | [Connect an agent](./guide/agents) → [MCP server reference](./api/mcp)                                                                                    |
| Build a web app or PWA on top of your files                    | [Call Flare from a web app](./api/authentication#call-flare-from-a-web-app) → [`FLARE_CORS_ORIGINS`](./hosting/configuration#cross-origin-browser-access) |

## Before you choose Flare {#know-what-you-are-choosing}

- **Flare needs a server.** It runs as an application with PostgreSQL. Local storage also needs a persistent writable disk; an S3-compatible bucket can hold the files instead. Read the [deployment guide](./hosting/) before choosing infrastructure.
- **Private means access-controlled, not end-to-end encrypted.** Private files are limited to their owner and to accounts allowed to read other people's content. [Sharing and privacy](./guide/sharing) has the exact rules, including passwords, folder links, and storage URLs.
- **These docs follow releases.** If a control is missing on an older installation, check the version in **Settings → General**, open [the docs for that release](./versions), and follow the [upgrade guide](./hosting/maintenance).

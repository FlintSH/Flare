---
title: Feature explorer
description: Explore everything Flare can do, with practical guides for each capability.
---

# A home for your files. Built around you.

Flare brings uploads, previews, organization, and automation to your own server and domain. Start with the essentials; add the tools and settings that fit your workflow.

Filter the capabilities below, or [take a guided tour](./demos). Each card leads to a complete guide with instructions and important limits.

You can also open the handbook from **Documentation** in the **Settings** header, or choose **Setup guide** during first-run setup. Both open a new tab so your current form stays in place, selecting your stable release's archive or the published rolling handbook. Setup links for versions before 2.1.0 open the archive homepage with the original setup guidance. Other prerelease or unknown versions open the version selector.

Reading for a particular installation? [Browse dated documentation releases and compare changes](./versions). The public handbook defaults to the current stable release. The versions page also offers explicit access to the published rolling build's unreleased docs.

<FeatureExplorer />

## Choose your starting point

| You want to…                                                   | Start here                                                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up a personal file host                                    | [Docker Compose](./hosting/docker) → [first-run setup](./admin/setup)                                                                                                               |
| Run a shared instance                                          | [Roles and permissions](./admin/roles) → [users](./admin/users) → [email](./admin/email) → [backups](./hosting/maintenance)                                                         |
| Let people join a private instance                             | [Invite links](./guide/invites) → [who can invite](./admin/users#invite-links)                                                                                                      |
| Send screenshots straight to your domain                       | [Screenshot tools](./guide/screenshot-tools) → [upload profiles](./guide/upload-profiles)                                                                                           |
| Share a collection                                             | [Folders](./guide/folders) → [sharing and privacy](./guide/sharing)                                                                                                                 |
| Find an older upload in a large library                        | [Continuous scrolling and the date rail](./guide/library#scroll-through-your-library) → [recorded walkthrough](./demos#browse-a-large-library)                                      |
| Preview files inside large archives, extract, or package files | [Archives](./guide/archives) → [large-archive walkthrough](./demos#preview-files-in-a-large-archive)                                                                                |
| Sign in without giving the server your secret                  | [Passphrase and recovery phrase](./guide/passphrase) → [what it does not protect](./guide/passphrase#what-the-design-does-not-protect)                                              |
| Keep files unreadable to the server                            | [Encrypted and plain files](./guide/encryption) → [what the server still sees](./guide/encryption#what-the-server-still-sees) → [limits](./guide/encryption#what-does-not-work-yet) |
| Protect your sign-in                                           | [Two-factor authentication and passkeys](./guide/security)                                                                                                                          |
| Require a passkey instead of passphrase or SSO                 | [Passkey requirement and emergency recovery](./guide/security#require-a-passkey-for-sign-in)                                                                                        |
| Review sign-ins or sign out a lost device                      | [Login history and active sessions](./guide/account#login-history-and-active-sessions)                                                                                              |
| Investigate activity or a failed operation                     | [Instance audit log](./admin/audit)                                                                                                                                                 |
| Match your own brand                                           | [Appearance studio](./admin/appearance)                                                                                                                                             |
| Connect your own software                                      | [API](./api/) → [signed webhooks](./api/webhooks)                                                                                                                                   |
| Build a web app or PWA on top of your files                    | [Call Flare from a web app](./api/authentication#call-flare-from-a-web-app) → [`FLARE_CORS_ORIGINS`](./hosting/configuration#cross-origin-browser-access)                           |

## Know what you are choosing

Flare needs a running application server and PostgreSQL. Local storage also needs a persistent writable filesystem; S3 is an alternative file store. The **documentation** can run on a static host, but **Flare itself** cannot. Read the [deployment guide](./hosting/) before choosing infrastructure.

Private files are restricted to their owner and accounts with permission to read other users’ content. Accounts sign in with a [passphrase that the server never receives](./guide/passphrase), and files uploaded in the browser are [encrypted on your device](./guide/encryption) by default: the server stores ciphertext and the share link carries the key. Plain files, which include every upload from a screenshot tool or an API token, are readable by the operator, and several features do not work for encrypted files yet. See [sharing and privacy](./guide/sharing) for the exact rules, including passwords, folder links, and storage URLs.

These docs describe the source revision shown on the page. If a control is missing on an older installation, check the version in **Settings → General**, [open its documentation archive](./versions), review the release notes, and follow the [upgrade guide](./hosting/maintenance).

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

| You want to…                                      | Start here                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up a personal file host                       | [Docker Compose](./hosting/docker) → [first-run setup](./admin/setup)                                                                          |
| Run a shared instance                             | [Roles and permissions](./admin/roles) → [users](./admin/users) → [email](./admin/email) → [backups](./hosting/maintenance)                    |
| Send screenshots straight to your domain          | [Screenshot tools](./guide/screenshot-tools) → [upload profiles](./guide/upload-profiles)                                                      |
| Share a collection                                | [Folders](./guide/folders) → [sharing and privacy](./guide/sharing)                                                                            |
| Find an older upload in a large library           | [Continuous scrolling and the date rail](./guide/library#scroll-through-your-library) → [recorded walkthrough](./demos#browse-a-large-library) |
| Browse shared archives, extract, or package files | [Archives](./guide/archives)                                                                                                                   |
| Protect your sign-in                              | [Two-factor authentication and passkeys](./guide/security)                                                                                     |
| Require a passkey instead of password or SSO      | [Passkey requirement and emergency recovery](./guide/security#require-a-passkey-for-sign-in)                                                   |
| Review sign-ins or sign out a lost device         | [Login history and active sessions](./guide/account#login-history-and-active-sessions)                                                         |
| Investigate activity or a failed operation        | [Instance audit log](./admin/audit)                                                                                                            |
| Match your own brand                              | [Appearance studio](./admin/appearance)                                                                                                        |
| Connect your own software                         | [API](./api/) → [signed webhooks](./api/webhooks)                                                                                              |

## Know what you are choosing

Flare needs a running application server and PostgreSQL. Local storage also needs a persistent writable filesystem; S3 is an alternative file store. The **documentation** can run on a static host, but **Flare itself** cannot. Read the [deployment guide](./hosting/) before choosing infrastructure.

Private files are restricted to their owner and accounts with permission to read other users’ content. This is a self-hosted sharing application, not an end-to-end encrypted vault. See [sharing and privacy](./guide/sharing) for the exact rules, including passwords, folder links, and storage URLs.

These docs describe the source revision shown on the page. If a control is missing on an older installation, check the version in **Settings → General**, [open its documentation archive](./versions), review the release notes, and follow the [upgrade guide](./hosting/maintenance).

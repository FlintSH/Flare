---
title: Feature explorer
description: Explore everything Flare can do, with practical guides for each capability.
---

# A home for your files. Built around you.

Flare brings uploads, previews, organization, and automation to your own server and domain. Start with the essentials; add the tools and settings that fit your workflow.

Filter the capabilities below, or [take a guided tour](./demos). Each card leads to a complete guide with instructions and important limits.

<FeatureExplorer />

## Choose your starting point

| You want to…                             | Start here                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Set up a personal file host              | [Docker Compose](./hosting/docker) → [first-run setup](./admin/setup)                              |
| Run a shared instance                    | [Users and permissions](./admin/users) → [email](./admin/email) → [backups](./hosting/maintenance) |
| Send screenshots straight to your domain | [Screenshot tools](./guide/screenshot-tools) → [upload profiles](./guide/upload-profiles)          |
| Share a collection                       | [Folders](./guide/folders) → [sharing and privacy](./guide/sharing)                                |
| Return to a favorite library search      | [Saved views](./guide/saved-views) → [image browsing](./guide/library#inspect-images)              |
| Match your own brand                     | [Appearance studio](./admin/appearance)                                                            |
| Connect your own software                | [API](./api/) → [signed webhooks](./api/webhooks)                                                  |

## Know what you are choosing

Flare needs a running application server and PostgreSQL. Local storage also needs a persistent writable filesystem; S3 is an alternative file store. The **documentation** can run on a static host, but **Flare itself** cannot. Read the [deployment guide](./hosting/) before choosing infrastructure.

Private files are restricted to their owner and administrators. This is a self-hosted sharing application, not an end-to-end encrypted vault. See [sharing and privacy](./guide/sharing) for the exact rules, including passwords, folder links, and storage URLs.

These docs describe the source revision they are built with. If a control is missing on an older installation, check the version in **Settings → General**, review the release notes, and follow the [upgrade guide](./hosting/maintenance).

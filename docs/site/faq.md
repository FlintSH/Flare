---
description: Answers to common questions about hosting Flare, privacy, sharing, and integrations.
---

# Frequently asked questions

## Can I host Flare on a static website platform?

Flare needs a persistent Node.js server, PostgreSQL, and file storage. A host must support that application model, including background workers. The docs site is static and can be hosted independently. [Choose your deployment](./hosting/).

## Do I need an S3 bucket?

No. Local storage is a good starting point for a single server. Mount a persistent uploads volume and back it up alongside the database. S3-compatible storage is an alternative, not a requirement. [Compare storage options](./hosting/storage).

## Is a public file listed for everyone?

“Public” controls access through its URL; it does not create a public instance directory. Anyone who obtains the file URL can access it unless a password is required. Putting it in a shared folder also exposes it on that folder’s page. [Sharing and privacy](./guide/sharing).

## Can I share a private file by giving someone its password?

No. A private file requires the signed-in owner with `files.read`, or a person with `content.read`. To share with a password, use a public file and add password protection. A folder share never lists private files.

## Does deleting a folder delete its files?

No. Files and subfolders move up a level; top-level files become unfiled. If the parent folder is shared, moved public files can become visible through that parent’s link. [Folder removal](./guide/folders).

## Why are screenshot uploads using unexpected settings?

Account defaults are overlaid by a selected upload profile, then permitted request overrides. A generated tool configuration can select a specific profile, and a named token can be bound to one. Review **Profile → Uploads** and the configuration that your tool actually uses. [Upload profiles](./guide/upload-profiles).

## Can one API token administer the entire instance?

Named tokens support file upload/listing and short-link operations through four scopes. They do not grant account, user, integration, or instance administration. Administrator ownership does not expand a named token’s scope. Each request also needs the owner’s current role permission. [API authentication](./api/authentication).

## Does file.ready mean OCR is finished?

No. The event means the file has been finalized. Optional OCR can finish later. Webhooks deliberately exclude file contents and OCR text. [Webhook contract](./api/webhooks).

## Does an account export replace a server backup?

No. It is an account download, not a full database snapshot. It can skip unavailable files and does not preserve all server configuration or newer organizational data. Keep coordinated database and storage backups, plus the secrets needed to decrypt credentials. [Backup and restore](./hosting/maintenance).

## Can I change from local storage to S3 later?

The setting can change, but switching it does not copy existing data. Existing files depend on the active provider. Plan and verify a storage migration before changing production settings. [Storage guide](./hosting/storage).

## Can I use SSO with an existing local account’s email?

Matching email addresses do not link accounts. Flare identifies SSO users by issuer and subject, and has no explicit local-account linking flow. Keep a working local administrator login. [Single sign-on](./admin/sso).

## Where do I get help?

Start with [troubleshooting](./hosting/troubleshooting). For a reproducible problem, [open a GitHub issue](https://github.com/FlintSH/Flare/issues) with your version, deployment method, and sanitized logs. For community discussion, [join Discord](https://discord.gg/mwVAjKwPus). Never include tokens, signing secrets, SMTP passwords, database URLs with credentials, or real private files.

## Can I create moderators without giving full administration?

Yes. [Create a role](./admin/roles) with the relevant account/content permissions and assign it in Users. Everyone and additional roles combine additively; there are no explicit deny rules. Delegated role and account management obey hierarchy, while Administrator grants every permission.

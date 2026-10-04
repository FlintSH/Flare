---
title: Documentation versions and changes
description: Read the documentation for a dated Flare release and compare what changed between releases.
---

# Documentation versions and changes

The public handbook opens on the **current stable release**. Find your installed Flare version in **Settings → General → Instance Information**, then choose the matching documentation below or use **Documentation release → View docs** on any page. Ask your instance administrator for the version if you cannot open Settings. Development changes appear in the stable handbook when they ship in a stable release; the rolling preview is available separately through an explicit link below.

<VersionHistory />

## Read rolling docs

Choose **Open rolling docs (unreleased)** to read the guides for the current published rolling build. Its pages display **Rolling preview · Unreleased**, the exact source commit, and a banner explaining that these docs describe a rolling build. Use **Read stable docs** in that banner to return to the stable handbook.

The rolling preview lives at `/rolling/` below the website's base path, such as `/Flare/rolling/`. Opening that URL or choosing its link is required: the homepage always opens stable docs, and visiting rolling does not change the default. Rolling pages ask search engines not to index them; they are still public and can be opened by anyone with the URL.

The preview follows the commit identified by the published **Rolling Release**, after its Docker images have been published. It can lag behind `main` while a rolling build is running or after a failed build. Its update date comes from the rolling release's latest metadata update in UTC. `/rolling/` moves forward as rolling builds are published; it is not a permanent archive of every development commit. Rolling docs are separate from the dated stable archives and stable release comparisons. Check your rolling installation's commit against **Build details** before following its instructions.

<Screenshot
  src="/screenshots/handbook/docs-rolling.webp"
  alt="Rolling documentation page showing the unreleased notice, source commit and update date, and Read stable docs link"
  caption="A rolling guide in a local website preview. Every rolling page identifies its source and provides a direct return to stable docs."
/>

## Read an older release

Each entry shows its release date in UTC and links to its documentation and release notes. **View docs** opens the same page in that release when it exists, or the release's homepage otherwise. Bookmark its `/versions/vX.Y.Z/` URL to keep reading the same release after the default handbook moves forward. **Versions & changes** returns to this list from an archive.

The archives contain the documentation available in each release's Git tag. The full handbook starts with **2.1.0**. Version **2.0.0** includes its original README and nine earlier guides; older releases include their README only. These entries are labeled as legacy documentation. A missing guide means it did not exist in that release; newer instructions are not added to old archives.

Archived examples, screenshots, and instructions describe their original release. An old example using `latest`, an external badge, or a link to a third-party service may refer to something that has since changed. Use an explicit release image tag when reproducing an older installation, and read that release's upgrade notes before changing an existing server.

## See what changed

Under **Compare documentation**, choose **From release** and **To release**, then select **Show changes**. The comparison shows added and removed lines in the original documentation sources. For handbook releases, this includes the guides, interactive Vue components, and downloadable JSON contracts such as OpenAPI; legacy releases include their README and earlier guides. It can compare any two listed releases, in either direction. A page that moved can appear as a removed file and an added file.

This comparison helps you find changed instructions. Read the linked release notes and the relevant upgrade guide for application behavior, migrations, and compatibility requirements; a documentation edit alone does not establish those changes.

<Screenshot
  src="/screenshots/handbook/docs-versions.webp"
  alt="Flare documentation version browser with an explicit rolling link, dated stable releases, and From release, To release, and Show changes controls"
  caption="The release browser in a local website preview. Choose a dated release or compare two releases."
/>

## Understand dates and source details

The release date is when GitHub published the stable release. The source commit identifies the revision containing the documentation. The build date records when the website was generated; rebuilding an archive does not make it a new Flare release. Each page's version stamp and **Build details** expose its source information. If an older release tag differs from its original package version, the stamp shows both; neither value is rewritten. This archive guide and the browsing controls come from the website tooling revision recorded separately in **Build details**.

Local development previews describe the checked-out source and show **Uncommitted changes** when appropriate. They can be ahead of the published rolling preview. Other prereleases are not included in the stable archive list or published as rolling docs. Contributors can [build the complete release site locally](https://github.com/FlintSH/Flare/blob/main/docs/site/contributing.md#build-the-release-site).

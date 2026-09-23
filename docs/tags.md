# Tags

Tags are an optional way to find related files in your vault. Your Files still
opens with everything together. A file can have several tags; tagging never moves
it or changes its URL, visibility, or storage path. Tags and matching rules are
private to your account, including on public files.

## Everyday use

- Open a file’s menu and choose **Edit tags**. Search for a tag, or type a name to
  create one. Changes save as you make them.
- To tag several files, choose **Select**, select files or the current page, then
  **Edit tags**. A partially checked tag belongs to some selected files; clicking
  it adds it to all. Other tags are preserved.
- Use **Tags** beside the file filters, or click a tag on a file. Search, sorting,
  dates, and image browsing keep working within that selection. **All files**
  clears the tag filter; **Reset filters** clears every filter. **Untagged** helps
  find files without any tags.
- Choose **Tags → Manage tags** to rename or delete a tag. Deleting a tag leaves
  every file intact and removes that tag from upload profiles.

## Automatic tags

In a tag’s editor, turn on **Add automatically**, then choose **File name** or
**Extracted text** and a phrase to match. Matching ignores capitalization and
interprets punctuation literally. These rules run locally; no AI service or
external account is needed.

File name rules run when an upload is saved, against the original display name,
even when its URL is randomized. Extracted text rules run when OCR completes on
an image. Automatic OCR must be enabled in Settings, or use the file menu’s
**Extract text (OCR)** action. This does not add OCR support for PDFs or other
file types.

Rules apply to new uploads or newly extracted text. After saving a rule, use
**Apply rule to existing files…** in its editor to tag matching older files. This
uses text already extracted; it does not start OCR for the entire vault.
Changing or disabling a rule leaves existing tags in place.

If tag application is temporarily unavailable, the extracted text stays saved.
Flare remembers the unfinished work and retries it in the background, including
after a restart. Opening the extracted text also retries pending tags without
running OCR again.

You stay in control: removing an automatic tag is remembered for that file.
Background processing and applying rules to older files will not add it back.
You can add it again manually at any time.

Upload profiles have an optional **Tags** selection. Those tags apply to uploads
using that profile, including supported external tools, chunked uploads, and
pastes. A profile-bound token keeps its profile’s tag choices. Exported profile
recipes contain account-specific tag IDs; imports must reference tags owned by
the importing account.

## Design and migration notes

This implements the tagging direction discussed in issue #126 while keeping the
existing vault as the home. It adds no folder hierarchy, alternate file view,
sidebar, color system, or compulsory filing step. Tags appear on files only after
they have been assigned; automatic rules are tucked into the tag editor.

PR #179 was reverted, and its migration was removed from the repository, but
some databases still contain its Folder, Tag, and FileTag tables. This feature
uses VaultTag and VaultFileTag tables so both fresh databases and those upgraded
from that attempt can migrate without collisions. Retired tables and their data
are left untouched; old tags are not imported automatically.

---
title: Tags and automatic organization
description: Label related files, tag a selection in bulk, and automatically organize uploads by filename or extracted image text. Tag names and rules are encrypted, and rules run in your browser.
---

# Tags and automatic organization

Viewing tags in your library uses `files.read`. Creating tags/rules and applying tags requires `tags.manage`; changing tags on existing files or applying rules to existing files also needs `files.update`. Automatic background filename/OCR rules remain saved configuration and keep running after a role grant is removed; edit or remove those rules explicitly to stop them. Ask an administrator to review your [roles](/admin/roles) if the relevant action is unavailable.

Tags let a file belong to several topics without duplicating or moving it. A screenshot might have **Website**, **Bug report**, and **Release 2** tags while staying in its project folder.

Tags, automatic matching rules, and tag names belong to your account. They are not listed on public file pages or shared folders, and they do not change file access or URLs.

## Tag names and rules are encrypted

Your browser seals each tag's name and rule with a key from your account key. The server stores the sealed record and the links between tags and files. It knows how many tags you have, which file has which tag, and that you removed a tag from a file by hand. It does not know a tag's name, or whether it has a rule.

- **Your keys must be unlocked to create or edit tags and to see their names.** While they are locked, tags show as **Encrypted tag**. Filtering by a tag still works, because the filter uses the tag's ID.
- **Tags you had before this release are converted the first time you unlock.** Your browser seals each name and rule and the server deletes the plain ones. Tags keep their IDs, so files, upload profiles and bookmarked filters keep working.
- **Your browser refuses a second tag with the same name.** The server cannot compare sealed names. Two browsers saving the same name at the same moment can both succeed; delete one of the tags.
- People with `audit.read` see tag IDs and change metadata in the [instance audit log](/admin/audit), not names. When your browser encrypts a tag from before encryption, Flare also removes its name from the audit records it wrote earlier. Database backups made before that still hold it.
- An API request cannot create or change a tag for an account that has keys. See the [API reference](../api/files#tags-with-keys).

<Screenshot src="/screenshots/timeline/library-desktop.webp" alt="The continuous file library with tags shown beneath individual file previews" caption="Labels add context to your library without changing where a file lives." />

## Add a tag to a file

1. In **Files**, open the file menu and choose **Edit tags**.
2. Search for an existing tag, or type a name to create one.
3. Wait for the current assignments to load, then select the tags you want. Changes save as you make them.

Tag names can be up to 40 characters. Use short names that will make sense when you see them on a file card, such as **Invoices**, **Design**, or **Reference**. Flare trims the ends of a name and saves each run of spaces, tabs, or line breaks as one space. Names that differ only in letter case are the same tag: with **Work** saved, creating **work** reports that you already have a tag with that name. The search in **Edit tags** compares names the same way, spaces included: `Work ` with a trailing space, or `work  notes` with two spaces, lists the existing tag. Earlier versions showed nothing for the first and offered to create the second again.

<Screenshot src="/screenshots/timeline/library-tags.webp" alt="Edit tags showing Favorites unchecked after another client removed it from a selected file and the library was refreshed" caption="The editor reads current assignments before showing checked, unchecked, or mixed tags." />

## Tag several files together

Choose **Select**, select individual files or **Select visible files**, and open **Edit tags**. Flare first refreshes the selected files’ details, including files outside the visible window. If that check fails, the editor stays closed; retry the action, or choose **Done** and select again if a file is no longer available.

<Screenshot src="/screenshots/timeline/library-refreshed-tags.webp" alt="Edit tags for the selected Alpine morning file showing Favorites unchecked after reloading its current tag membership" caption="After another client removes Favorites, opening Edit tags shows its current unchecked state, including when the selected card is outside the visible window." />

You can keep up to 100 files selected while scrolling through the library. **Select visible files** adds loaded cards currently on screen; it does not select all matching files. Changing a filter, folder, sort, or grouping clears the selection, so finish the current batch before changing the view.

Opening **Edit tags** reads the current assignments for every selected file, including files that have scrolled off screen. If another tab or client changed a tag after you selected a file, the editor reflects that change before enabling edits. A checked tag belongs to every selected file; clicking it removes the tag from the selection. An unchecked or partially checked tag is added to all selected files when clicked.

While assignments load, wait for the tag choices to appear. If loading fails, choose **Retry loading file tags**. If a selected file was deleted or is no longer available, close the editor, refresh the library, and select the remaining files again. Closing the editor clears the selection. Other clients can still change tags while the editor is open; close it, reselect the files, and reopen **Edit tags** to read their latest changes.

This works well after a one-off upload batch. For a recurring source, let an upload profile or an automatic rule do the labeling.

## Find files by tag

Choose **Tags** beside the library filters, or click a tag on a file. On a phone, first open **Filters** to reveal **Tags**. The selected tag stays visible as a chip below search even when the filter controls are closed; choose its **×** to clear only that tag. A [file card](./library#read-a-file-card) shows up to two tags, or one tag beside its folder name; choose **+N** to see the rest when your role can edit tags. Search, dates, sorting, folders, and image browsing continue to work inside that tag selection. [Continuous scrolling and the date rail](./library#scroll-through-your-library) cover every matching file with that tag.

- Choose **Untagged** to find files without tags.
- Choose **All files** in the tag filter to clear the tag selection.
- Choose **Reset filters** to clear the other filters too; your current folder remains selected.

Tags filter your own library. A bookmarked tagged view is not a public collection link. Use a [shared folder](./folders#share-a-folder) when you want to give another person a browsable collection.

## Rename and remove tags

Open **Tags → Manage tags** to edit the tag list. Renaming updates the label wherever that tag is used. Deleting a tag removes the label from files and upload profiles while keeping all files intact.

Deleting a tag also removes its matching rule. Disabling a rule without deleting the tag leaves existing assignments in place.

## Automatic tags

In the tag editor, enable **Add automatically**, select a source, and enter a phrase. Each tag can have a rule that looks for a literal phrase in one source:

| Source             | When it runs                                                          | Example                                                          |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **File name**      | In your browser, when you upload, using the file's original name.     | Match `invoice` to tag `invoice-september.pdf`.                  |
| **Extracted text** | In your browser, after the text of an image is read or first arrives. | Match `Order number` to tag a screenshot containing that phrase. |

### Rules run in your browser

A rule is sealed, so the server cannot read it, and the name and text of an encrypted file are sealed too. Only your browser has all of them, so your browser applies the rules. This is a change: the server used to apply them the moment an upload arrived.

- **Uploads from this browser** are tagged as they upload. The upload request carries the IDs of the tags that matched, never the rule.
- **Uploads from a screenshot tool, a script or another device without your keys** are tagged the next time you open Flare with your keys unlocked. Until then the file is in your library without its automatic tags. A status at the edge of the page reads **Finishing new files** while your browser catches up.
- **Plain files** follow the same rule. The server can read a plain file's name, but not your rule, so your browser tags plain files as well.
- If Flare stays open in a tab, it looks for new files to tag about once a minute and whenever you return to the tab.

Matching ignores capitalization. Punctuation is literal: `invoice-2026` looks for that phrase, and `*.png` does not mean “all PNG files.” Rules do not use wildcards, regular expressions, or an external AI service.

Randomized URLs do not prevent filename rules from working. The rule checks the upload's original display name, not its randomized URL name.

<Screenshot src="/evidence/vault-tags/automatic-rule.jpg" alt="Receipts tag configured to automatically match filenames containing receipt" caption="Automatic rules match a literal phrase in a filename or extracted image text." />

::: details Try a filename rule
Create a tag called **Receipts**, turn on automatic matching, and choose **File name** with the phrase `receipt`. Upload `receipt-coffee.png` and `meeting-notes.txt`. The first receives the tag; the second does not. Uploading `RECEIPT-travel.pdf` matches too, because capitalization is ignored.
:::

::: details Try a rule based on image text
Create **Support request** with an **Extracted text** rule for `ticket number`. Upload a screenshot containing those words, then choose **Extract text (OCR)** from its file menu. After OCR completes, matching text adds the tag. This depends on the recognition result: blurry or stylized text may not be read accurately.
:::

### Apply a rule to older files

Saving a rule affects new uploads or newly extracted text. To include older files, save the rule, then choose **Apply rule to existing files…** in its editor.

Your browser does this work. It reads the names and the saved image text of your plain files from the server, opens the names and text of your encrypted files with your keys, matches the rule, and tells the server which files get the tag. The rule's text is not sent. For a library of tens of thousands of files this takes a while; keep the dialog open until it reports how many files were tagged.

For extracted-text rules, this checks text already saved by OCR. It does not start OCR across every image in your library. Extract text from an older image first if it has no saved OCR result.

### Keep manual control

Removing an automatically assigned tag from a file is remembered. Background work and **Apply rule to existing files…** will not put it back on that file. Add the tag manually if you change your mind.

Changing or turning off a rule does not remove tags already assigned. If you want to reorganize old files, adjust their labels explicitly.

If your browser cannot finish the work on a file, for example because the connection drops, the file stays marked and your browser tries again the next time it looks. After three failed tries Flare stops retrying that file by itself; choose **Apply rule to existing files…** to tag it once the cause is fixed.

## Apply tags with an upload profile

Choose tags in an [upload profile](./upload-profiles) to label every new upload made with that profile. This applies to browser uploads, pastes, chunked uploads, and supported external tools. A profile can select up to 20 tags.

Profiles are useful when a source identifies the topic more reliably than a filename: for example, a capture tool bound to a **Bug reports** profile can always assign **Support**.

Exported recipes include the selected tags' account-specific IDs. A recipe containing tags can be imported only when those tags still exist in the importing account. Remove the tag choices before exporting a recipe intended for somebody else.

## When a tag does not appear

Check the rule's source and phrase, then the timing. Filename rules apply to new uploads; older files need **Apply rule to existing files…**. A file from a screenshot tool gets its tags when you next open Flare with your keys unlocked, not when it arrives. Extracted-text rules require completed OCR, which supports images rather than PDFs. Also check whether you previously removed that tag from the file: Flare honors that manual choice.

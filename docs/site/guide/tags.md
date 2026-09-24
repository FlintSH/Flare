---
title: Tags and automatic organization
description: Label related files, tag a selection in bulk, and automatically organize uploads by filename or extracted image text.
---

# Tags and automatic organization

Tags let a file belong to several topics without duplicating or moving it. A screenshot might have **Website**, **Bug report**, and **Release 2** tags while staying in its project folder.

Tags, automatic matching rules, and tag names are private to your account. They are not listed on public file pages or shared folders, and they do not change file access or URLs.

<Screenshot src="/evidence/vault-tags/files.jpg" alt="File library with tags shown beneath individual files" caption="Labels add context to your library without changing where a file lives." />

## Add a tag to a file

1. In **Files**, open the file menu and choose **Edit tags**.
2. Search for an existing tag, or type a name to create one.
3. Select the tags you want. Changes save as you make them.

Tag names can be up to 40 characters. Use short names that will make sense when you see them on a file card, such as **Invoices**, **Design**, or **Reference**.

## Tag several files together

Choose **Select**, select files or the current page, and open **Edit tags**. A partially checked tag is assigned to some of the selected files. Selecting it adds it to all selected files while preserving their other tags.

This works well after a one-off upload batch. For a recurring source, let an upload profile or an automatic rule do the labeling.

## Find files by tag

Choose **Tags** beside the library filters, or click a tag on a file. Search, dates, sorting, folders, and image browsing continue to work inside that tag selection.

- Choose **Untagged** to find files without tags.
- Choose **All files** in the tag filter to clear the tag selection.
- Choose **Reset filters** to clear the other filters too; your current folder remains selected.

Tags filter your own library. A bookmarked tagged view is not a public collection link. Use a [shared folder](./folders#share-a-folder) when you want to give another person a browsable collection.

## Rename and remove tags

Open **Tags → Manage tags** to edit the tag list. Renaming updates the label wherever that tag is used. Deleting a tag removes the label from files and upload profiles while keeping all files intact.

Deleting a tag also removes its matching rule. Disabling a rule without deleting the tag leaves existing assignments in place.

## Automatic tags

In the tag editor, enable **Add automatically**, select a source, and enter a phrase. Each tag can have a rule that looks for a literal phrase in one source:

| Source             | When it runs                                                 | Example                                                          |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| **File name**      | When a new upload is saved, using its original display name. | Match `invoice` to tag `invoice-september.pdf`.                  |
| **Extracted text** | After OCR extracts text from an image.                       | Match `Order number` to tag a screenshot containing that phrase. |

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

For extracted-text rules, this checks text already saved by OCR. It does not start OCR across every image in your library. Extract text from an older image first if it has no saved OCR result.

### Keep manual control

Removing an automatically assigned tag from a file is remembered. Background work and **Apply rule to existing files…** will not put it back on that file. Add the tag manually if you change your mind.

Changing or turning off a rule does not remove tags already assigned. If you want to reorganize old files, adjust their labels explicitly.

If automatic tagging temporarily fails after OCR, Flare keeps the extracted text and retries the pending tag work in the background, including after a restart. Opening the saved extracted text also retries pending tags without repeating OCR.

## Apply tags with an upload profile

Choose tags in an [upload profile](./upload-profiles) to label every new upload made with that profile. This applies to browser uploads, pastes, chunked uploads, and supported external tools. A profile can select up to 20 tags.

Profiles are useful when a source identifies the topic more reliably than a filename: for example, a capture tool bound to a **Bug reports** profile can always assign **Support**.

Exported recipes include the selected tags' account-specific IDs. A recipe containing tags can be imported only when those tags still exist in the importing account. Remove the tag choices before exporting a recipe intended for somebody else.

## When a tag does not appear

Check the rule's source and phrase, then the timing. Filename rules apply to new uploads; older files need **Apply rule to existing files…**. Extracted-text rules require completed OCR, which supports images rather than PDFs. Also check whether you previously removed that tag from the file: Flare honors that manual choice.

---
title: Your file library
description: Scroll through every file, jump through your upload history, combine filters, and manage your library.
---

# Your file library

Browsing your library requires `files.read`. File edits, sharing changes, and deletion use the separate `files.update`, `files.share`, and `files.delete` permissions. Bulk actions follow the same checks; missing actions may reflect your [roles](/admin/roles).

**Files** is your home for uploaded files and pastes. Each card brings together a preview, filename, size, activity, and file actions. The library opens with all your files, newest first; organizing into folders or tags is optional.

Upgrading from 2.0? Check the [2.1 compatibility notes](/hosting/maintenance#upgrading-from-2-0-to-2-1) for plain copied links and URL-ID changes before updating saved links or custom clients. The dependency refresh keeps the filtering and viewer controls described here.

<Screenshot src="/screenshots/timeline/library-desktop.webp" alt="Flare's file library with an account-wide file count, search, folders, filters, and a grid of previews" caption="One continuous library includes every matching file, with the same search, folders, and file actions." />

## Scroll through your library

Scroll normally with your mouse, trackpad, or touch screen. More files load as you reach them, without a **Next page** button. You can browse every matching file without changing pages.

Flare keeps cards and nearby file data in a limited window around your position. Returning to an earlier part of a large library may briefly show loading placeholders while those files load again. The file count describes the whole filtered result, not just the cards currently on screen. Your browser's Find command only searches rendered content; use the library's search field to find files anywhere in your account.

With **Newest first** or **Oldest first**, a slim date rail on the right helps you stay oriented. Its date label appears while you scroll, hover, or focus it, then recedes when you finish. Click or drag along the rail to jump through the matching upload history. Flare loads files near your destination without first downloading every file you passed.

For very large libraries, the browser's own scrollbar follows the section you are browsing and extends as you continue. The date rail always covers the full matching history, so use it to jump straight to a distant date.

To use the rail from a keyboard, Tab to **Browse files by date**. Up/Down arrows move one row, Page Up/Page Down move farther, and Home/End go to the beginning or end. These follow the displayed order: with **Oldest first**, the beginning contains your oldest files. Normal page scrolling remains available on small screens.

<Screenshot src="/screenshots/timeline/library-date-jump.webp" alt="A historical section of the library with the right-hand date rail showing the upload period at the current scroll position" caption="Jump into your upload history while keeping the active search, folder, and filters." />

The date rail follows the files matching your current filters. Size, view-count, and download-count sorts keep continuous scrolling but do not show a chronological rail. The rail is hidden for short lists.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/timeline/library-mobile.webp" alt="The continuous file library on a narrow mobile screen with readable file cards and a date rail at the right edge" caption="The same library supports ordinary touch scrolling and date navigation on mobile." />
</div>

Watch the [recorded library walkthrough](/demos#browse-a-large-library) for a real scroll and date jump using demonstration files.

## Search and narrow the results

Type in the search field to find matches in filenames and extracted OCR text. Matching ignores capitalization. Search does not read the contents of every text file, PDF, or document: searchable content comes from image text that Flare has extracted.

Use the controls beside search to narrow the current library:

| Control         | Choices and behavior                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Folder**      | All files, Unfiled, or the direct contents of a folder. Opening a folder does not merge its subfolders' contents into the results.                        |
| **Tags**        | Choose a tag, return to all tags, or find untagged files.                                                                                                 |
| **Sort**        | Newest/oldest, largest/smallest, most/least viewed, or most/least downloaded.                                                                             |
| **Visibility**  | Public, private, and password-protected. Multiple checked choices are alternatives: public plus password-protected includes files matching either choice. |
| **File type**   | Select the MIME types present in your library. These are grouped into images, videos, audio, documents, and other files.                                  |
| **Upload date** | Choose a date range and optionally group results by week, month, or year.                                                                                 |

Separate controls combine. For example, a folder, an image type, and a search phrase narrow results to matching images in that folder. Visibility is the notable exception within its own menu: checking multiple values includes any selected value.

**Reset filters** clears search, tags, dates, types, visibility, sorting, and grouping while keeping the folder you are browsing. To leave the folder too, choose **All files** in the folder browser.

The page address includes your filters. Bookmark it to return to the same view; browser Back and Forward restore the controls along with the results. Scrolling does not add a browser-history entry or save an exact position in the URL. The URL is a view of your signed-in library, not a public share link.

If you follow a file's link from the library, browser Back restores your previous position in that list. This position belongs to the current browser-history entry; a copied URL or bookmark keeps the filters without carrying your scroll position.

Existing bookmarks with `page` and `limit` still open near the corresponding file in the continuous list. Additions, deletions, or different filters can change which file occupies that position. After an upgrade, your files, folders, tags, and saved filters need no conversion.

## Browse by date

Open **Upload date → Group files** to choose **By week**, **By month**, or **By year**. Grouping works with **Newest first** and **Oldest first**. Choosing a size or activity sort turns date grouping off; enabling grouping from those sorts returns to newest first.

Grouping adds headings to the continuous list and adjusts the date rail to the same period. Upload dates use your browser's time zone; weeks begin on Monday. Without grouping, the rail shows the upload month. Grouping changes presentation without moving files or changing their upload dates.

## Inspect images

Open an image preview to browse it in the full-screen viewer. The image sequence respects the active folder, search, tags, sorting, and other filters, including images beyond the cards currently loaded in the library. Other file types are skipped in that image sequence.

| Action                 | How                                        |
| ---------------------- | ------------------------------------------ |
| Previous or next image | Arrow controls, Left/Right keys, or swipe. |
| Zoom                   | Plus/Minus controls or `+` / `-`.          |
| Pan a zoomed image     | Drag, or use Shift with an arrow key.      |
| See the whole image    | Choose **Fit**, or press `0`.              |
| Close                  | Choose the close button or press Escape.   |
| Download               | Use the download control when available.   |

If an image disappears from the filtered results while you browse, Flare may ask you to choose another image. If a next image fails to load, check your connection and retry.

<Screenshot src="/screenshots/timeline/library-image-viewer.webp" alt="Full-screen image viewer opened from the continuous library, with navigation and zoom controls" caption="Open any loaded image and continue through the filtered collection beyond the visible cards." />

## Work with a file

Open the card's menu for the full action list. On a desktop, preview actions also appear on hover or keyboard focus; the menu keeps the same actions available on touch screens.

- **Open file:** open its share/viewer page.
- **Copy link:** copy its share-page URL.
- **Download file:** save a copy to your device.
- **Browse archive:** inspect supported archive contents, download an entry, or extract into a new folder. See [archives](./archives).
- **Edit tags:** add or remove private organizational labels.
- **Move to folder:** change its library location without changing the file link.
- **Change visibility:** switch between public and private.
- **Add password / Manage password:** protect, replace the password, or remove password protection.
- **Manage expiration:** schedule deletion or a change to private, or remove the schedule.
- **Extract text (OCR):** read text from an image.
- **Delete file:** permanently remove the file after confirmation.

The card menu and the buttons shown when you hover a file follow the same permissions. **Change visibility** and **Add password / Manage password** require `files.share`; **Manage expiration** requires `files.update`. Neither grant implies the other: a person allowed to share can manage passwords without file-edit permission, and a person allowed to edit can open expiration controls without sharing permission. Scheduling **Delete** still additionally requires `files.delete`, and **Set to private** requires `files.share`.

<Screenshot src="/screenshots/roles/share-only-menu.webp" alt="File menu for an account with sharing permission showing Add password and Change visibility, without Manage expiration" caption="Sharing permission makes password controls available independently of file-edit permission." />

<Screenshot src="/screenshots/roles/edit-only-menu.webp" alt="File menu for an account with file-edit permission showing Manage expiration, without password or visibility actions" caption="File-edit permission opens expiration controls; each scheduled action still needs its own permission." />

## Work with several files

Choose **Select**, then select individual cards or **Select visible files**. The latter selects loaded cards currently on screen, up to the selection limit; it does not select your whole library or files loaded just beyond the screen. Scroll to add files from another part of the library. Your selection stays selected as cards leave the screen, and the selection bar remains available while you scroll.

You can select up to **100 files** at a time, then choose **Edit tags**, **Move**, or **Create archive**. Deselect individual files to make room, or finish the current batch before starting another. Changing the search, filters, folder, sort, or grouping clears the selection. **Done** leaves selection mode and clears it too.

**Edit tags** reloads current tag assignments for the whole selection before enabling edits, including selected files outside the visible window. See [bulk tagging](./tags#tag-several-files-together) for checkbox meanings and loading recovery.

<Screenshot src="/screenshots/timeline/library-selection.webp" alt="Library selection mode with Select visible files, a selected-file count, Move, Edit tags, Create archive, and Done controls" caption="Keep a selection while scrolling; bulk actions apply to the selected files, up to 100 at a time." />

With `files.read` and `files.upload`, **Create archive** packages up to 100 selected owned files into a new ZIP or TAR.GZ. It defaults to private/no expiration; explicitly choosing an upload profile applies that profile’s settings. Saving into a folder also requires `folders.manage`. The originals remain unchanged; [archive limits and defaults](./archives#create-an-archive-from-selected-files) apply separately from ordinary uploads.

## Read text in images with OCR

For an image, choose **Extract text (OCR)**. Flare processes the image on the server and opens the extracted text; use the dialog's copy action to reuse it. OCR can make screenshots searchable and can trigger [automatic tag rules](./tags#automatic-tags).

If the administrator enables automatic OCR, images can be processed after upload without a manual request. Upload completion does not mean OCR has completed. Manual extraction remains useful when automatic processing is disabled.

<Screenshot src="/screenshots/workspace/files-ocr.png" alt="Dialog showing text extracted from an image" caption="OCR makes text inside an image available to copy and search." />

OCR supports images, not a general PDF or office-document indexing workflow. Results depend on legibility, resolution, and the recognition language. Review extracted text before using it as an exact transcription. Flare's current OCR worker uses English recognition.

## Understand activity and refresh

Cards show view and download counts, and those counts can drive sorting. They measure access activity, not verified unique people. Treat them as useful signals rather than audience analytics.

Use **Refresh files** to fetch the latest results. Uploads completed through the dashboard drop overlay also refresh an open library. Files can move within a sorted list when uploads, deletions, or activity change its order.

If a section fails to load, choose **Retry** after checking your connection. If it still fails after files were changed in another tab or client, choose **Refresh files** to rebuild the current view. Flare keeps the active search and filters. Loading placeholders and a failed request do not mean that files have been deleted.

::: details A file seems to have disappeared
Choose **All files**, then **Reset filters**. A move, tag edit, or visibility change can remove a file from a filtered view; your unfiltered library still includes your private files. If it uploaded under a different account or was permanently deleted, including by an expiration, it will not appear in this account's library. A failed results request shows a retry state; it does not mean your files were deleted.
:::

::: details A file downloads but has no preview
Storage and browser preview support are separate. Flare previews common images, media, PDFs, text, code, and CSV. Unsupported formats remain downloadable. Browser codec support can also prevent playback even when the upload succeeded.
:::

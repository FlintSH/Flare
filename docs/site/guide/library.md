---
title: Your file library
description: Search filenames and extracted text, combine filters, browse images, and manage files from one library.
---

# Your file library

Browsing your library requires `files.read`. File edits, sharing changes, and deletion use the separate `files.update`, `files.share`, and `files.delete` permissions. Bulk actions follow the same checks; missing actions may reflect your [roles](/admin/roles).

**Files** is your home for uploaded files and pastes. Each card brings together a preview, filename, size, activity, and file actions. The library opens with all your files; organizing into folders or tags is optional.

Upgrading from 2.0? Check the [2.1 compatibility notes](/hosting/maintenance#upgrading-from-2-0-to-2-1) for plain copied links and URL-ID changes before updating saved links or custom clients. The dependency refresh keeps the filtering and viewer controls described here.

<Screenshot src="/evidence/vault-folders/all-files.jpg" alt="All files with folder navigation, tag filtering, and image and document cards" caption="All files keeps your library together, with optional folders and tags for organization." />

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

The page address includes your filters and page selection. Bookmark it to return to the same view; browser Back and Forward restore the controls along with the results. The URL is a view of your signed-in library, not a public share link.

## Browse by date

Open **Upload date → Group files** to choose **By week**, **By month**, or **By year**. Grouping works with **Newest first** and **Oldest first**. Choosing a size or activity sort turns date grouping off; enabling grouping from those sorts returns to newest first.

<Screenshot src="/screenshots/image-gallery/files-by-month.png" alt="Flare file library grouped by upload month" caption="Date grouping creates a visual timeline without moving or changing files." />

## Inspect images

Open an image preview to browse it in the full-screen viewer. The image sequence respects the active folder, search, tags, sorting, and other filters, including navigation beyond the current page of results. Other file types are skipped in that image sequence.

| Action                 | How                                        |
| ---------------------- | ------------------------------------------ |
| Previous or next image | Arrow controls, Left/Right keys, or swipe. |
| Zoom                   | Plus/Minus controls or `+` / `-`.          |
| Pan a zoomed image     | Drag, or use Shift with an arrow key.      |
| See the whole image    | Choose **Fit**, or press `0`.              |
| Close                  | Choose the close button or press Escape.   |
| Download               | Use the download control when available.   |

If an image disappears from the filtered results while you browse, Flare may ask you to choose another image. If a next image fails to load, check your connection and retry.

<Screenshot src="/screenshots/image-gallery/image-viewer.png" alt="Full-screen image viewer with navigation and zoom controls" caption="Browse your filtered image collection and zoom in to inspect details." />

## Work with a file

Open the card's menu for the full action list. On a desktop, preview actions also appear on hover or keyboard focus; the menu keeps the same actions available on touch screens.

- **Open file:** open its share/viewer page.
- **Copy link:** copy its share-page URL.
- **Download file:** save a copy to your device.
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

Use **Select** to work with multiple files. Select individual items or the current page, then **Edit tags** or **Move**. Selecting a page applies to the files on that page, not every result in your library.

## Read text in images with OCR

For an image, choose **Extract text (OCR)**. Flare processes the image on the server and opens the extracted text; use the dialog's copy action to reuse it. OCR can make screenshots searchable and can trigger [automatic tag rules](./tags#automatic-tags).

If the administrator enables automatic OCR, images can be processed after upload without a manual request. Upload completion does not mean OCR has completed. Manual extraction remains useful when automatic processing is disabled.

<Screenshot src="/screenshots/workspace/files-ocr.png" alt="Dialog showing text extracted from an image" caption="OCR makes text inside an image available to copy and search." />

OCR supports images, not a general PDF or office-document indexing workflow. Results depend on legibility, resolution, and the recognition language. Review extracted text before using it as an exact transcription. Flare's current OCR worker uses English recognition.

## Understand activity and refresh

Cards show view and download counts, and those counts can drive sorting. They measure access activity, not verified unique people. Treat them as useful signals rather than audience analytics.

Use **Refresh** to fetch the latest results. Uploads completed through the dashboard drop overlay also refresh an open library. Pagination limits what is loaded at once, which keeps larger libraries usable.

::: details A file seems to have disappeared
Choose **All files**, then **Reset filters**. Check whether the file was moved, made private, or given an expiration. If it uploaded under a different account or was permanently deleted, it will not appear in this account's library. A failed results request shows a retry state; it does not mean your files were deleted.
:::

::: details A file downloads but has no preview
Storage and browser preview support are separate. Flare previews common images, media, PDFs, text, code, and CSV. Unsupported formats remain downloadable. Browser codec support can also prevent playback even when the upload succeeded.
:::

---
title: Your file library
description: Scroll through every file, jump through your upload history, combine filters, and manage your library.
---

# Your file library

Browsing your library requires `files.read`. File edits, sharing changes, and deletion use the separate `files.update`, `files.share`, and `files.delete` permissions. Bulk actions follow the same checks; missing actions may reflect your [roles](/admin/roles).

Initial file placeholders expose a named **Loading files** busy status for assistive technology while the library request is pending.

**Files** is your home for uploaded files and pastes. Each card brings together a preview, filename, size, activity, and file actions. The library opens with all your files, newest first; organizing into folders or tags is optional. The folder directory starts collapsed until you choose to keep it open on this device so your files stay close to search. Choose **Folders** and its count to browse it; **All files** and **Unfiled** stay available without expanding it. On phones, expand the directory to find **New folder** when folders already exist; the labeled **New folder** button stays beside navigation when the directory is empty. Inside a folder, the directory is named **Subfolders** and its path stays visible. Long folder directories scroll within their own region.

On a phone, **Select** and refresh sit beside the title when there is room, and the file count sits below it above search. **Select** changes to **Done** while you are selecting files. Enlarged text can wrap those actions onto another line. Large counts use a short form such as **1.2K**; the count's tooltip and assistive technology retain the exact value. The introductory sentence is omitted on phones to keep the search, sort, folder navigation, and first file closer together.

Upgrading from 2.0? Check the [2.1 compatibility notes](/hosting/maintenance#upgrading-from-2-0-to-2-1) for plain copied links and URL-ID changes before updating saved links or custom clients. The dependency refresh keeps the filtering and viewer controls described here.

<Screenshot src="/screenshots/timeline/library-desktop.webp" alt="Flare's file library with an account-wide file count, search, folders, filters, and a grid of previews" caption="One continuous library includes every matching file, with the same search, folders, and file actions." />

## Choose a view

Use **Gallery** or **List** beside the library title; on a phone, open **View** and choose the checked presentation there. The View button’s accessible name and tooltip also name the current choice. Gallery is the default and keeps image previews large enough to scan. List gives each file its own compact row with a small thumbnail or kind icon, its complete filename, quiet metadata, labels, and **Manage file**. Desktop List rows use the same columns even when a file has no labels. On a phone or with enlarged text, names and metadata wrap naturally; rows grow instead of cutting off text. The controls can wrap below the title on a narrow screen.

Your choice is remembered only in this browser, separately for each account. It does not change another device, the instance appearance, public share pages, or your search/filter URL. Other open tabs keep the view they already show; the saved choice applies when they load again. If the saved choice cannot be read, Flare starts with Gallery. If saving fails, the current tab can still change views, but a later visit may return to the previously saved choice. Changing accounts loads that account’s choice, with Gallery as its default.

Both views keep the same order, filters, date grouping, selection, and permitted file actions. At the top, changing views keeps the page at the top and the toolbar visible. When you are already scrolled into the library, a layout change keeps the file rank currently being browsed; a file can move to a different row in Gallery. The View controls are in the toolbar at the top, so scroll back there to use them. Browser Back still restores the saved library file rank using your current view, including after loading a view choice saved from another tab. List uses one file per measured row, so the date rail follows those rows rather than Gallery’s columns. A wide Gallery can show more files at once than List; List favors reading filenames and metadata in sequence.

In List, choose the filename or image thumbnail to open the file. Use **Manage file** for copy, download, and other permitted actions; duplicate image hover shortcuts are omitted in this view. Keyboard focus does not expand a List row into an extra shortcut band. Touch primary links, selection, label controls, and Manage keep at least 44px targets. List selection replaces the leading preview/icon with its checkbox while the type remains in the metadata.

<Screenshot src="/screenshots/refinement/library-list-desktop.png" alt="Desktop List view with complete filenames, aligned metadata and labels, and a Manage file button for each row" caption="List keeps filenames and file facts in a consistent reading order." />

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/refinement/library-list-mobile.png" alt="Phone List view with small previews, wrapped filenames, visibility, labels, and individual file menus" caption="Phone rows grow to show each filename and its metadata without truncation." />
</div>

## Read a file card

At the standard text size, Gallery image previews are 112px high with a mouse or touch phone, and 128px on touch layouts at least 640px wide. Thumbnails are cropped to fit; open one to see the full image. Files without an image preview use a compact heading with a file-kind icon, a filename link, and **Manage file**. They have no separate preview stage. Their footer brings together a readable type such as **Markdown**, visibility, upload age, size, and activity; it wraps when the available width or enlarged text needs more room. A row of documents takes less vertical space than a row of images. Every card keeps its filename, size, activity, and permitted actions.

Every Gallery card starts with its complete filename, so you can scan identities across a mixed row before inspecting previews. List places the same complete name beside its thumbnail or kind icon. Names wrap naturally instead of shortening in the middle; long names can make a card and its row taller. This layout also applies to existing libraries. Cards end after their own labels and activity counts; documents and other files without image previews no longer stretch into empty bodies. In Gallery, the next row follows the tallest card in the current row, preserving chronological reading order rather than packing shorter cards into another column. List has one file per row. Rows containing only generic files can be shorter. Enlarged text can grow headings and labels while image previews keep their compact height. Loading placeholders use the selected view’s filename, preview, label, and activity slots while the file kind is unknown; Flare measures the rendered rows again when loaded files replace placeholders, as well as when text size or column widths change.

A file without an image preview shows an icon beside its filename for its kind: video, audio, text or PDF, code, table for CSV and spreadsheets, archive, or a plain file. The icon follows the same rules as the [share page viewer](./sharing#what-recipients-can-preview), so a CSV file or archive saved under a generic type is recognized by its name, and **Users → More actions → View content** shows the same icons. A readable opaque strip on a Gallery image preview, or quiet text in a generic card’s footer, shows whether the file is **Public** or **Private** and how long ago you uploaded it. A password adds **password protected** after that visibility, so a protected file still explicitly says whether it is Public or Private. Where your role allows expiration management, **Expires** labels a scheduled expiration. When enlarged text needs more room, these badges move below the image instead of covering it.

The filename uses the full available heading width. Gallery puts size beside activity below it; List puts these facts in its metadata column or wrapped phone rows. Names wrap at spaces when possible, and an unbroken name can wrap within a word rather than overflow the card. No part of the filename is deliberately omitted, including timestamps, extensions, emoji, and combining marks. The link’s accessible name and tooltip retain the same complete name. On touch screens, generic filename links and **Manage file** keep at least 44px targets; headings grow when their text needs more room.

Open **Manage file** for the file’s complete filename and every action your role allows. Gallery image cards keep their direct view, copy, and download shortcuts. On generic cards, choose the filename to open the file or browse a supported archive; use **Manage file** for **Copy link** and **Download file**. These actions no longer occupy a separate generic preview band. The menu opens beside its button when there is enough horizontal room. On a phone, or when enlarged text needs more width, it opens below or above instead. It shifts or changes sides to stay on screen. On short screens or with enlarged text, the filename and other actions scroll when necessary, with direction cues when more content remains. **Delete file**, when permitted, stays in a separate footer below that scrolling area and opens the same confirmation. Keyboard Home and End reach the first and last available actions.

In Gallery, folder and tag labels share their own full-width row when present, followed by the view and download counts. Gallery cards without a folder or tags leave out that label row. List uses intrinsic-width labels in its separate desktop column or wrapped phone row; an empty desktop label column keeps the other facts aligned. Touch label controls keep at least 44px targets. Enlarged text grows a control only when its content needs more room. Gallery image shortcuts shown by keyboard focus on a touch screen temporarily use a taller preview, keeping their targets clear of the badges and **Manage file**. Counts of 1,000 or more are abbreviated, such as 1.4K or 13K; point at a count to see the exact number.

Screen readers receive the exact view and download totals.

<Screenshot src="/screenshots/refinement/library-compact-mobile.png" alt="Phone mixed-file library with filenames above previews, compact Markdown cards and wrapped labels" caption="Read filenames first, then inspect an image or open a generic file from its heading." />

<Screenshot src="/screenshots/refinement/library-compact-desktop.png" alt="Desktop mixed-file library with aligned filename headings, compact documents and image thumbnails" caption="Filename headings align across each row while generic cards end after their content." />

A card shows up to two labels: two tags, or the folder and one tag. **+N** counts the file's other tags; when your role allows **Edit tags** (`files.update` and `tags.manage`), choose it to see every tag there. Earlier versions opened the editor for every role, where any change then failed. Label names wrap when they need more space, and enlarged text can put the controls on separate rows. Their accessible names and tooltips also keep the full names. Choose a tag to [show every file with that tag](./tags#find-files-by-tag), or choose the folder to open it. Cards inside a folder leave out the name of the folder you are viewing.

## Scroll through your library

Scroll normally with your mouse, trackpad, or touch screen. More files load as you reach them, without a **Next page** button. You can browse every matching file without changing pages.

Flare keeps cards and nearby file data in a limited window around your position. Returning to an earlier part of a large library may briefly show loading placeholders while those files load again. Date jumps keep the destination's cards or loading placeholders visible while you drag. The file count describes the whole filtered result, not just the cards currently on screen. Your browser's Find command only searches rendered content; use the library's search field to find files anywhere in your account.

With **Newest first** or **Oldest first**, a slim date rail on the right helps you stay oriented. A visible rounded lane marks the space beside the cards on every screen. With a mouse, its date label appears while you scroll, hover, or focus it, then recedes when you finish. The first and last years sit above and below the track within its edge lane, keeping them clear of file text when you enlarge type. On touch screens, its thumb and lane remain visible at rest; the first and last year labels stay hidden, and the current date bubble appears only while dragging or using keyboard focus. Ordinary touch scrolling leaves file details clear of date labels, and releasing the thumb removes the touch focus outline. Keyboard focus retains its contrasting outline. Click or drag along the rail with a mouse, or drag the visible thumb on a touch screen, to jump through the matching upload history. Flare loads files near your destination without first downloading every file you passed.

The date rail starts beside the file area, clear of the search and filter controls. On touch screens, its visible thumb is the drag target and changes color while dragging; grabbing its edge preserves the current position until you move it. The track stays fixed under your finger during a seek, including when the library header scrolls away, and returns to its normal position after release. Swiping elsewhere along its track scrolls the page normally. Keyboard users can focus **Browse files by date** and use the arrow, Page Up/Down, Home, and End keys. The marked lane shares the outside page margin and a narrow reserved column beside the files, keeping the full 44px thumb clear of card actions.

Enlarging text keeps the touch thumb and navigation icon targets at 44px rather than doubling their width. On narrow screens with enlarged text, dragging or keyboard focus puts the current date in a separate row beneath navigation so it stays clear of file badges. Date jumps keep the destination below that row. Filter controls and file labels can wrap or stack as their text grows; card spacing is measured again after text or column sizes change. Rows also update when loading placeholders become files, keeping the spacing aligned and retaining your position during ordinary upward or downward scrolling.

For very large libraries, the browser's own scrollbar follows the section you are browsing and extends as you continue. The date rail always covers the full matching history, so use it to jump straight to a distant date.

To use the rail from a keyboard, Tab to **Browse files by date**. Up/Down arrows move one row, Page Up/Page Down move farther, and Home/End go to the beginning or end. After a touch jump, Up and Down continue one row at a time from the destination. These follow the displayed order: with **Oldest first**, the beginning contains your oldest files. Normal page scrolling remains available on small screens.

<Screenshot src="/screenshots/timeline/library-date-jump.webp" alt="A historical section of the library with the right-hand date rail showing the upload period at the current scroll position" caption="Jump into your upload history while keeping the active search, folder, and filters." />

The date rail follows the files matching your current filters. Size, view-count, and download-count sorts keep continuous scrolling but do not show a chronological rail. The rail is hidden for short lists. Views without a date rail use the full file-column width.

Resizing the window or rotating your device keeps the file you were browsing in view, including deep in a large library. Its position within a row can change as the number or width of columns changes; your search, folder, filters, and date grouping stay selected.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/timeline/library-mobile.webp" alt="The continuous file library on a narrow mobile screen with readable file cards and a date rail at the right edge" caption="The same library supports ordinary touch scrolling and date navigation on mobile." />
</div>

Watch the [recorded library walkthrough](/demos#browse-a-large-library) for a real scroll and date jump using demonstration files.

## Change accounts or sign in again

The library belongs to the currently authenticated account and browser session. It waits until Flare knows which account is signed in before showing files. When an open tab detects sign-out, it removes the library and asks you to sign in.

Signing in as another account, or starting a new session for the same account, loads fresh files and counts. It also clears selected files, open file dialogs, the image viewer, and the previous browsing position. This applies when the change is detected after signing in through another tab; you do not need to close the old library first.

Filters in the page address remain bookmark settings. If an old folder or tag filter leaves the new account's view empty, choose **All files**, then **Reset filters**. Start any unfinished file action again after checking the new selection. Changing accounts cannot undo an operation the server already accepted.

<Screenshot src="/screenshots/timeline/library-account-switch.webp" alt="The original library tab after signing in as Jamie in another tab, showing Jamie's 97 demonstration files with no previous selection or archive dialog" caption="A real account switch loads the new account's library in the original tab. These filenames and images are disposable demonstration data." />

## Search and narrow the results

Type in the search field to find matches in filenames and extracted OCR text. Matching ignores capitalization. Search does not read the contents of every text file, PDF, or document: searchable content comes from image text that Flare has extracted.

Use the controls beside search to narrow the current library. On a phone, search and **Filters** share one row when there is room; enlarged text can put search on its own row to keep space for typing. Open **Filters** for sorting, tags, visibility, file types, and **Date and grouping**. The controls stack when enlarged text needs more width, and their labels can wrap. Sort choices retain their full names. A nondefault sort stays visible as a removable chip when the controls are closed. The number on **Filters** counts nondefault sorting plus active tag, type, visibility, date-range, and grouping choices, and the applied values remain visible below search when these controls are closed:

| Control               | Choices and behavior                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Folder**            | All files, Unfiled, or the direct contents of a folder. Opening a folder does not merge its subfolders' contents into the results.                                                                                                                     |
| **Tags**              | Choose a tag, return to all tags, or find untagged files.                                                                                                                                                                                              |
| **Sort**              | Newest/oldest, largest/smallest, most/least viewed, or most/least downloaded.                                                                                                                                                                          |
| **Visibility**        | Public, private, and password-protected. Multiple checked choices are alternatives: public plus password-protected includes files matching either choice.                                                                                              |
| **File type**         | Select the MIME types present in your library. These are grouped into images, videos, audio, documents, and other files. Documents include PDF, text, code, and CSV types, such as `application/json`, and office documents; archives are other files. |
| **Date and grouping** | Choose a date range and optionally group results by week, month, or year.                                                                                                                                                                              |

Separate controls combine. For example, a folder, an image type, and a search phrase narrow results to matching images in that folder. Visibility is the notable exception within its own menu: checking multiple values includes any selected value.

Each applied filter appears as a removable chip below search. Choose its **×** to remove only that search, tag, file type, visibility choice, date range, or grouping; the other constraints and current folder stay selected. The date control and its chip name the selected dates in your browser’s time zone; the control’s accessible name includes the same visible range.

**Reset filters** clears search, tags, dates, types, visibility, sorting, and grouping while keeping the folder you are browsing. When no files match, the empty result offers this action without repeating it in the header. To leave the folder too, choose **All files** in the folder browser. Folder navigation and its actions wrap onto additional lines when enlarged text needs room, keeping **All files**, **Unfiled**, **Folders**, and available folder actions readable. On narrow screens, breadcrumb names wrap with their separators, and **Upload here** can move below the path rather than squeezing it.

The page address includes your filters. Bookmark it to return to the same view; browser Back and Forward restore the controls along with the results. Scrolling does not add a browser-history entry or save an exact position in the URL. The URL is a view of your signed-in library, not a public share link.

If you follow a file's link from the library, browser Back returns to the same file row. A row that was partly offscreen near the library's end can return fully into view below the navigation. This saved position belongs to the current browser-history entry; a copied URL or bookmark keeps the filters without carrying your scroll position.

Existing bookmarks with `page` and `limit` still open near the corresponding file in the continuous list. Additions, deletions, or different filters can change which file occupies that position. After an upgrade, your files, folders, tags, and saved filters need no conversion.

## Browse by date

Open **Date and grouping → Group files** to choose **By week**, **By month**, or **By year**. Grouping works with **Newest first** and **Oldest first**. Choosing a size or activity sort turns date grouping off; enabling grouping from those sorts returns to newest first.

On phones, **Date and grouping** opens the upload-date picker near the top of the screen so the full month can use the available height. On a short screen, the calendar scrolls within the popover when needed. **Group files** and, after selecting dates, **Clear date range** stay visible below it. The closed control names the current grouping as well as selected dates, so its active state stays clear.

Grouping adds headings to the continuous list and adjusts the date rail to the same period. Upload dates use your browser's time zone; weeks begin on Monday. Without grouping, the rail shows the upload month. Grouping changes presentation without moving files or changing their upload dates.

## Inspect images

Image cards show previews for public images and for your private or password-protected images. Protected previews use your browser session, and GIFs retain their animation. The thumbnail endpoint reads the original image; public raster cards can be resized by the image optimizer, while protected images, GIFs, and SVG previews load directly in the browser. SVG previews bypass the raster optimizer, so a public SVG no longer falls back to a generic icon because the optimizer refuses it. Large originals can take longer to load. Only visible and nearby cards load as you scroll.

<Screenshot src="/screenshots/thumbnails/library-previews.webp" alt="Four real library cards previewing an animated GIF, a password-protected PNG, a private PNG, and a public PNG" caption="These disposable uploads show image previews under each sharing mode in the rendered application." />

Open an image preview to browse it in the full-screen viewer. The image sequence respects the active folder, search, tags, sorting, and other filters, including images beyond the cards currently loaded in the library. Other file types are skipped in that image sequence. The viewer's header shows the image's name and upload date; once you move to another image, it also shows that image's place in the sequence, such as **12 of 40**.

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

Open **Manage file** for the full action list. Tall menus scroll internally within the screen so their first and last actions remain reachable on short phones. **More actions below** or **More actions above** marks hidden items as you scroll. On Gallery image cards, keyboard focus adds contrasting bands to the primary preview and menu control so they remain visible against uploaded images. Tab visits the primary filename or preview, **Manage file**, then the card’s folder and tag filters. Press Enter on that primary link to open the image viewer, archive browser, or file page. The menu provides **Open file**, **Copy link**, **Download file**, and every other permitted action, including **Manage expiration** and **Edit tags**, without tabbing through repeated shortcuts.

Outside selection mode, hovering or focusing a Gallery image preview shows **View image**, **Copy link**, and **Download**, where available. The shortcuts stay visible while one has focus, so you can activate it after switching from the keyboard to a mouse or touch. Enlarged text on a constrained touch card uses a labeled eye icon for **View image**. Copy link and Download use labeled icons with tooltips. Generic Gallery cards and List rows omit this shortcut band; use their filename and **Manage file** instead. Sharing settings, expiration, OCR, tags and deletion remain in the always-visible menu. Existing installations use the same layout.

- **Open file:** open its share/viewer page.
- **Copy link:** copy its share-page URL. The link starts with the address you opened Flare at and uses your account's URL ID, not your [vanity URL](./upload-profiles#account-upload-defaults). Links shown after an upload start with the instance's public URL instead, and use your vanity URL when you have one.
- **Download file:** save a copy to your device.
- **Browse archive:** browse supported archives of any size, preview images, video, audio, and text inside them, download an entry, or extract into a new folder. See [archives](./archives). Flare offers it for ZIP, TAR, TAR.GZ, GZIP, RAR, and 7z files, recognized by their type or name. An image, video, audio, or PDF file named like an archive, such as `photo.zip`, opens as that file; earlier builds offered **Browse archive** for it.
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

If a visibility, password, expiration, or delete action fails, its message gives Flare's reason when there is one, for example **File not found** for a file deleted in another tab, or **Permission denied** after your role changed. Without a reason, for example when the connection drops, it says **Please try again.** Earlier versions said **Please try again.** for every failure. After any of these actions succeeds, the library reloads to show the changed file.

When you confirm **Delete file**, the file's size stops counting toward your storage use in **Profile → Your data** at once. Flare removes the stored copy in the same step. If the storage service fails at that moment, the file is still deleted from your library and you see **File deleted**; Flare records the failure for your administrator, who may need to remove the leftover copy.

## Work with several files

Choose **Select**, then select individual cards or **Select visible files**. The latter selects loaded cards currently on screen, up to the selection limit; it does not select your whole library or files loaded just beyond the screen. Scroll to add files from another part of the library. Your selection stays selected as cards leave the screen, and the selection bar remains available while you scroll.

Selection hides the repeated preview shortcuts while keeping the preview and **Manage file** menu available. On cards without image previews, the checkbox replaces the kind icon; the kind label remains visible.

On phones, the selection bar stays in one row: the checkbox selects visible files, the count shows the selection and its limit, **Actions** opens the permitted bulk operations, and **×** finishes selection. It stays below the dashboard navigation while you scroll, including after selecting files in distant parts of the library. Keyboard focus and date jumps keep their destination clear of the selection bar. Wider screens show the bulk-action buttons directly in the bar.

You can select up to **100 files** at a time, then choose **Edit tags**, **Move**, or **Create archive** where your permissions allow. Deselect individual files to make room, or finish the current batch before starting another.

The selection bar counts your selection against that limit, for example **2 selected · up to 100**. **Select visible files** shows a dash when only some of the files on screen are selected; choose it to add the others. When it is checked, choosing it again removes the files on screen from your selection and keeps the rest.

Before **Edit tags**, **Move**, or **Create archive** opens, Flare fetches current details for every selected file, including cards outside the visible window. If that check fails, retry the action. If a selected file is no longer available, choose **Done** and select the remaining files again.

Changing the search, filters, folder, sort, or grouping clears the selection. **Done** leaves selection mode and clears it too.

**Select** is available when your role allows at least one bulk action, and the selection bar shows only those: **Create archive** needs `files.read` and `files.upload`, **Move** needs `files.update` and `folders.manage`, and **Edit tags** needs `files.update` and `tags.manage`.

**Edit tags** reloads current tag assignments for the whole selection before enabling edits, including selected files outside the visible window. See [bulk tagging](./tags#tag-several-files-together) for checkbox meanings and loading recovery.

<Screenshot src="/screenshots/timeline/library-selection.webp" alt="Library selection mode with Select visible files, a selected-file count, Move, Create archive, Edit tags, and Done controls" caption="Keep a selection while scrolling; bulk actions apply to the selected files, up to 100 at a time." />

With `files.read` and `files.upload`, **Create archive** packages up to 100 selected owned files into a new ZIP or TAR.GZ. It defaults to private/no expiration; explicitly choosing an upload profile applies that profile’s settings. Saving into a folder also requires `folders.manage`. The originals remain unchanged; [archive limits and defaults](./archives#create-an-archive-from-selected-files) apply separately from ordinary uploads.

## Read text in images with OCR

For an image, choose **Extract text (OCR)**. Flare processes the image on the server and opens the extracted text; use the dialog's copy action to reuse it. Until Flare answers, the card shows **Extracting text…**; on a share page, **Extract text** reads **Reading image…**. The dialog then opens with the text or one of the messages below. Earlier versions opened the share page's dialog straight away with a spinner. If your browser blocks the clipboard, **Copy text** shows **Couldn’t copy the text**; select the text in the dialog and copy it instead. OCR can make screenshots searchable and can trigger [automatic tag rules](./tags#automatic-tags).

If the administrator enables automatic OCR, images can be processed after upload without a manual request. Upload completion does not mean OCR has completed. Manual extraction remains useful when automatic processing is disabled.

Flare reads one image at a time, and requests and automatic processing share that turn. Asking about an image that is already being read waits for the same result instead of starting again, and doesn't count toward your reading limit. Saved text opens immediately. The same applies when visitors choose **Extract text** on a share page. If the dialog shows one of these messages, the text isn't lost:

| Message                                   | What to do                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flare is still reading this image         | Reading continues on the server after a one-minute wait. Choose **Check again** shortly to see the text.                                                            |
| Flare is busy reading other images        | Ten new images are already waiting to be read, or 30 requests are already waiting for results. Choose **Try again** in a minute.                                    |
| You’ve asked Flare to read several images | Each account, or each address for visitors who aren't signed in, can start 20 readings per 10 minutes. Saved text doesn't count. The message says how long to wait. |
| Flare couldn’t read text from this image  | The last attempt failed. Flare waits 5 minutes before reading that image again; the message says when. Try a clearer, larger PNG or JPEG if it keeps failing.       |
| Couldn’t extract text. Please try again.  | The request didn't reach Flare, for example because the connection dropped. Choose **Try again**.                                                                   |

<Screenshot src="/screenshots/workspace/files-ocr.png" alt="Dialog showing text extracted from an image" caption="OCR makes text inside an image available to copy and search." />

Administrators with `audit.read` can inspect OCR start, completion, and failure events alongside the file’s other activity in [Audit log](/admin/audit). Those audit details do not include extracted text. Ask for an investigation when processing repeatedly fails; do not assume a successful upload also completed OCR.

OCR supports images, not a general PDF or office-document indexing workflow. Results depend on legibility, resolution, and the recognition language. Review extracted text before using it as an exact transcription. Flare's current OCR worker uses English recognition.

## Understand activity and refresh

Cards show view and download counts, and those counts can drive sorting. Share-page visits and successful `/raw` GET requests contribute to the view total, including media range requests. The count can include bots and multiple requests from one person; see [view counts](./sharing#view-counts) for the counting rules and upgrade behavior.

Use **Refresh files** to fetch the latest results. Uploads completed through the dashboard drop overlay also refresh an open library. Files can move within a sorted list when uploads, deletions, or activity change its order.

If a section fails to load, choose **Retry** after checking your connection. If it still fails after files were changed in another tab or client, choose **Refresh files** to rebuild the current view. Flare keeps the active search and filters. Loading placeholders and a failed request do not mean that files have been deleted.

::: details A file seems to have disappeared
Choose **All files**, then **Reset filters**. A move, tag edit, or visibility change can remove a file from a filtered view; your unfiltered library still includes your private files. If it uploaded under a different account or was permanently deleted, including by an expiration, it will not appear in this account's library. A failed results request shows a retry state; it does not mean your files were deleted.
:::

::: details A file downloads but has no preview
Storage and browser preview support are separate. Flare previews common images, media, PDFs, text, code, and CSV. Unsupported formats remain downloadable. Browser codec support can also prevent playback even when the upload succeeded.

For a supported image showing a generic icon, reload the page to retry its preview. If it still fails, check the thumbnail request as described in [thumbnail troubleshooting](/hosting/troubleshooting#image-thumbnails-fail).
:::

---
title: Saved views
description: Save a library search, pin it above your files, and return to the same filters from any device.
---

# Saved views

Saved views remember how you like to browse **Files**: a search, folder, tag, file types, visibility, dates, sorting, and date grouping. Give a view a name and pin it above the file grid to return to it in one click. Your views belong to your account and are available when you sign in on another device.

<Screenshot src="/screenshots/handbook/saved-views.webp" alt="Flare file library with named saved views pinned above the filtered file grid" caption="Keep the parts of your library you return to close at hand." />

## Save the current view

1. Open **Files** and choose the filters you want. For example, select your **Receipts** tag and sort newest first.
2. Choose **Save view**.
3. Enter a **Name**, such as **Receipts**, and choose whether to enable **Pin to Files**.
4. Choose **Save view**. A pinned view appears above the file grid.

You can save up to **20 views** per account. Names must contain 1–40 characters after surrounding spaces are trimmed, and each name must be distinct within your account, ignoring capitalization. New views are pinned by default.

Saving a view does not move, tag, upload, or duplicate files. It remembers the choices already available in the [library filters](./library#search-and-narrow-the-results).

## Return to a view

Choose a pinned view above the grid, or open **Saved views** and select a view. Flare restores its filters, sorting, and grouping, starts at page one, and keeps your current page size. The [full-screen image viewer](./library#inspect-images) follows the restored results too.

Results are current when the library fetches them. New files that match the saved filters appear on the next normal refresh; files that no longer match disappear. A saved view is not a frozen list or a background live feed. Use the library's **Refresh** control when needed.

After opening a view, you can adjust filters for a one-off search. Those adjustments do not overwrite the saved view automatically.

On a phone, swipe the pinned shortcuts horizontally to reach more views, or choose one from **Saved views**.

<div style="max-width: 390px; margin-inline: auto">

<Screenshot src="/screenshots/handbook/saved-views-mobile.webp" alt="Saved views on a narrow phone screen, with a horizontally scrolling row of pinned shortcuts above the image library" caption="The same account views are available on your phone." />

</div>

## Change or remove a view

Open **Saved views → Manage views**, then select a view's name to open **Edit saved view**:

- Change **Name** to rename it.
- Turn **Pin to Files** on or off to add or remove the shortcut above the grid. An unpinned view stays in the saved list.
- Enable **Use current filters** to replace its saved choices with the filters currently shown in Files. Set those filters before editing the view. This switch starts off, so changing a name or pin alone keeps the saved filters.
- Choose **Save changes** to apply your edits.

To remove a view, choose **Delete view…**, then confirm with **Delete view**. This removes the view and its shortcut; your files, folders, and tags stay intact.

Changes are saved to your account. If another tab or device edits the same view before your change is saved, Flare rejects the older revision and loads the latest settings into the editor. Review those settings and reapply your intended change before saving again.

If the view list fails to load, choose **Retry loading saved views**. A loading error does not mean your views or files were deleted. At the 20-view limit, **Save view** is unavailable; remove an unused view through **Manage views** before creating another.

## What a view remembers

| Choice                    | Behavior                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Search                    | Matches filenames and available OCR text, using the normal library search.                                         |
| Folder                    | All files, Unfiled, or one folder's direct contents; subfolders are not included automatically.                    |
| Tag                       | All tags, Untagged, or one tag.                                                                                    |
| File types and visibility | Reuses the selected library filters and their existing combination rules.                                          |
| Upload dates              | Keeps the exact saved start and end dates. A saved range does not roll forward with today.                         |
| Sorting and grouping      | Restores the saved order and optional week, month, or year grouping. Date grouping needs newest or oldest sorting. |
| Pagination                | Reopens on page one using your current page size; it does not save a page number or page size.                     |

Views save folder and tag identifiers. Renaming a folder or tag keeps the view connected to it. If that folder or tag is deleted, the view becomes **unavailable** instead of showing a broader set of files. You can still rename, pin, unpin, or delete it.

To repair an unavailable view, choose a valid folder and tag in Files and review the other filters. Open **Saved views → Manage views**, select the unavailable view, enable **Use current filters**, and choose **Save changes**. Recreating a folder or tag with the old name gives it a new identifier; select that replacement explicitly.

## Two useful starting points

### A screenshot journal

Filter your library to the image MIME types you use, choose **Newest first**, and select **Upload date → Group files → By month**. Leave the upload date range empty and save this as **Screenshot journal**. New matching images join the journal as you upload and refresh, and you can open any image to browse that filtered gallery.

### Receipts that organize themselves

Create a **Receipts** tag with a [filename or OCR matching rule](./tags#automatic-tags), then save a library view filtered to that tag. As the rule labels new uploads, the receipt view includes them on refresh. OCR rules apply only after text extraction completes; saving a view does not run OCR or apply rules to old files.

## Privacy, upgrades, and backups

Saved views are private account preferences. Their names and filters are not listed on public file pages or shared folders. Saving or pinning a view does not change file visibility, passwords, expiration, or share links. Use a [shared folder](./folders#share-a-folder) to publish a collection for recipients.

The library URL still contains the active filters, so browser bookmarks and Back/Forward continue to work. That address opens a signed-in library view; it does not share your saved-view record or grant someone else access to your files.

Existing accounts start with no saved views after upgrading. There is no setting to enable and no separate database migration for this feature. Views are stored with account preferences in PostgreSQL and included in an [instance database backup](../hosting/maintenance). The current [account data export](./account#export-your-data) does not include them.

For contributors inspecting dashboard requests, see the [session-only saved views API](../api/saved-views). Named API tokens and the account upload token cannot manage saved views.

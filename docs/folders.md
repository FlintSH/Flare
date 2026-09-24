# Folders

Folders give related files a home while **All files** stays the default view. There is no setting to enable. Tags continue to work across folders, and searches, filters, and image navigation stay within the folder you are viewing.

- Choose **New folder** in your file library. Open a folder to create subfolders or use **Upload here**.
- Use a file’s menu or select several files and choose **Move**. Each file belongs to one folder; **Unfiled** removes it from its current folder. Moving keeps the same file link, tags, password, and visibility.
- The upload page shows a **Save to** selector once you have folders. Dropping files into the library uploads them to the folder currently open. Uploads elsewhere remain unfiled.
- Rename and remove folders from their menu. Removing a folder keeps its files and subfolders, moving them up one level. Removing a top-level folder leaves its files unfiled and promotes its subfolders. A conflicting subfolder name must be renamed first.

## Sharing

Folders are private until you choose **Share → Create share link**. A shared folder lists only its direct public files. Private files, subfolders, tags, and account details are never listed. Password-protected files have a locked tile without a preview and still require their password when opened.

Adding a public file to a shared folder makes it appear on the shared page. Moving it out removes it from that page. Its individual file link and privacy settings stay the same. Removing a folder whose parent is shared moves its public files onto the parent’s shared page.

**Disable link** immediately stops new requests to the folder link. Re-enabling sharing creates a new link. Removing the folder also disables its link. Disabling a folder link does not revoke individual public file links.

## API

Folder management requires authentication, and all operations are scoped to the current account. Named upload tokens cannot manage folders; use the dashboard session. Mutation requests use the same origin as Flare and JSON bodies where applicable.

| Method | Endpoint             | Body or query                                                                                  |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/folders`       | Lists your folders, parent IDs, direct file counts, and share tokens.                          |
| POST   | `/api/folders`       | `{ "name": "Marketing assets", "parentId": null }`                                             |
| PATCH  | `/api/folders/:id`   | `{ "name": "Brand assets" }` or `{ "sharing": true }`                                          |
| DELETE | `/api/folders/:id`   | Removes the folder and keeps its contents.                                                     |
| POST   | `/api/files/folders` | `{ "fileIds": ["file-id"], "folderId": "folder-id" }`; use `null` for Unfiled.                 |
| GET    | `/api/files`         | `?folder=folder-id` for direct files, `?folder=unfiled` for unfiled files; omit for All files. |

For a normal multipart upload, select the folder **before** sending file bytes with `X-Upload-Folder: folder-id` or `?folderId=folder-id` on `/api/files`. For chunked uploads, add `"folderId": "folder-id"` to the JSON initialization request on `/api/files/chunks`. Omit it or pass `null` during chunk initialization to upload unfiled. Folder destinations are request-only and are not saved in upload profiles.

The server verifies ownership before accepting the upload and again when publishing the file. A removed destination fails the upload instead of silently changing its location. The destination cannot change during an in-progress upload; start another upload to choose a different folder.

Shared folder links use `/s/folders/:token` and paginate public files in groups of 48. Sharing never changes the access rules for individual files.

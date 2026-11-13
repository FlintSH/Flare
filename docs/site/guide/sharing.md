---
title: Sharing and privacy
description: Understand public and private files, password protection, expiration, direct links, and recipient previews.
---

# Sharing and privacy

Every file has a share-page URL. Its visibility and password decide who can open it; the page's design decides how it looks. Copying a URL, choosing a layout, or hiding a filename does not change file access.

## Choose who can open a file

| File setting               | Owner   | Account with `content.read` | Other signed-in users | Signed-out visitors |
| -------------------------- | ------- | --------------------------- | --------------------- | ------------------- |
| Public, no password        | Allowed | Allowed                     | Allowed               | Allowed             |
| Public, password-protected | Allowed | Allowed                     | Password required     | Password required   |
| Private                    | Allowed | Allowed                     | Denied                | Denied              |
| Private, with a password   | Allowed | Allowed                     | Denied                | Denied              |

The Owner column assumes the signed-in owner has `files.read`. The moderation column includes Administrator and delegated content readers, even when their role has no settings access. Removing `files.read` removes the owner’s privileged access to private/password-protected files; public visitor rules still apply.

Private files deliberately return a not-found response to people without access, including from their raw, download, thumbnail, and text-recognition URLs. Earlier builds answered a thumbnail or text-recognition request for a private file that isn't an image with "not an image", which told someone holding the file's ID that it exists. Another person signing in to the same instance does not make your private file accessible to them. Giving them its password does not override private visibility.

The signed-in library is account-specific. When an open tab detects a different account or replacement browser session, it discards the previous files, selection, and dialogs before loading the current account's library. [Saved URL filters still apply](./library#change-accounts-or-sign-in-again); they do not grant access to the previous account's files.

Flare is operated by your instance administrator. Private files and file passwords are access controls in the application; they do not provide end-to-end encryption from the server operator.

## Activity visible to administrators

Flare records [instance audit events](/admin/audit) for application activity, including file operations and background processing. People with `audit.read` can inspect recorded filenames, account attribution, outcomes, and selected metadata, including activity involving private files. This permission does not itself grant file-content access. Deleting a file or account does not erase the retained audit record; ask your operator about retention and backups. Downloaded copies and direct object-storage requests are outside Flare's application audit boundary.

## Share a public file

1. Set its visibility to **Public** while uploading, or choose **Change visibility** from its library menu.
2. Choose **Copy link**.
3. Send the copied URL to your recipient.
4. If you added a password, send that separately.

Test with a signed-out browser window if you want to see the recipient experience. As an owner, you bypass your own file's password prompt.

Public files can be opened by anyone who obtains their URL, including someone a recipient forwards it to. Flare does not make your whole library public merely because an individual file is public. [Sharing a folder](./folders#share-a-folder) explicitly creates a listing of that folder's direct public files.

## Protect a link with a password

Add a password in the upload form, or use **Files → file menu → Add password**. For an already protected file, **Manage password** lets you replace or remove it. Recipients open the link, enter the password in **File password**, and choose **Access file** to unlock the viewer. A wrong password keeps the file locked and shows a message under the field. The form sends the password as the page's `password` query parameter; if an address repeats it, Flare checks the first one, where earlier versions showed a server error. An account with `content.update`, such as an administrator, can also change a file's visibility and add, replace, or remove its password from **Users → More actions → View content** ([moderating files](/admin/users#moderate-files-and-shortened-links)).

<Screenshot src="/screenshots/workspace/share-protected.png" alt="Password-protected share page asking a visitor to unlock the file" caption="A protected public file asks visitors for its password before showing the content." />

A new file password needs **at least 8 characters** and at most 72 bytes; most emoji and some accented characters use more than one byte. The forms explain the rule as you type and keep the save button disabled until it is met. Passwords set before this rule existed keep working until you change them.

Changing a password changes what future access checks accept. It cannot remove a copy that somebody already downloaded. For a temporary handoff, combine a password with an expiration.

### Incorrect password attempts

To stop someone guessing a password, Flare pauses new password checks for a file after too many different incorrect passwords within 15 minutes:

- **10 from one network address.** Only that address is paused. Other visitors can still unlock the file.
- **100 from all visitors together.** Everyone is paused until the 15 minutes end. This limits guessing spread across many addresses.

A paused visitor sees a message under the **File password** field saying how many minutes to wait. During a pause Flare does not check new passwords, so even the right one is refused. The exception is an address that unlocked the file in the last 10 minutes: it keeps access, so someone already watching a video is not interrupted by other people's guessing. The pause ends on its own. Entering the same wrong password again does not count as another attempt, and a correct password, including one remembered from the last 10 minutes, clears that address's count. Guesses sent at the same time count while they are still being checked, so a burst of requests can't get more passwords checked than the limits allow. The file's owner and accounts with `content.read` never need the password.

The counts are kept in the running Flare process: restarting Flare clears them, and separate replicas count separately. Each process counts recent wrong passwords for up to 10,000 files and never drops a file's count early, so guesses spread over more addresses can't reset it. If that many files have recent wrong passwords, password checks for other files pause until the oldest 15-minute window ends. Flare doesn't keep the submitted passwords for this. It remembers a one-way value derived from each one with scrypt, salted with a random key that each Flare process creates at startup, and drops it when the 15-minute window or the 10-minute unlock ends. Per-address counting relies on the client address that your reverse proxy forwards. Without forwarded addresses, as when the app port is exposed directly, only the 100-attempt limit applies. Operators can check this in [client addresses](../hosting/reverse-proxy#client-addresses-and-rate-limits).

A password slows guessing but is not encryption. Use a long, unusual password for sensitive files, and share it separately from the link.

If you need to stop public access while keeping your copy, set the file to **Private**. Removing password protection from a public file makes it accessible without a password.

## What a share page shows

A share page puts one file in the middle of the page, with what a recipient needs before opening it:

- **The file's name**, an icon for its kind, and its type in plain words, such as **PNG image**, **TypeScript**, or **ZIP archive**, with its size.
- **Expires in …** when the file has a [scheduled expiration](#give-a-file-a-lifetime), for example **Expires in 3 days**. In the last three days it is highlighted. Both expiration actions read the same way to a recipient: after that time the link stops opening for them. The instance administrator can turn the notice off with **Show expiration**, alongside the other [details a share page shows](#control-presentation). A file whose expiration was scheduled by a build that didn't record it with the file shows no notice until you save its expiration again.
- **The actions**, beside the name: **Download**, **Copy link**, **Copy text** on text, code, and spreadsheets, **Extract text** on images, and **Open original**, which opens the file itself in a new tab. They sit above the preview, so they stay in reach however long the file is. On screens narrower than 1024 pixels, every action except **Download** is an icon button. Hovering one, or moving keyboard focus to it, shows its name, and screen readers announce it. Below that width, copying also confirms itself with a short message, because the button has no label to change.
- **The preview**, sized so the name, the actions, and the preview fit one screen. Longer text, tables, and documents scroll inside it.

Every previewable type uses the same card width, so pages keep their shape from one file to the next. Audio and files without a preview get a smaller card with the name, the player if there is one, and labeled actions.

While a preview loads, a placeholder of its size holds its place, so the name and the actions don't move when the content arrives. An image wider or smaller than usual, or an archive's file list, eases to its final height instead of jumping. On a phone the card starts under the header and grows downward. Visitors who ask their system for reduced motion get the final size at once.

A share page downloads the code for the kind of file it shows and no other, and a shared image starts downloading with the page. Earlier builds sent every viewer with every page, the code editor, media player and archive browser included, and asked for an image only after all of that had loaded, so a shared screenshot took about twice as long to appear on a phone connection.

Earlier builds sized each card to its content, so every type had a different width, put the actions under the preview, where a long file pushed them off the screen, and replaced a small **Loading…** line with the content, which moved the page.

<Screenshot src="/screenshots/sharing/share-page-image.webp" alt="Flare share page for a JPEG image: the file's icon, name, type and size with Download, Copy link, Extract text and Open original beside them, and the picture below" caption="The name, type, size, and actions sit above the preview on every share page." />

<Screenshot src="/screenshots/sharing/share-page-phone.webp" alt="The same share page on a phone, with Download as a wide button and the other actions as icon buttons above the picture" caption="On a phone the actions stay above the preview, with icons for everything but Download." />

## What recipients can preview

| Content       | Viewer experience                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images        | An inline preview; select the picture or the button on its corner to open the expanded viewer for zoom and pan. Images with see-through areas inside them, such as logos and icons on a clear background, show a checkerboard there: light behind dark artwork and dark behind light artwork, so they stay visible in either theme. Images that are only rounded or shadowed at their edges sit on the page without one.                                                                                                                        |
| Video         | [Flare's player](#the-video-and-audio-player) for every video type, with the same controls in every browser. Whether a file plays depends on the browser's support for its format and codec; if it can't, the page says so.                                                                                                                                                                                                                                                                                                                     |
| Audio         | [Flare's player](#the-video-and-audio-player) for every audio type, such as MP3, FLAC, or M4A, when the browser can play it, on a small card with the file's name and actions.                                                                                                                                                                                                                                                                                                                                                                  |
| PDF           | The browser's own PDF viewer inside the page. A browser that can't show a PDF inside a page, such as Chrome on Android, shows **Open PDF**, which opens the document in its own tab, instead of an empty frame.                                                                                                                                                                                                                                                                                                                                 |
| Text and code | A read-only view with line numbers for any text type. Markdown wraps to fit the screen; code, logs, and other plain text keep their lines and scroll sideways. Code types receive syntax highlighting in [the languages Flare colors](./pastes#choose-a-useful-filename); other text is highlighted by its file extension, like a paste. On wider screens code can be folded from the line-number gutter.                                                                                                                                       |
| CSV and TSV   | A scrollable table for files with a CSV or tab-separated type or a `.csv` or `.tsv` name, up to 1 MiB, with a count of its rows and columns under it. The first row is the header. A short value such as a date or an order number stays on one line and long text wraps; a table wider than the page scrolls sideways, on phones too. A tab-separated file is split on its tabs alone, so commas inside its cells stay in the cell; a CSV's delimiter is detected, which also reads semicolon-separated files. Larger files can be downloaded. |
| Archives      | Browse folders and paths, preview supported entries, and download an entry or the complete archive. Extraction stays in the owner's library. RAR and 7z archives are recognized, but they can only be downloaded.                                                                                                                                                                                                                                                                                                                               |
| Other formats | A small card with the file's name, its type (such as **Word document** or **BIN file**), its size, and **Download**. A type Flare doesn't know is named by the file's extension; an extension made only of digits, as on `backup.001`, reads **File**.                                                                                                                                                                                                                                                                                          |

Flare picks the viewer from the file's stored type, and for CSV files and archives also from its real filename, because browsers often save those under a generic or spreadsheet type. The page uses the real filename even when it hides it. A TypeScript file (`.ts`, `.mts`, or `.cts`) that the uploading system typed as an MPEG transport stream (`video/mp2t`), as many systems do, opens as highlighted code instead of in a video player that can't play it; the **File type** filter still lists that type with videos. Earlier builds checked the name shown on the page, so with filenames hidden, a CSV file saved under an Excel type, as Windows saves it, or a RAR or 7z archive saved under a generic type showed **Preview not available**. Text, code, and CSV pages offer **Copy text**.

A browser sends no type for a file whose extension the uploading computer doesn't know, and Flare stores such an upload under the generic type `application/octet-stream`. Markdown files uploaded from Windows are a common case. Text and code stored that way open in the text viewer when the real filename says what they are: an extension Flare [highlights](./pastes#choose-a-useful-filename), a plain-text extension such as `.txt`, `.log`, `.sh`, `.toml`, or `.env`, or a well-known name such as `Dockerfile`, `Makefile`, `LICENSE`, or `README`. Their [library cards](./library#read-a-file-card) show the code or text icon to match. A specific stored type always wins over the name. If a file named like text holds binary data, the page says it isn't text instead of filling the preview with unreadable characters. Text saved as UTF-16 with a byte order mark, as Windows tools write when asked for "Unicode", is read as text; earlier builds showed it with a gap after every character. Earlier builds showed **Preview not available** for every file with a generic type, and tab-separated files opened as plain text.

Earlier builds also showed **Preview not available** for video, audio, and text types outside a fixed list, such as FLAC audio or C# source, and opened an image, video, audio, or PDF file named like an archive, such as `photo.zip`, in the archive browser. Binary formats that were shown as unreadable text, such as WebAssembly modules, compiled Python, and binary Protocol Buffers, now show **Preview not available**.

Text, code, and CSV previews load at most 1 MiB of a file. A larger file shows **Preview unavailable** with a note that it's too large to preview; **Download** and **Copy text** still give you the whole file. Earlier builds capped only CSV files and loaded text and code of any size into the page.

Before a video plays, the page asks Flare where to play it from. If that fails, for example because the file was deleted or the connection dropped, the page shows **Preview unavailable** with **This video couldn’t be loaded.**, or Flare's own message when it sends one. Earlier builds showed the request's status instead, such as **Failed to fetch direct URL: 404**.

### The video and audio player

Video and audio play in Flare's own player instead of the browser's built-in one, so the controls look and work the same in every browser and follow the instance's theme. The browser still decodes and streams the file: which formats play, and how far a file can seek while it loads, are unchanged.

**Video.** The controls sit over the picture and step aside about two and a half seconds after the pointer rests on a playing video. Move the pointer, press a key, or tap to bring them back. They also stay up while one of them has keyboard focus, so the control you tabbed to is never hidden; clicking a control doesn't hold them.

- A large play button in the middle starts the video; clicking the picture plays and pauses it. On a touch screen a tap shows or hides the controls and the button in the middle plays and pauses.
- The timeline shows how much has played and how much has loaded. Click or drag it to seek; hovering shows the time under the pointer.
- **Mute** and a volume slider. Phones show only **Mute**, because they set the volume with their own buttons.
- The speed button steps through 1×, 1.25×, 1.5×, 2×, 0.5× and 0.75×.
- **Picture-in-picture**, in browsers that offer it to pages, and **Full screen**, which a double-click on the picture also toggles. Full screen keeps Flare's controls; on an iPhone, Safari opens its own full-screen player instead.
- At the end, the play button becomes **Replay**.

**Audio.** The player is one inset panel under the file's name. The play button sits beside the timeline, with the position and the length under the timeline. Along the bottom of the panel are **Back 10 seconds**, **Forward 10 seconds**, the speed button, **Mute**, and the volume slider. Phones and narrow panels show only **Mute**. The player is on the page before the file loads and doesn't change size when it does. The same panel plays audio inside an [archive preview](./archives).

Earlier builds placed the audio controls directly on the card in two loose rows, with play in the middle of the second row.

Keyboard shortcuts work while the player or one of its controls has focus. Click a player, or tab to it, to give it focus:

| Key                  | Action                       |
| -------------------- | ---------------------------- |
| **Space** or **K**   | Play or pause                |
| **←** and **→**      | Back or forward 5 seconds    |
| **J** and **L**      | Back or forward 10 seconds   |
| **↑** and **↓**      | Volume up or down            |
| **M**                | Mute or unmute               |
| **F**                | Full screen (video)          |
| **Home** and **End** | Jump to the start or the end |

On a focused button, **Space** presses that button; every other key in the table still works from there, so the arrows seek right after you click **Play** or **Mute**. On a slider you tabbed to, the arrow keys, **Home**, and **End** move that slider. Dragging a slider with the pointer leaves focus on the player, so the keys keep the meanings in the table. Every control has a name for screen readers, and the timeline reads its position as words, such as "1 minute 5 seconds of 3 minutes 25 seconds".

The player remembers nothing between visits: volume and speed start at their defaults each time. The browser's own menu on a video (right-click or long press) still offers what the browser provides there, such as saving the file or looping it.

Earlier builds showed each browser's built-in controls, which differ between Chrome, Firefox, and Safari and ignore the instance's theme.

<Screenshot src="/screenshots/sharing/player-video.webp" alt="Flare's video player paused on a share page: a play button in the middle, and under it the timeline with a time hint, play, mute, volume, the position, speed, picture-in-picture and full screen" caption="The video player's controls sit over the picture and hide while it plays." />

<Screenshot src="/screenshots/sharing/player-audio.webp" alt="Flare's audio player on a share page: an inset panel under the file name with a pause button beside the timeline, 0:11 and 3:25 under it, and back 10 seconds, forward 10 seconds, speed, mute and volume along its bottom" caption="The audio player is one panel in the card, takes the instance's colors, and keeps its size while the file loads." />

<Screenshot src="/screenshots/workspace/share-code.png" alt="Public code file with syntax highlighting and file actions" caption="Text and code are displayed as read-only content on the share page." />

<Screenshot src="/screenshots/workspace/share-video.png" alt="Video share page with Flare's player paused at 0:01: a play button over the picture and the timeline, volume, speed and full screen controls along the bottom" caption="Recordings can play directly in the browser when their codec is supported." />

Browser preview support is separate from upload support. If a preview fails, try downloading the file and opening it in an appropriate application. A share page expanded image viewer shows that shared image; it does not reveal the owner's surrounding library.

Flare never lets an uploaded file run as part of its own site. Raw links, file paths under `/api/files/`, and image previews are served in a browser sandbox, so an HTML page, SVG drawing, or other active document opened from a Flare link cannot run scripts, read the viewer's Flare session, or act on their behalf. SVG images still display; only their scripts are blocked. This protects people who open a link, including administrators reviewing other accounts' uploads.

A public archive exposes its member paths and bytes to authorized recipients through the [archive browser](./archives#browse-an-archive-shared-with-you), even if those files originally had private links or Flare passwords. Protected public archives require the file password before browsing or entry downloads; a private archive remains unavailable to other ordinary users even if they know its password. Share-page browsing does not add files to an account or offer extraction. [Archive creation](./archives#create-an-archive-from-selected-files) defaults to private and does not embed source sharing controls or encrypt the result. An explicitly selected public upload profile can make the new archive public immediately; review its contents and the profile summary before confirming.

## Share pages, raw links, and downloads

The usual share link has a path such as `/your-id/screenshot.png`. It opens the Flare viewer with the instance's presentation and access checks.

Links work for signed-out visitors whatever the file is called. Earlier builds asked them to sign in when a link's name had no extension, for example a file named `README`; those links now open like any other public link.

Files uploaded by earlier builds can have link names that keep characters from the original filename, such as `My Report-1.PDF` or `notes.h#ml`. These links now escape `#`, `?`, `%`, and `\` in such names, so they reach the file: the library's **Open file** and **Copy link**; the file links in **Users → More actions → View content**; the share page's previews, video playback, password form, **Copy link**, **Copy text**, and **Open original**; and the addresses in social previews. Earlier builds wrote those characters as they were, so a link stopped at a `#` or `?`, broke at a `%`, or read a `\` as `/`. Spaces and other characters are written as your browser writes them, so other copied links read as before.

Appending `/raw` requests the file content without the surrounding page. For video files, `/direct` is a helper that returns JSON containing a playback URL: a temporary signed storage URL on S3, or on local storage the file's `/raw` link, carrying the password you sent. It is not a general-purpose download route. Appending `/media` gives an address you can keep, for a player on another site or a bookmark: each request is checked, then redirected to a newly signed storage URL for video and audio on S3, and to the file's `/raw` content otherwise. All three check file access before returning a response. Appending one does not bypass private visibility or passwords. Use the page's **Download** action when you want to save a copy.

A link pasted into a chat app or social network is fetched by that app to draw a preview. [Embeds and link previews](./embeds) explains what each app is given and how to design it.

On S3 storage, an authorized response can provide a temporary signed storage URL. Anyone who obtains that already-issued URL can use it until it expires, even if you subsequently change the Flare file's access settings. Changing visibility or a password affects new Flare access checks; it does not immediately revoke existing storage URLs.

Link previews never contain a signed storage URL. Earlier builds wrote one into a video's preview, where apps kept it: the video in a message stopped playing once the URL expired, six hours after the link was pasted. On S3 storage, previews now name the video's `/media` address, which signs a new URL each time the video is played; on local storage they name its `/raw` address as before. A preview an app made before upgrading keeps the old URL; paste the link again to replace it.

A download sent from a signed S3 URL is saved under the file's name, encoded the same way as a download Flare sends itself. Earlier builds passed the name to S3 unencoded, so a name containing a double quote arrived cut short, and names with characters outside ASCII weren't encoded for the browser.

Dashboard copy buttons and generated screenshot tools copy the normal share-page URL. For automation that needs a different response URL, see the [API guide](../api/index).

### Browser and CDN caching

Content from a private or password-protected file, including what a visitor unlocks with the password, is sent with `Cache-Control: private, no-store`, so browsers and shared caches such as a CDN do not keep a copy. Public files without a password can be cached: their video at the `/api/files/...` content URL that upload tools return, and their image thumbnails, for up to a year. The library and shared folder pages show those thumbnails.

That cache is not recalled when access changes. If you make a cached public file private or add a password, a visitor's browser or a CDN in front of Flare can keep serving the copy it already has. Ask the operator to purge the file's paths from the CDN. A browser keeps its copy until it expires or its cache is cleared. Earlier releases also marked private and password-protected video at `/api/files/...` as cacheable for a year; [operators with a CDN](../hosting/reverse-proxy#keep-access-decisions-in-flare) should purge those paths once after upgrading.

### View counts

The view total on a [library file card](./library#understand-activity-and-refresh) includes share-page visits that show the file and successful `GET` requests to `/{userUrlId}/{filename}/raw`. A share-page visit counts only once the visitor may see the file: the password prompt, a wrong password, and a private file shown as not found add no view. Each raw request adds one view, including a `206` byte-range response used for media playback. Raw requests denied by visibility or password checks, missing files, storage failures before a stream is opened, and `HEAD` probes do not add views.

Opening a [shared folder](./folders#share-a-folder) adds no views. Its image tiles show thumbnails, which are not counted. Earlier builds loaded every image tile from its raw link, so each visit to a shared folder added a view to every image in it.

This is a request count, not a count of unique people or completed transfers. Bots, repeat requests, and each media range request can add views. An app fetching a link's [preview](./embeds) adds a view when it fetches the image or video through `/raw`, not when it reads the card; a `/media` request adds none itself. Opening a share page that loads its content through `/raw` can add both a page view and raw-content views. Browser or external-cache hits that do not reach Flare add no raw views; `/direct` lookups and reads from an issued S3 URL do not add raw views either.

After upgrading, existing totals are retained and new raw requests contribute immediately. Earlier raw requests are not backfilled; no configuration change or database migration is needed. Refresh the library after opening a raw link to see its updated total. Earlier builds also counted every share-page load, including password prompts, wrong passwords, and private files shown as not found; those views stay in existing totals.

If the stored file itself is gone from the server's disk or the S3 bucket, raw links, downloads, and thumbnails answer `404`, like a link to a deleted file, and the raw request adds no view. Earlier builds answered `500` from raw links and thumbnails, and from downloads on local storage. If a raw request returns `500`, Flare couldn't read the stored file or save its view count. The request stops and its storage stream is closed. Ask the operator to [check storage and database availability](../hosting/troubleshooting#raw-links-return-500), then retry; a failed counter write does not add a view.

<Screenshot src="/screenshots/sharing/raw-view-count.webp" alt="Real Flare library showing nine views for raw-view-fixture.txt after one full raw request and one range request" caption="This disposable local file started with seven views. A full raw request and a range request raised its displayed total to nine; a HEAD probe left it unchanged." />

## Give a file a lifetime

With `files.update`, use **Manage expiration** to schedule one of two actions:

- **Delete:** also requires `files.delete`; remove the saved file and stop the link from serving it.
- **Set to private:** also requires `files.share`; stop public access while keeping your file and its storage usage.

For a file that already has an expiration, the dialog opens with its time and its action selected. Earlier versions always selected **Delete file**, so saving a new time for a file set to become private switched it to deletion unless you chose **Set to private** again.

While an expiration is scheduled, the file's share page tells recipients how long they have, as **Expires in …** beside its size, whichever action you chose.

A previously scheduled expiration keeps running if a role grant is later revoked; cancel the schedule explicitly to stop it. Expiry work runs through the server's scheduled worker. A link can remain available until that worker processes the action. Downloaded copies and external caches cannot be recalled by expiration or deletion.

Changing account or profile defaults affects future uploads. To change the lifetime of a file already in the library, update that file's expiration directly. If the file is deleted while you save its expiration, for example from another tab, **Couldn’t update expiration** says **File not found**. Earlier versions said **Failed to schedule file expiry**, or reported a removed expiration as **Expiration removed**.

## Control presentation

The instance administrator can select **Minimal**, **Framed**, or **Delivery** share-page styles and choose which details to show. An upload profile can select a style for its new uploads. All three put the name, type, size, and actions above the preview:

- **Framed** shows the file in a card in the middle of the page, with the uploader in the page header.
- **Minimal** sets the same header and preview on the page itself, without the card around them.
- **Delivery** uses a card across the full width of the page that opens with **A file for you** and names the uploader inside it.

<Screenshot src="/screenshots/customization/share-minimal.png" alt="Minimal Flare share layout centered on the uploaded content" caption="Minimal keeps the focus on the content. Framed and Delivery offer different presentation choices." />

Uploader attribution, filename, size, the expiration notice, footer, and image fit are presentation choices. Hiding the filename on a page does not rename the downloaded file or remove a filename already present in its URL. A page with the filename hidden is titled by the file's type instead, such as **PNG image**; the type itself is always shown. For archives, the page is titled by the archive's type, such as **ZIP archive**, while authorized viewers can still see member paths and names inside the archive. Hidden details are also left out of every [embed](./embeds), but content already fetched by an external service may remain cached there.

See [embeds and link previews](./embeds) for what a pasted link shows, [appearance](./appearance) for personal settings, and [upload profiles](./upload-profiles) for selecting a style per workflow.

::: details My recipient sees “not found,” but the file opens for me
Check visibility first. You can open your private files while another person cannot. Also check whether the link uses an old vanity path, the file was deleted or expired, or the recipient has a disabled folder-share link.
:::

::: details My protected file doesn't ask me for a password
Owners with `files.read` and accounts with `content.read` bypass file-password prompts. Open the link while signed out to check the visitor experience.
:::

::: details Will disabling a folder link revoke the file links inside it?
No. It stops that folder-share route. Individual public file links continue to work. Make individual files private or delete them if those links should stop working too.
:::

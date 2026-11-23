---
title: Find, sheets and paste anywhere
description: Search everything from the bar, manage any file or link from its sheet, and hand Flare a file, link or text on any page.
---

# Find, sheets and paste anywhere

Flare works the same way wherever you are in the dashboard. The bar is where you search, for anything: files, links, folders, pages and settings. Every file and short link has one sheet that shows it and holds everything you can change about it. And whatever you paste on a page, Flare offers the one thing to do with it.

<Screenshot src="/screenshots/continuity/find-files.webp" alt="The dashboard bar turned into a search field with canyon typed; below it, under Files, canyon.jpg with its thumbnail, 3 days ago, 45.16 KB, Public" caption="The bar becomes the search field. Files come first, with what tells them apart." />

## Find anything

Choose the magnifier at the end of the bar's buttons, or press <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> on a Mac) on any dashboard page. The bar's buttons give way to a search field. On a phone, the magnifier beside the menu button opens it full screen.

1. Type what you're after: a file's name or words in a screenshot, a short link's ending or destination, a folder, or a setting by the words you'd use for it, such as `sharex`, `vanity`, `2fa`, `token`, `webhook`, `quota` or `invite`.
2. Move with the arrow keys and press <kbd>Enter</kbd>. A file or a short link opens its [sheet](#a-sheet-for-every-file-and-link), a folder opens in **Files**, and a page or setting opens at that card.
3. To copy a file's or link's address instead, press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd>).

<kbd>Esc</kbd> clears what you typed; press it again, click elsewhere, or <kbd>Tab</kbd> out of it, and the bar's buttons come back. After you open a result, the next time you open Find (within five minutes) it starts from that search, with the result you opened chosen and the words selected, so the next match is a key away and typing starts afresh.

With nothing typed, Find lists your newest files (on **Files**, where the library is right there, it waits for you to type). Pages, settings and actions appear as you type: **Upload files**, **New paste**, **Shorten a link**, and switching your theme with `dark` or `light`.

What Find lists follows your roles: a page or setting your role can't open isn't offered. If your instance has switched a feature off, such as the [MCP server for agents](./agents), administrators who can turn it on see it marked **Off** with where to turn it on; other people don't see it at all.

### The bar is the library's search

On **Files**, what you type in the bar also filters the library as you type, together with its other filters, and Files has no separate search field. Find's first row there is **Keep this search** (**Show matching files** on a phone, where Find covers the library and the library changes only when you choose it), so when files match, <kbd>Enter</kbd> keeps the filtered library and puts Find away; as on every page, <kbd>Enter</kbd> runs the highlighted row, and the arrow keys move to another. When Find offers an action for what you typed, such as **Shorten** for a web address, that comes first instead, and the library keeps its search. On Files, <kbd>Esc</kbd> puts back the search Find opened with, then closes Find; a kept search stays until you clear it with its **×**. When no file matches but Find found a setting, folder or link, that row isn't offered, so <kbd>Enter</kbd> opens what Find did find. Inside a folder or with a filter on, Find also lists matching files from the rest of your library, ahead of **Keep this search**. If you leave Files for a result elsewhere, such as a setting, **Back** returns to the library as it was before you typed. After you close Find, the magnifier shows what the library is searching for: choose it to change the search (it opens selected, so typing replaces it), or **×** beside it to clear it. On a phone the search also shows as a removable **Search:** chip above the library. Links to Files with `?search=` still work.

### What Find searches, and what it never sends

Pages and settings are matched in your browser. Your own files, links and folders are searched on the server once you've typed two characters, after a short pause, five of each at most:

| Kind    | Matches                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Files   | The name; from three characters, also the text found in images ([OCR](./library#read-text-in-images-with-ocr)), listed after name matches |
| Links   | The ending and the destination. Needs `links.read`.                                                                                       |
| Folders | The name. Needs `files.read`, as files do.                                                                                                |

Find never searches the contents of pastes. Some things you type are not sent at all, and on **Files** they don't become the library's search either:

- **Something that looks like a secret**, such as an API key or token: Find says **That looks like a secret, so it wasn't searched.** A link that carries one says **That link carries a token, so it isn't searched or shortened here.**, with **Open this link in Paste** (as a private paste) when your role can't use Links.
- **A web address** (with `https://` or `www.`, a path such as `example.com/page`, or a site ending such as `.com`, `.org`, `.io` or `.dev`; a lone `canyon.jpg` or `notes.md` is searched as a name): Find offers **Shorten** instead, which makes a short link with a random ending and copies it (the notice shows the link and **Manage** opens its sheet), or **Open this link in Links** when it carries a password or token.
- **Text on several lines, or longer than 200 characters**: Find offers **Open this text in Paste**.

Clicking away from the bar on **Files** keeps what you typed as the library's search. Find's own searches go to your own instance in the request body, so they don't appear in web server access logs. On **Files**, though, the words you type become the library's search: they go in the page's address (`?search=`) and in the library's list requests, as the Files search field always did, so they can appear in browser history and access logs there. Secrets, links and long text never do. A key typed by hand is sent a few characters at a time until it looks like a key; the check is meant for keys you paste. Find is for signed-in browsers only. API tokens use the [file](../api/files) and [short link](../api/short-links) list endpoints instead.

## Paste anywhere

Copy something and press <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd>) on any dashboard page while no field has focus. A card opens under the bar saying what you pasted and the one thing to do with it:

| You paste             | The card shows                                                                                      | Its action                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Files or a screenshot | How many, their size, and what they'll get: visibility, expiration, folder and your default profile | **Upload**, with those settings                                                          |
| One web address       | The address, with `https://` added if it was missing                                                | **Shorten**: a random ending, copied. **Choose an ending** opens Links with the address. |
| Other text            | Its lines, the name it would get, and a preview                                                     | **Open in Paste**, which opens [Paste](./pastes) with the text as your draft             |

<Screenshot src="/screenshots/continuity/paste-file.webp" alt="A card under the dashboard bar for one pasted image, 80 KB, Public, Never expires, Unfiled, with an Upload button" caption="A pasted screenshot says where it will go before it uploads." />

Press <kbd>Enter</kbd> or choose the action, or press <kbd>Esc</kbd> or **×** to dismiss the card. Nothing you pasted leaves the page until you choose the action. The settings it shows are your account's current defaults, read again as the card opens (until they arrive it shows only the folder); the server applies the defaults in effect when each upload starts, so a change made in another tab at that moment still wins. To stop a stray paste and Enter from doing something you didn't mean, Enter does nothing for the first moment after the card appears.

Some pastes are handled more carefully:

- **Text is never shared from the card.** It always opens in Paste first, where you choose who can open it. If it looks like it holds a secret (a key, a token, or a link that carries one), the card says what it found, for example **Looks like a GitHub token**, shows no preview, and opens it in Paste as a private paste; that needs `pastes.create` and `files.share`, and without them the card only warns. Find does the same for long text.
- **A link that carries a password or token**, such as a password-reset link or one with `token=`, `code=`, `key=`, `pwd=` (a Zoom invite) or `ticket=` (also as `resetToken=` or in the `#` part) or a signature in it, is never shortened from the card or from Find. The card shows it with its token hidden, says **This link carries a token**, and offers **Open in Links**, where making it public is a step you take yourself. When your role can't use Links, it offers **Open in Paste**, which starts the paste as private (this needs `pastes.create` and `files.share`); with neither, the card only warns. Pasted text that contains such a link is treated like text holding a secret: no preview, and a warning in Paste. Earlier builds of this card let a click shorten it.

Files dropped or pasted while **Files** has a folder open go into that folder when your role can organize folders (`folders.manage`), as dropping does. The card only offers what your role allows: without `links.create` a pasted address opens in Paste, and without `pastes.create` pasted text gets no card.

**Upload**, **Paste** and **Links** keep their own paste handling: pasting files on Upload uploads them, on Paste, paste into the editor (pasting elsewhere on that page does nothing), and pasting on Links fills in the link to shorten.

## A sheet for every file and link

Clicking a file anywhere in the dashboard opens its sheet: a card in **Files**, a result in Find, **Manage** in the notice after an upload, a row on **Upload**, or **Manage** after creating a paste. **Manage** appears when your role can view your files (a role that can only upload gets **Open**, the share page, instead), and after shortening a link when it can view links. The sheet slides in beside the page (full screen on a phone), so you stay where you were. Its address is the page's own with `?file=` added, so **Back** closes it, closing it doesn't leave it in your history, and the address opens it again.

<Screenshot src="/screenshots/continuity/file-sheet.webp" alt="A file sheet for canyon.jpg: the picture with Extract text on its corner, its link with Copy and Link, then Access with Public and Private, Password None with Add, Expires Goes private in 2 days with Change, Folder Wallpapers with Move, Tags None with Add, Activity 57 views, and Share page, Download and Delete" caption="Everything about a file, with each setting where you can change it." />

| Row      | What it shows                                        | What you can do                                                                                                                                                                                                                                | Needs                                                    |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Preview  | The picture, video, audio, document, table or code   | Choose a picture to open it full size                                                                                                                                                                                                          |                                                          |
| Link     | The share page's address                             | **Copy**, in the format chosen beside it (link, direct link or Markdown)                                                                                                                                                                       | `files.share`                                            |
| Access   | **Public** (anyone with the link) or **Private**     | Switch                                                                                                                                                                                                                                         | `files.share`                                            |
| Password | **None** or **Required** (public files)              | **Add**, **Change**, **Remove**; a field being edited has **Cancel**, and <kbd>Esc</kbd> closes the field, not the sheet                                                                                                                       | `files.share`                                            |
| Expires  | **Never**, or for example **Goes private in 2 days** | **Change** opens the choices under it: first **Then delete** or **Then make private**, then Never, 1 hour to 1 month, or a date; a time saves both, and a new outcome for the date already set waits for **Save** (shown in place of **Done**) | `files.update`, plus the permission of what happens then |
| Folder   | Its folder, which opens in Files                     | **Move** lists your folders; choose one                                                                                                                                                                                                        | `files.update` and `folders.manage`                      |
| Tags     | Its tags, each opening Files filtered by it          | **Add** or **Edit** lists your tags to tick, with **New tag…** or **Manage tags…**                                                                                                                                                             | `files.update` and `tags.manage`                         |
| Activity | Views and downloads                                  |                                                                                                                                                                                                                                                |                                                          |

On an image's corner, **Extract text** reads the text in it; an archive's preview has **Browse archive**. At the bottom: **Share page** (the public page, in a new tab), **Download**, and **Delete**. Every change saves at once and shows in **Files** too. Opening a sheet doesn't count a view. When you open a sheet from **Files**, <kbd>←</kbd> and <kbd>→</kbd> open the file before or after it there (a focused video or audio player seeks with them instead), and choosing a picture opens the full-screen viewer that steps through the library's images; a picture that isn't in the library's loaded files, such as one opened from Find, opens full size in a new tab.

The card in **Files** keeps only the quick things in its **⋯** menu: **Browse archive** for archives, **Copy link**, **Download** and **Delete file**. Clicking a card with <kbd>Ctrl</kbd>, <kbd>⌘</kbd> or <kbd>Shift</kbd> held opens its share page instead, as a link does.

Short links have the same kind of sheet, opened from a row on **Links**, from Find, or with **Manage** after shortening a pasted link. It's titled by the site the link leads to, and shows the short link with **Copy**, where it leads with **Change** (needs `links.create` and `links.delete`), its clicks, and its QR code with **Download**. Choosing where it leads opens it in a new tab without counting a click; **Delete** is at the bottom. A link row's **⋯** keeps **Open destination** and **Delete**.

<Screenshot src="/screenshots/continuity/link-sheet.webp" alt="A link sheet titled github.com, Short link made 12 days ago, the short link files.example.com/u/release-notes with Copy, Leads to the v3.1.0 release address with Change, Clicks 97, and a QR code with Download" caption="A short link's sheet: where it leads, its clicks, and its QR code." />

Share pages are the same for everyone, you included: what you see there is what the people you send the link to see.

## Change defaults where you use them

On **Upload** and **Paste**, the option buttons can save what you chose for later, from the same menu:

- The profile button's menu offers **Make Screenshots the default** for the profile you picked, or **Use no profile by default** for **No profile**. Your browser uploads, pastes and [screenshot tools](./screenshot-tools) then use it.
- The expiration button's menu offers **Save as account default** when what you picked is **Never** or **After 1 hour** to **1 month**, it differs from your account default, and saving it would actually change plain uploads. Plain uploads are the ones that pick nothing, so they get your default profile over your account settings: if your default profile sets the expiration or what happens then, saving wouldn't change them, and the menu says **Your default profile, Screenshots, decides expiry** instead and opens your profiles. A date picked with **Pick a date…** can't be saved as a default.

Each save shows a notice with **Undo**, which puts back what was there before. After a later change to the same default in that tab (from the chips, **Profile** or **Upload profiles**), an earlier notice's **Undo** does nothing and says **Nothing undone**, so it can't overwrite the newer choice. If **Undo** fails, its notice offers **Try again**, unless the server refused the old value (for example, a profile deleted since). **Save as account default** needs `profile.update`; **Make … the default** needs `uploadProfiles.manage`. See [the order of settings](./upload-profiles#understand-the-order-of-settings) for how account defaults and profiles combine.

The folder, tags and profile buttons appear whenever your role can use them, even before you have a folder, tag or profile. Their menus make the first one: **New folder…** creates a folder and selects it, **New tag…** opens the tag manager, and **New profile…** opens your profiles.

## Keyboard shortcuts

| Keys                                                             | Where                                | Does                                                 |
| ---------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>                        | Any dashboard page                   | Opens or closes Find                                 |
| <kbd>Enter</kbd> / <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> | Find                                 | Opens the result / copies a file's or link's address |
| <kbd>Esc</kbd>                                                   | Find                                 | Undoes what you typed, then closes                   |
| <kbd>←</kbd> / <kbd>→</kbd>                                      | A file's sheet, opened from Files    | The file before / after                              |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd>                        | Any dashboard page, no field focused | Paste anywhere                                       |
| <kbd>Enter</kbd> / <kbd>Esc</kbd>                                | The pasted card                      | Its action / dismiss                                 |

Flare has no single-key shortcuts outside fields, so typing never triggers one by accident.

## Troubleshooting

- **Nothing happens when I paste.** A field, menu or dialog has focus, or you're on Upload, Paste or Links, which handle pastes themselves. Click an empty part of the page and paste again. Your role may also not allow what you pasted.
- **Find shows "Couldn't search."** The search request failed; pages and settings still appear. Choose **Try again**. A very fast typist can reach the limit of 120 searches a minute; wait a moment.
- **A sheet says "This file isn't here".** It was deleted, or the address names another account's file.

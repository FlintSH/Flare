---
title: Short links
description: Shorten a link under your Flare domain, choose its ending, change where it leads, and find and manage your links.
---

# Short links

**Links** turns a long web address into a short redirect under your instance's domain, such as `https://files.example.com/u/launch`. A short link sends visitors to its destination; it does not copy or host that destination's content.

<Screenshot src="/screenshots/workspace/urls.png" alt="Links page: a pasted GitHub release address with two tracking parameters, the link being made with the suggested ending flare-releases-v3-2-0 and Shorten, and a note offering to remove the tracking parameters, and the list of short links below" caption="Paste a long link; Flare suggests an ending and spots tracking parameters." />

## Shorten a link

1. Open **Links** in the navigation. On a computer, the link field is ready to paste into; pasting anywhere on the page while no field has focus fills it in too.
2. Paste a web address into **Paste a long link**. An address without `https://`, such as `example.com/launch`, gets it added.
3. Check the ending after `/u/`. Flare suggests one from the address's words when it can: `https://github.com/FlintSH/Flare/releases/tag/v3.1.0` suggests `flare-releases-v3-1-0`. Press <kbd>Tab</kbd> in the ending field, or choose **Tab** (**Use** on a touch screen) at its end, to take it. Type your own instead, or leave it empty for a random six-character ending.
4. Press <kbd>Enter</kbd> or choose **Shorten**.

Shortening also copies the new link, so it's ready to paste. To shorten without opening Links, paste the address on any other dashboard page and press <kbd>Enter</kbd> on the card that appears, or type it into **Find** and choose **Shorten**: both use a random ending, and the notice's **Manage** opens the new link's [sheet](./moving-around#a-sheet-for-every-file-and-link) ([paste anywhere](./moving-around#paste-anywhere)). The link appears at the top of the list, briefly highlighted, with **Copied** on its button. If the browser didn't allow the copy, **Link created** appears instead and the row's **Copy** works as usual. If a search is active, creating a link clears it so the new one shows.

While you compose, Flare reads the address in your browser, without visiting it:

- **Tracking parameters** such as `utm_source`, `fbclid` or `gclid`, and `si` on YouTube and Spotify links, are named under the field with **Remove them**. Only those parameters are removed; the rest of the address stays exactly as you pasted it. **Undo** puts them back. Flare never removes them without asking.
- **A link you already have** for the same address is named, with its clicks and **Copy it**, so you can reuse it instead of making a second one. Flare compares the address as pasted and without its tracking parameters, ignoring letter case only in the scheme and host, so a user name or password in the address must match exactly.

An ending can be up to 64 letters, numbers, `-` and `_`. Endings are case-sensitive, but Flare refuses an ending you choose while another link on the instance uses it in any letter case, so a chosen `/u/Launch` can't sit beside `/u/launch` and pass for it. A taken ending shows **That ending is already taken. Choose another.** Your account's vanity URL setting affects uploaded-file URLs, not the `/u/…` path.

If two links created at the same moment draw the same random ending, Flare gives the second one another instead of failing. Earlier versions showed **Internal server error** in that case; choosing **Shorten** again worked. Earlier versions also had no custom endings and no way to change a destination.

<Screenshot src="/screenshots/workspace/urls-complete.png" alt="A newly created link with the ending launch at the top of the list, highlighted, its button reading Copied" caption="A new link appears first, already copied." />

## Find and manage your links

Each row shows the short link, then where it leads without `https://`. The full address is the top line of the row's **⋯** menu. Clicks and the creation date sit to the right, or under the destination on phones. Newer links appear first. Type in **Search links** to filter by ending or destination. When the link you're shortening carries a password or token (a reset link, `token=`, `pwd=` and the like), the field says so before you make it public: anyone with the short link could use it.

- **Copy** copies the complete short link. If the browser refuses clipboard access, press and hold or right-click the short link and copy its address.
- **⋯ → Open destination** opens where the link leads, without counting a click.
- **⋯ → Delete** stops the redirect after you confirm (see below).
- Choose the short link itself to open its [sheet](./moving-around#a-sheet-for-every-file-and-link), the same panel as a file's. Find and **Manage** after shortening open it too.

The sheet holds everything else about the link:

- **Copy** copies the complete short link.
- **Leads to** shows the full destination; choosing it opens it without counting a click. **Change** sends the link somewhere else. Everyone who opens it, including people you already sent it to, goes to the new address from then on. The ending and clicks stay. To use a different ending, create a new link (and delete the old one if it should stop working). **Cancel** or <kbd>Esc</kbd> leaves it unchanged.
- **Clicks** counts redirects (see below).
- **QR code** shows the short link as a QR code, for a slide, a poster or a phone across the room, with **Download**. The code is made in your browser.
- **Delete**, at the bottom, stops the redirect after you confirm. The ending then becomes free, and anyone on this instance can create a link with it, so a deleted link you shared could later lead somewhere else. Deleting a short link does not remove the destination page or prevent someone using its full address. If deleting fails, **Could not delete the link** gives Flare's reason when there is one, such as **Permission denied**; otherwise it says your link still works.

Earlier versions put **QR code** and **Change destination** in the row's **⋯** menu, each in its own dialog.

<Screenshot src="/screenshots/continuity/link-sheet.webp" alt="A link sheet titled github.com, Short link made 12 days ago, the short link with Copy, Leads to the v3.1.0 release address with Change, Clicks 97, and a QR code with Download" caption="A short link's sheet: where it leads, its clicks and its QR code." />

Changing a destination needs both `links.create` and `links.delete`, because it retires the old redirect and makes a new one. **Change** is hidden from roles without both. Listing needs `links.read`, creating `links.create` and deleting `links.delete`. Revoking these dashboard permissions does not disable existing public redirects; delete a link to stop its redirect.

## Understand clicks

The click count increments when the redirect route is requested. It is not a count of unique people. Opening your own link, repeated visits, and services that fetch links can contribute to activity.

Use the count as an indication that a link is being followed. Flare does not show a per-person analytics report on this page.

## Short links and privacy

A short redirect is public to anyone who knows it. It has no separate password or private setting. The destination keeps its own access controls: shortening a private Flare file URL does not make that file public, and shortening a protected file URL does not remove its password.

The destination URL is revealed when the browser redirects. Shortening is a convenience, not a way to hide a sensitive address or make an unsafe destination safe.

## Automate link creation

For a custom integration, use a [named API token](../api/authentication) with `urls:write` to create, change or delete links and `urls:read` to list them. These scopes are separate from file-upload permissions. The [short links API](/api/short-links) covers custom endings and changing a destination.

## Troubleshooting

| Problem                              | Next step                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address rejected                     | Flare adds `https://` to a plain site address such as `example.com/page`; anything else needs its `https://` or `http://`. Check for spaces or malformed characters. Other schemes, such as `ftp://`, show **Only HTTP and HTTPS URLs are allowed**.                                                                   |
| Link goes to the wrong page          | Open the link's sheet, choose **Change** beside **Leads to** and correct the address. The short link people already have keeps working.                                                                                                                                                                                |
| Short link no longer opens           | Check that it still exists and that the instance's domain is reachable.                                                                                                                                                                                                                                                |
| Short link opens a destination error | The redirect may be working while the target page is unavailable or requires sign-in. Test the original URL.                                                                                                                                                                                                           |
| Your list fails to load              | Use **Try again** or reload after checking your connection. A load failure is not a successful deletion. Links you create meanwhile still appear, under the error. After you create, change or delete a link, Flare reads the list again; if that read fails, the list on screen stays as it is, your change included. |
| Ending already taken                 | Another link uses that ending in some letter case. Choose another, or leave it empty for a random one.                                                                                                                                                                                                                 |

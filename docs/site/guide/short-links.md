---
title: Short links
description: Shorten a link under your Flare domain, choose its ending, change where it leads, and find and manage your links.
---

# Short links

**Links** turns a long web address into a short redirect under your instance's domain, such as `https://files.example.com/u/launch`. A short link sends visitors to its destination; it does not copy or host that destination's content.

<Screenshot src="/screenshots/workspace/urls.png" alt="Links page with a search field, a bar to paste a long link with a custom ending field and Shorten, and a list of short links with destinations, clicks, dates and Copy buttons" caption="Shorten a link, then find, copy or change it in the list." />

## Shorten a link

1. Open **Links** in the navigation.
2. Paste a complete web address, starting with `https://` or `http://`, into **Paste a long link**.
3. Optionally type an ending of your own after `/u/`, such as `launch`. Leave it empty for a random six-character ending.
4. Choose **Shorten**.

The new link appears at the top of the list, briefly highlighted. Choose **Copy** to copy it with your instance's domain. If a search is active, creating a link clears it so the new one shows.

An ending can be up to 64 letters, numbers, `-` and `_`. Endings are case-sensitive, but Flare refuses an ending you choose while another link on the instance uses it in any letter case, so a chosen `/u/Launch` can't sit beside `/u/launch` and pass for it. A taken ending shows **That ending is already taken. Choose another.** Your account's vanity URL setting affects uploaded-file URLs, not the `/u/…` path.

If two links created at the same moment draw the same random ending, Flare gives the second one another instead of failing. Earlier versions showed **Internal server error** in that case; choosing **Shorten** again worked. Earlier versions also had no custom endings and no way to change a destination.

<Screenshot src="/screenshots/workspace/urls-complete.png" alt="A newly created link at the top of the list, highlighted, with its custom ending launch" caption="A new link appears first, ready to copy." />

## Find and manage your links

Each row shows the short link, then where it leads without `https://`. The full address is the top line of the row's **⋯** menu. Clicks and the creation date sit to the right, or under the destination on phones. Newer links appear first. Type in **Search links** to filter by ending or destination.

- **Copy** copies the complete short link. If the browser refuses clipboard access, press and hold or right-click the short link and copy its address.
- **⋯ → Open destination** opens where the link leads, without counting a click.
- **⋯ → Change destination** sends the link somewhere else. Everyone who opens it, including people you already sent it to, goes to the new address from then on. The ending and clicks stay. To use a different ending, create a new link (and delete the old one if it should stop working).
- **⋯ → Delete** stops the redirect after you confirm. The ending then becomes free, and anyone on this instance can create a link with it, so a deleted link you shared could later lead somewhere else. Deleting a short link does not remove the destination page or prevent someone using its full address. If deleting fails, **Could not delete the link** gives Flare's reason when there is one, such as **Permission denied**; otherwise it says your link still works.

<Screenshot src="/screenshots/workspace/urls-edit.png" alt="Change destination dialog for a short link, with the full current destination in an editable field and Save and Cancel" caption="Change where a link leads without changing the link people already have." />

Changing a destination needs both `links.create` and `links.delete`, because it retires the old redirect and makes a new one. **Change destination** is hidden from roles without both. Listing needs `links.read`, creating `links.create` and deleting `links.delete`. Revoking these dashboard permissions does not disable existing public redirects; delete a link to stop its redirect.

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
| Address rejected                     | Include the full `https://` or `http://` address and check for spaces or malformed characters. Other schemes, such as `ftp://`, show **Only HTTP and HTTPS URLs are allowed**.                                                                                                                                         |
| Link goes to the wrong page          | Choose **⋯ → Change destination** and correct the address. The short link people already have keeps working.                                                                                                                                                                                                           |
| Short link no longer opens           | Check that it still exists and that the instance's domain is reachable.                                                                                                                                                                                                                                                |
| Short link opens a destination error | The redirect may be working while the target page is unavailable or requires sign-in. Test the original URL.                                                                                                                                                                                                           |
| Your list fails to load              | Use **Try again** or reload after checking your connection. A load failure is not a successful deletion. Links you create meanwhile still appear, under the error. After you create, change or delete a link, Flare reads the list again; if that read fails, the list on screen stays as it is, your change included. |
| Ending already taken                 | Another link uses that ending in some letter case. Choose another, or leave it empty for a random one.                                                                                                                                                                                                                 |

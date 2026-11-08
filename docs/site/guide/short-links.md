---
title: Short links
description: Create short redirects on your Flare domain, copy and manage them, and understand click tracking.
---

# Short links

Your [roles](/admin/roles) control short-link actions independently: `links.read` to list them, `links.create` to create, and `links.delete` to remove. Revoking these dashboard permissions does not disable existing public redirects; delete a link to stop its redirect.

Flare's **Links** page turns a long web address into a short redirect under your instance's domain. A short link sends visitors to its original destination; it does not copy or host that destination's content.

<Screenshot src="/screenshots/workspace/urls.png" alt="Short links page with a URL input and existing links table" caption="Create and manage redirects alongside your uploaded files." />

## Create a short link

1. Open **Links** in the navigation.
2. Paste a complete web address into **URL to shorten**, starting with `https://` or `http://`.
3. Choose **Shorten**.
4. Use **Copy link** or **Open** in the result.

Flare generates a unique six-character code. A result looks like:

```text
https://files.example.com/u/aB3xY9
```

The dashboard does not offer a custom short code. Your account's vanity URL setting affects uploaded-file URLs, not the generated `/u/…` path.

If two links created at the same moment draw the same code, Flare gives the second one another code instead of failing. Earlier versions showed **Internal server error** in that case; choosing **Shorten** again worked.

<Screenshot src="/screenshots/workspace/urls-complete.png" alt="A newly created short link with copy and open controls" caption="Copy the new link directly, or open it to check the destination." />

## Manage existing links

Each row starts with the shareable `/u/…` path and its copy action. The original destination appears below it, so long addresses do not hide the link you want to share. Clicks and creation date have their own columns on wider screens and move below the destination on phones. The delete action stays separate at the row's right edge. Newer links appear first.

Use **Search links** above the list to find a destination, short code, `/u/…` path, or the complete short URL copied from this instance. Matching ignores letter case, and the count shows how many of your links match, such as **2 of 12 links**. A complete short URL uses the same origin as **Copy link**; an address from another domain is not treated as your copied link merely because its code matches. The list loads all your links; searching and sorting happen in your browser. Choose **Newest first** (the default), **Oldest first**, or **Most clicks** from the sort control. Equal dates or click counts keep their existing order. **Clear link search**, or **Clear search** when nothing matches, restores the full list without changing its sort.

Switching accounts or browser sessions clears the search, sort, unfinished URL, created-link result, and open deletion confirmation before loading the new account's links. A creation or deletion already accepted by the server still takes effect for the original account; switching does not undo it.

On phones and touch tablets, the complete destination wraps onto as many lines as needed so you can check its path and query before opening it. Wider mouse layouts keep destinations on one line; hover over an address to read the full destination.

Use the copy action beside the path to copy the complete short URL, including your instance's domain. Open the short path to check the redirect, or open the destination below it directly. If clipboard access fails, right-click or press and hold the short path and use your browser's link menu to copy its address.

To stop a redirect, choose its delete action and confirm. On phones, **Keep link** appears above **Delete link** and receives initial focus. The generated short URL then stops resolving through Flare. If deleting fails, **Could not delete link** gives Flare's reason when there is one, such as **Permission denied**; otherwise it says your link is still available and to try again, which earlier versions said for every failure. Deleting the short link does not remove the original webpage or prevent someone using its full address.

There is no destination editor or scheduled expiration in this interface. Create a new short link for a changed destination and remove the old link if it should no longer work.

## Understand clicks

The click count increments when the redirect route is requested. It is not a count of unique people. Opening your own link, repeated visits, and services that fetch links can contribute to activity.

Use the count as an indication that a link is being followed. Flare does not show a per-person analytics report on this page.

## Short links and privacy

A short redirect is public to anyone who knows it. It has no separate password or private setting. The destination keeps its own access controls: shortening a private Flare file URL does not make that file public, and shortening a protected file URL does not remove its password.

The destination URL is revealed when the browser redirects. Shortening is a convenience, not a way to hide a sensitive address or make an unsafe destination safe.

## Automate link creation

For a custom integration, use a [named API token](../api/authentication) with `urls:write` to create or delete links and `urls:read` to list them. These scopes are separate from file-upload permissions.

## Troubleshooting

| Problem                              | Next step                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Address rejected                     | Include the full `https://` or `http://` address and check for spaces or malformed characters. Other schemes, such as `ftp://`, show **Only HTTP and HTTPS URLs are allowed**. |
| Link goes to the wrong page          | Check the original URL in the table. Create a replacement if it was entered incorrectly.                                                                                       |
| Short link no longer opens           | Check that it still exists and that the instance's domain is reachable.                                                                                                        |
| Short link opens a destination error | The redirect may be working while the target page is unavailable or requires sign-in. Test the original URL.                                                                   |
| Your list fails to load              | Use the retry control or reload after checking your connection. A load failure is not a successful deletion.                                                                   |

The trash action stays neutral in the link list and turns red on hover or keyboard focus. Selecting it still opens a confirmation before the link is removed.

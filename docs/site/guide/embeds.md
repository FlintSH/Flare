---
title: Embeds and link previews
description: Choose what chat apps and social networks show for your links, from the file on its own to a card you write with placeholders.
---

# Embeds and link previews

When you paste a link to a file into a chat app or a social network, the app fetches the link and draws a preview of it, often called an embed. Flare decides what the app is given. You choose between two modes and, if you want, write the card yourself.

Embeds change how a link looks where it is pasted. They never change who can open the file: [visibility and passwords](./sharing#choose-who-can-open-a-file) do that.

## Direct media or a rich embed

| Mode             | What a pasted link shows                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direct media** | Images and videos appear on their own wherever the app can show them that way. Every other file, and every app that needs a page to preview, shows the card. This is the default. |
| **Rich embed**   | Every link shows the card, with the image or video inside it. Use it when you want your site name, an author line, your own wording, or an accent color on everything you share.  |

What each kind of file is given:

| File                                           | Direct media                                                                                                                                                                                                                       | Rich embed                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Image (PNG, APNG, JPEG, GIF, WebP, AVIF)       | The image alone in Discord, Telegram, Slack, Facebook and Messenger, Apple Messages, and Matrix (Synapse). The card with a large image in apps that only draw cards, such as X, WhatsApp, Signal, LinkedIn, Mastodon, and Bluesky. | The card with a large image |
| Video (MP4, WebM, MOV)                         | A player with the title and nothing else in the apps above. The card with the video elsewhere.                                                                                                                                     | The card with the video     |
| Audio                                          | The card, which names the audio for apps that can play it                                                                                                                                                                          | The same card               |
| Anything else, such as text, PDFs and archives | The card                                                                                                                                                                                                                           | The card                    |
| A file behind a password                       | A card titled **Protected file** with the instance name, saying only that the file is protected                                                                                                                                    | The same                    |
| A private file                                 | Nothing: the link answers as if no file were there                                                                                                                                                                                 | Nothing                     |

An image in another format, such as SVG, BMP, or HEIC, counts as "anything else": apps don't preview those, so its link shows the card without a picture.

Earlier builds sent every preview fetcher whose name contained "bot" the file's bytes, unless the link ended in a video extension. A link to a text file, a PDF or an archive therefore showed nothing in Discord or Slack, and image links showed nothing on X or Mastodon, which only preview pages. Those links now show the card. In-app browsers and phones whose names happened to match, such as the X and LinkedIn apps, were sent the bare file instead of the share page; they now get the page.

Each app draws previews its own way, and not every app shows every line. Flare is checked against what the apps document and against the requests their fetchers send, not inside each app.

## Choose your own embed

**Profile → Embeds** appears for accounts with the `files.share` permission. If the instance has turned personal embeds off, it shows **This instance uses one embed for every account.** and a preview of that embed, with no controls.

1. Open **Profile → Embeds**.
2. Choose **Use the instance's**, **Direct media**, or **Rich embed**.
3. To write your own card, turn on **Use my own card**. It starts as a copy of the instance's card.
4. Edit the lines. The preview follows as you type.
5. Choose **Save embed**.

Your choice applies to every link you own, including files you uploaded before. It follows your account, not the device you set it on. It applies while you hold `files.share`: if that permission is removed, your links use the instance's embed again, and your saved choice returns with the permission.

<Screenshot src="/screenshots/embeds/profile-embeds.webp" alt="Profile, Embeds: Rich embed selected, Use my own card switched on with site name, author, title, description and accent color fields, placeholder buttons, and a preview of the card in a chat app and as a link card" caption="Your own card beside its preview. The sample changes between an image, a video, and a file." />

## The card

| Line             | Where apps show it                                                                                                                                | Limit          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Site name**    | A small line above the title, or beside the address                                                                                               | 100 characters |
| **Author**       | A line between the site name and the title. Apps read it from the link's [oEmbed](../api/files#oembed) answer. Discord shows it; many apps don't. | 100 characters |
| **Title**        | The main line, usually a link to the share page                                                                                                   | 500 characters |
| **Description**  | The text under the title. It can have several lines.                                                                                              | 500 characters |
| **Accent color** | The colored edge of the card in Discord. Leave it empty for the app's own color.                                                                  | `#rrggbb`      |

Leave a line empty to leave it off the card. The title is the exception: an empty title shows the file's name. WhatsApp and Signal show no preview without a description, so for them an empty description is filled with the instance's tagline.

A line that comes out longer than its limit once the placeholders are filled in is cut at the limit and ends with `…`. The same goes for a long file name that stands in for an empty title or describes the image to screen readers: it is cut at the title's 500 characters. The accent color goes to the apps Flare knows by name; an app it doesn't know reads the share page, which leaves the color out so it can't tint a visitor's browser.

### Placeholders

Write placeholders into any line and each file fills them in. Select a placeholder under the fields to insert it where you were typing.

| Placeholder        | Becomes                                           |
| ------------------ | ------------------------------------------------- |
| `{{filename}}`     | The file's name                                   |
| `{{size}}`         | Its size, such as `1.80 MB`                       |
| `{{type}}`         | Its type, such as `PNG`, `MP4`, or `Plain text`   |
| `{{uploader}}`     | The owner's display name                          |
| `{{date}}`         | The upload date in UTC, such as `Nov 12, 2026`    |
| `{{views}}`        | The file's views when the app fetched the preview |
| `{{instanceName}}` | The instance's name                               |

For example:

```text
Site name:    {{instanceName}}
Author:       {{uploader}}
Title:        {{filename}}
Description:  {{type}} · {{size}} · {{date}}
```

A placeholder can come out empty. The instance can [hide filenames, sizes, and uploader names](../admin/appearance#sharing) from share pages, and those stay hidden in every embed, whoever wrote the card. The type, upload date, and view count have no such switch: they show wherever the card's writer put them. Flare tidies the line around an empty placeholder:

- A line whose placeholders are all empty is left out. `Uploaded by {{uploader}}` disappears when uploader names are hidden.
- Empty brackets and doubled separators go with the placeholder. `{{filename}} ({{size}})` becomes `photo.png`, and `{{type}} · {{size}} · {{date}}` becomes `PNG · Nov 12, 2026`.
- A hidden filename reads **Shared file** in the title.

Any other text in double braces, and a `{` or `}` on its own, is refused when you save, with the list of placeholders that exist.

### The preview

The preview shows the card for a sample image, video, or file, twice: **In a chat app**, as an app that shows media on its own draws it, and **As a link card**, the stacked card other apps draw. It uses your lines, the instance's name, and the details the instance shows. It is an approximation of other people's apps, not a screenshot of them.

## When a preview doesn't change

Apps keep the previews they make. A change to your embed shows on links pasted from then on.

- Discord keeps a preview for about 30 minutes. To see a change sooner, paste the link with an extra query string, such as `?v=2`.
- Slack keeps a preview for about 30 minutes and Facebook for about a day. A message already sent usually keeps the preview it was sent with.
- Making a file private or adding a password stops new previews. It can't remove a picture an app already copied.

## What a preview can reveal

A preview is built from what an anonymous visitor could see on the share page: the lines you wrote, the details the instance shows, and the file's own image or video. A file behind a password gives a preview only when the link itself carries the password, like the address in your browser after you unlock it. Treat such a link like the password; **Copy link** never includes it.

An app reading the card doesn't add a view to the file. Fetching the image or video through `/raw` does, like any other [raw request](./sharing#view-counts). A video or audio file on S3 storage plays from the bucket, which adds none.

## Check what an app is given

Ask for a link the way a preview fetcher does. This shows the answer for Discord, and for X, which only draws cards:

```sh
curl -sI -A 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' \
  "$FLARE_URL/abc12/photo.png"
curl -s -A 'Twitterbot/1.0' "$FLARE_URL/abc12/photo.png"
```

In direct media mode the first answers `307` with the image's `/raw` address, and the second prints a small page of preview tags. Appending `/embed` to a share link returns that page to a browser too; view its source to read the tags.

::: details My link shows no preview at all
Check that the file is public and opens in a signed-out browser window. Apps fetch previews from their own servers, so the instance must be reachable from the internet over HTTPS at the address in the link. Some apps skip previews for very large images: WhatsApp expects an image under about 600 KB, and Signal under 1 MB.
:::

::: details My video shows a card but doesn't play
Apps play MP4, WebM, and MOV. Other formats get the card without a player. Discord also needs the video served over HTTPS.
:::

::: details The player has black bars beside a tall video
Flare doesn't read a video's dimensions, so it tells apps every video is 1920 × 1080. A portrait video plays inside a wide frame.
:::

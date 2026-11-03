---
description: Send a file request link so anyone, even without an account, can send you files. They arrive privately in your library with your account defaults or an upload profile.
---

# File requests

A file request is a link you send to the people you need files from. They open it, choose their files, and send them. They don't need an account, and large files are fine. Everything they send lands in your library as your own private files, using your account defaults or an upload profile you choose.

<Screenshot src="/screenshots/file-requests/requests-list.webp" alt="Requests page listing Brand assets for the Acme launch as Open with a New files badge, 3 files and 12 MB received, its deadline, and where it saves files" caption="Requests keeps your links in one place and marks the ones with new files." />

## Who can request files

Creating requests needs the **Request files** permission (`fileRequests.manage`) together with **Upload files** (`files.upload`). Administrators always have both. Other accounts get Request files only when an administrator turns on **Let everyone request files** in [Settings → General](/admin/#file-requests) or grants it through a [role](/admin/roles). Until then, requests are administrator-only.

If **Requests** is missing from your navigation, your roles don't include both permissions. Ask an administrator.

## Create a request

1. Open **Requests** and choose **New request**. On the **Upload** page, **Request files** leads to the same place.
2. In **What are you asking for?**, write the title senders see, such as “Photos from Saturday”.
3. Optionally write a **Message for senders**: what to send, which formats you need, or a deadline. Line breaks are kept.
4. Choose an **Upload profile**. **Account default** applies the same defaults as your own uploads, including your default profile if you set one. Choosing a profile applies its tags, expiry, and filename style. The line under the field summarizes what received files get.
5. Choose where to **Save to**: one of your folders, or **Unfiled**. The field appears when you can manage folders and have at least one.
6. Choose whether to **Ask for their name**: **Don’t ask**, **Optional**, or **Required**.
7. Choose when it **Closes after**: 1, 7, 30, or 90 days, or **No deadline**. New requests start at 7 days.
8. Optionally set **Limits**: **Files in total** and **Size in total**. The request is full once it has received that much.
9. Optionally turn on **Email me when files arrive**. See [Get notified](#get-notified).
10. Choose **Create request link**. In **Your request link is ready**, choose **Copy link**, or **Share…** when your browser offers system sharing. **Preview** opens the page senders see.

<Screenshot src="/screenshots/file-requests/create-request.webp" alt="New file request dialog titled Brand assets for the Acme launch with a message, the Client deliveries upload profile and its summary, Save to Acme rebrand, Ask for their name set to Optional, Closes after 30 days, empty limits, and the email switch" caption="The upload profile summary shows what received files get before you create the link." />

<Screenshot src="/screenshots/file-requests/request-link.webp" alt="Your request link is ready dialog with a blurred request link, a Copied button, the closing date, Saves to Acme rebrand, and Share, Preview, and Done buttons" caption="Copy the link and send it. The link is blurred in this screenshot." />

A request link looks like `https://files.example.com/r/` followed by 24 characters, using your instance's address. **Anyone who has the link can send you files** until the request closes, expires, or fills up. Send it to the people you're asking. If it reaches the wrong audience, [replace the link](#change-close-or-remove-a-request).

## What received files get

Received files are ordinary files in your account. These rules decide how they arrive:

| Setting          | For received files                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visibility       | Always **private** when they arrive, whatever the profile or your defaults say. Only you, and people with content-moderation access, can open them until you share them. |
| Tags             | The upload profile's tags. Your filename and OCR tag rules also run.                                                                                                     |
| Expiry           | The profile's or your account's expiry when it deletes files. An expiry that would only make files private does nothing, because they already are.                       |
| Address          | Original or random filenames in the file's address, from the profile or your account. The file keeps the sender's filename as its name.                                  |
| Folder           | The request's **Save to** folder, or Unfiled.                                                                                                                            |
| Storage          | Counts toward your storage quota, like your own uploads. The instance's maximum file size applies to every file.                                                         |
| OCR and webhooks | Images are queued for OCR, and your [webhooks](/api/webhooks) receive `file.ready` for each file, as with your own uploads.                                              |

Files arrive private because senders may send personal documents, and a file's public address can be guessed from its name. Review what arrived, then share the files you want from your library or the file's page.

## What senders see

An open request shows its title, your name, your message, and its limits: the largest file it accepts, how many files or how much space is left, and when it closes.

1. If you asked for a name, the sender enters it under **Your name**.
2. They choose **Choose files or drag them here**, or drop files onto it. They can add as many as they need and remove one before sending.
3. Optionally they add a **Note** for you.
4. They choose **Send 3 files** (the count matches their selection). Each file shows its progress. Files go up in parts of 5 MB (larger only for files over about 50 GB), and Flare retries a dropped connection or a busy server a few times.
5. **Files sent** confirms how many files arrived. While the request is open, **Send more files** starts another batch.

<Screenshot src="/screenshots/file-requests/send-ready.webp" alt="Public file request page titled Brand assets for the Acme launch from Alex Morgan, with the message and limits, the name Sam Lee, three chosen files including an image preview, and a note" caption="Senders see your title, name, and message, and nothing from your library." />

<Screenshot src="/screenshots/file-requests/send-done.webp" alt="Files sent confirmation saying 3 files of 12 MB went to Alex Morgan, with a Send more files button" caption="After sending, the page confirms what arrived." />

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/file-requests/send-page-phone.webp" alt="Photos from Saturday file request on a 390-pixel phone screen with the name field, drop area, and Send files button" caption="The same page on a phone. Choose files opens the phone's file and photo picker." />
</div>

Senders never see your library, other senders' files, or a link to what they sent. The page tells them that only you and the site's administrators can see what they send.

If the request can't take files, the page says so:

| Page title                                    | Why                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **This request is closed**                    | You closed it.                                                                                     |
| **This request has expired**                  | Its deadline passed.                                                                               |
| **This request is full**                      | It reached its file or size limit.                                                                 |
| **This link isn’t valid**                     | The link is mistyped, the request was deleted, or you replaced the link.                           |
| **This request can’t accept files right now** | Something on your side stops deliveries. Senders are never told what; your Requests page shows it. |

<Screenshot src="/screenshots/file-requests/send-closed.webp" alt="This request is closed page explaining that the request no longer accepts files" caption="A closed request explains itself instead of failing silently." />

## Review what arrived

**Requests** lists each request with its status, the files and size received, the last arrival, and its deadline. **New files** marks a request with arrivals you haven't looked at. Open a request to see everything it received, grouped by sender: their name (or “Someone”), their note, when they sent it, and each file. A file's name opens its page, where you can preview, download, or share it. **Open folder** opens the request's folder in your library.

<Screenshot src="/screenshots/file-requests/request-detail.webp" alt="Request page for Brand assets for the Acme launch with its status, blurred link, destination, and a Received section showing Sam Lee's note and three files" caption="Arrivals are grouped by sender, with their note." />

Each batch lists up to 100 files here; the rest are in your library. Received files are ordinary files, so you can search, tag, move, share, or delete them there. Deleting one doesn't give the request room for another: its limits count deliveries, not the files you keep.

## Get notified

With **Email me when files arrive** on, Flare emails you when a sender finishes. A request sends at most one email every 10 minutes; anything that arrives in between is summarized in the next one. If a sender leaves before finishing, the email follows within about 10 minutes of their first file.

The email names the request and says how many files arrived and their total size; **Review files** opens the request. It never includes senders' names, notes, or files, so nobody with your link can put words in an email from your instance. The switch needs [account email](/admin/email) on the instance and a verified email address on your account; otherwise it is unavailable.

Turning email on doesn't report files that arrived more than 10 minutes earlier. You get at most 24 file request emails a day across all your requests, and they pause for the rest of the day once the instance has used 80% of its daily email limit, so account email such as password resets always has room. Skipped emails aren't sent later; your Requests page still shows **New files**.

## Change, close, or remove a request

Open the **⋯** menu on a request:

- **Edit request** changes the title, message, upload profile, folder, name question, deadline, limits, or email. Changes apply to files sent afterward. To give an expired request more time, choose a new **Closes after**; it counts from now.
- **Close request** stops accepting files without changing the link. **Reopen request** starts accepting them again.
- **Replace link** issues a new link. The old one stops working immediately, including uploads in progress. Send the new link to the people who should still send files.
- **Delete request** removes the link and the senders' names and notes. Files it received stay in your library.

Closing, replacing, or filling a request also stops files that are still uploading: a file that finishes afterward is turned away, and the sender sees why.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/file-requests/requests-list-phone.webp" alt="Requests page on a 390-pixel phone screen listing requests with their statuses and Copy link buttons" caption="Requests works on a phone too." />
</div>

## Limits

| Limit                                 | Value                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open requests per account             | 100. Closed, expired, and full requests don't count.                                                                                                             |
| Title, message, sender name, and note | 100, 1,000, 80, and 500 characters                                                                                                                               |
| Size of one file                      | The instance's maximum file size                                                                                                                                 |
| Files and size per request            | Optional: 1 to 10,000 files, 1 MB to 10 TB                                                                                                                       |
| Files on their way                    | 3 per sender's batch and 20 per request at once. They count against the request's limits and your quota until they finish.                                       |
| Unfinished files                      | A file that sends nothing for 10 minutes gives its room back, and its parts are discarded. The sender sends it again. A file that fails is cancelled right away. |
| Deadline                              | 1, 7, 30, or 90 days, or none                                                                                                                                    |
| Sending rate                          | 120 started files, batches, and completions, plus 1,800 parts, per minute from one address. The sender's page retries after a pause.                             |

## When your access changes

Your requests pause when something on your side stops deliveries, and resume on their own once it's fixed. Senders see **This request can’t accept files right now**; your Requests page shows **Paused** with the reason. Requests pause when:

- an administrator removes Request files or Upload files from your roles,
- your storage quota is full,
- your roles no longer allow saving into the request's folder, or
- its upload profile adds tags or deletes files and your roles no longer allow that.

If you delete the request's upload profile, it uses your account default. If you delete its folder, files go to Unfiled. Deleting your account deletes your requests.

## Troubleshooting

| Symptom                                         | What to check                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Requests** is missing                         | Your roles need Request files and Upload files. Ask an administrator.                                                                                        |
| **New request** is disabled                     | You have 100 open requests. Close one you no longer need.                                                                                                    |
| A request shows **Paused**                      | Read the reason under it. Free up storage, choose another profile or folder in **Edit request**, or ask an administrator to restore access.                  |
| A sender says the link isn't valid              | Check that they have the whole link. If you replaced it or deleted the request, send the current link.                                                       |
| A sender's file was refused as too large        | It's larger than the instance's maximum file size or the space left in the request. Raise the request's size limit, or ask an administrator.                 |
| Large files fail partway behind a reverse proxy | Your proxy must accept request bodies of at least 5 MB on `/api/` (up to 64 MB for files over about 50 GB). See [domains and HTTPS](/hosting/reverse-proxy). |
| **Email me when files arrive** is unavailable   | The instance has no account email, or your address isn't verified. Verify it in [your account](/guide/account#verify-your-email).                            |

Administrators can [let everyone request files](/admin/#file-requests) and see deliveries in the [audit log](/admin/audit). Developers can use the [file request API contracts](/api/file-requests), including a script that sends files to a request link. [Watch the recorded walkthroughs](/demos#request-files-from-anyone).

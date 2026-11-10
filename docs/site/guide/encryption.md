---
title: Encrypted and plain files
description: What Flare encrypts in your browser, what the server still sees, how a share link carries the key, and what does not work yet for encrypted files.
---

# Encrypted and plain files

Files you upload in the browser are encrypted on your device before they leave it. Flare's server stores ciphertext. It cannot read the file, its name or its type, and neither can the people who operate it.

A file you upload as **Plain** is stored as it is, as every file was before this release. Uploads from screenshot tools and API tokens are plain too. You choose per upload, and the library marks which files are which.

This page describes what ships in this release. Encryption arrives in stages, and the limits below are real.

## Choose encrypted or plain

The upload form and the paste form have one **Encryption** choice:

| Choice                              | What the server stores                | Link preview on other sites             | Server features                                                                |
| ----------------------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| **Encrypted** (default)             | Ciphertext, with no name and no type  | Generic: "Encrypted file"               | None that read content. See [what does not work yet](#what-does-not-work-yet). |
| **Plain** (can show a link preview) | The file as it is, with name and type | The image, video or filename, as before | Thumbnails, text from images, tag rules, archives, direct video links          |

<Screenshot src="/screenshots/encryption/upload-choice.webp" alt="The upload form with the Encryption choice set to Encrypted and a line saying that the server cannot read the file or its name" caption="Encrypted is the default. The line under the choice says what each option costs." />

Pick **Plain** when a link must show its content in a chat or social preview. A crawler does not run Flare's page and never gets the key, so no design can put the content of an encrypted file into a preview.

You need your encryption keys unlocked to upload an encrypted file. If the form says your keys are locked, choose **Unlock** and enter your [passphrase](./passphrase). Dropping files anywhere in Flare uploads them encrypted with your default upload profile. While your keys are locked, a drop is refused with a message, not sent plain.

## What the server still sees

For an encrypted file the server knows:

- the size of the ciphertext, which is the file size plus 26 bytes and 32 bytes for every 64 KiB,
- the upload time, each access time, and the network address of each visitor,
- the owner, the visibility, the expiration, the folder and the tags you give it,
- the view and download counts,
- whether it has a password,
- the length of its name, roughly, from the size of the sealed name.

The server does not have the name, the type, the content, the key, or the password.

Tag names and folder names are not encrypted in this release. If you tag an encrypted file, the tag's name is visible to the server.

## A link is the key

The address of an encrypted file has no filename in it. It looks like this:

```text
https://flare.example.com/alex/e_3kGq0v8mJtYw2nHc5sLp7A#Zm9vYmFyYmF6cXV4...
```

The part after `#` is the file's key. Browsers do not send that part to a server, so Flare never receives it. **Copy link** builds the link in your browser from your own keys.

- Anyone who has the complete link can read the file, until you delete it or make it private.
- A link without the part after `#` opens a page that says **This link is missing its key**. Chat apps and email clients sometimes cut a link at `#`. Send the link again.
- A link whose key belongs to another file, or was changed, says **This key does not open this file**.
- If someone loses a link, nobody can recover it for them except you: open the file's menu and choose **Copy link** again. Flare cannot resend it, because Flare never had it.
- Do not put the link in a [short link](./short-links). Flare refuses, because a short link's target is stored on the server.

Private files work as before: the server refuses to send a private file to anyone but its owner, whatever link they hold.

## Passwords on encrypted files

A password on an encrypted file is part of its key, not a check the server performs. The link then carries a secret after `#p.`, and the file opens only with the link and the password together. Neither the server nor someone with only the link can test passwords.

- The password is checked in your browser and must pass the same strength check as your passphrase. Short or common passwords are refused.
- Changing the password makes a new link. The old link stops opening the file, with the old password and with the new one.
- Removing the password changes the link back to one that carries the file's key.

Adding a password later does not lock out someone who already has the file's original link. That link holds the file's key, and the key does not change. To be sure, delete the file and upload it again with a password.

Opening a password-protected link takes a moment while your browser derives the key. Flare limits wrong passwords on plain files on the server; for an encrypted file there is nothing for the server to limit, and the link's secret is what makes guessing impractical.

## Viewing and downloading

Your browser fetches the ciphertext, checks every 64 KiB chunk and the end of the file, and decrypts it. A file that was changed or cut after upload is refused: Flare neither shows nor saves it.

<Screenshot src="/screenshots/encryption/media-integrity-failed.webp" alt="Share page of the encrypted audio file board-call-private.ogg showing This file could not be opened: it did not pass its integrity check, it was changed or cut after it was encrypted, and Flare will not show or save it" caption="This file was cut at a chunk border on the server. It is refused before anything plays." />

### Video, audio and downloads

A video or audio file plays without being downloaded first. A [service worker](https://developer.mozilla.org/docs/Web/API/Service_Worker_API) of Flare, a small script your browser runs in the background for this site, answers the player from a local address of the form `/_flare/local/{random}`. When the player asks for a part of the file, the worker fetches the 64 KiB chunks that hold that part, checks them, decrypts them and hands them over. Seeking in a long video therefore fetches the place you seek to, not everything before it, and there is no size limit.

<Screenshot src="/screenshots/encryption/media-video.webp" alt="Share page of the encrypted video product-walkthrough-private.webm paused at 2:24 of 3:00 in the browser's player, with Download and Copy link below and a note that the file is decrypted in the browser" caption="A seek to 2:24 fetched the chunks around that point of the 36 MB file, not the two minutes before it." />

**Download** works the same way: the worker decrypts the file as a stream and your browser writes it to disk, so a file of several gigabytes does not have to fit in memory. If the file fails its integrity check part-way, the browser reports a failed download and keeps no file.

What to know about the worker:

- It holds a file's key in memory only, for the page that opened the file. It writes nothing to browser storage and caches nothing. It handles requests for local addresses and no other request: pages, the API and other sites are untouched.
- Browsers stop an idle worker after about 30 seconds. Its keys go with it. When you press play again, the page hands the key over again and playback continues. You do not have to do anything.
- Signing out, locking your keys, or signing in as someone else makes the worker forget every key at once.
- A local address works only inside the page that made it. Opening one in a new tab shows a refusal, not the file.

**Browsers without a service worker.** Service workers need a secure page (HTTPS, or `localhost`), and some private windows and privacy settings turn them off. A page reloaded with the cache bypassed (Shift and reload) also runs without one until the next normal load. Flare then falls back to the earlier behavior: it downloads and decrypts the whole file in memory before it plays or saves it, with these limits:

| Kind            | Largest file previewed without a service worker | Above that |
| --------------- | ----------------------------------------------- | ---------- |
| Video and audio | 128 MB                                          | Download   |
| PDF             | 64 MB                                           | Download   |

A download without a service worker has no fixed limit, but the whole file must fit in your browser's memory.

### Other previews

Images, text and SVG are small enough to decrypt in memory, with these limits:

| Kind          | Largest file previewed | Above that |
| ------------- | ---------------------- | ---------- |
| Images        | 64 MB                  | Download   |
| Text and code | 1 MB                   | Download   |
| SVG images    | 2 MB                   | Download   |

A PDF opens in your browser's own PDF viewer inside the page. In Chrome, Edge and other Chromium browsers it comes from a local address, whose answer tells the browser to isolate it. In Firefox and Safari it is decrypted in memory and shown in an isolated frame. A Chromium browser without a service worker offers the download instead, because it shows no PDF in an isolated frame. So does a browser without a built-in PDF viewer, such as Chrome on Android.

The viewer's toolbar in a Chromium browser calls every such file `document.pdf`. A local address never carries a file name, because the name of an encrypted file must not reach the server. Use Flare's **Download** button, not the one in the viewer's toolbar, to save the file under its real name.

<Screenshot src="/screenshots/encryption/media-pdf.webp" alt="Share page of the encrypted file contract-draft-private.pdf open in the browser's PDF viewer, whose toolbar shows the title document.pdf" caption="Chromium's own viewer shows the decrypted PDF from a local address." />

Anyone can make a file that opens with your account key, so Flare treats decrypted content as untrusted. HTML, SVG and other files that could run script are never opened as a page: HTML is shown as source text, an SVG is drawn as a picture, and anything Flare does not recognize is offered as a download. A local address answers only with the exact types of images, video, audio and PDF, or as a download, and every answer tells the browser not to guess a type and to run nothing.

### Archives

An encrypted ZIP, TAR, TAR.GZ or GZIP file can be browsed, extracted and created like a plain one. Your browser does the work that the server does for plain archives. [Archives that are encrypted files](./archives#archives-that-are-encrypted-files) lists what is different.

## What does not work yet

These features read file content on the server, so they do not work for encrypted files in this release. The controls are hidden or disabled rather than left to fail.

- **Thumbnails.** Encrypted files show a file-type icon in the library, not a preview.
- **Text from images (OCR)** and searching inside images.
- **Search and the file type filter.** They do not find encrypted files, because the server cannot read names or types.
- **Automatic tag rules** that match filenames or image text.
- **Shared folder links.** An encrypted file in a shared folder is not listed on the folder's public page.
- **Uploads from screenshot tools and API tokens.** They are plain.

Your [data export](./account#an-account-with-encrypted-files) contains encrypted files decrypted, under their real names: your browser builds it, because the server cannot. With your keys locked you can still take the server's export, which holds each encrypted file as ciphertext named by its file ID.

## What encryption does not protect against

- **The served application.** Your browser runs the code that Flare's server sends. Someone who controls the server can change that code to capture keys. This is true of every web application. An administrator's **Custom head** setting is such code too.
- **Your passphrase.** Someone with a copy of the database can try passphrases against your account offline. A long passphrase is your protection.
- **Files that others make for you.** Encrypting to your account needs only your public key, which the server has. A file in your library proves nothing about who made it.
- **Metadata.** Sizes, times, addresses and counts are visible, as listed above.
- **A compromised server hiding or replaying records.** It can hide a file or serve an older password setting. It cannot forge a file's content under an existing link.

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

| Choice                              | What the server stores                | Link preview on other sites             | Server features                                                                            |
| ----------------------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Encrypted** (default)             | Ciphertext, with no name and no type  | Generic: "Encrypted file"               | Your browser does the work. See [what your browser does](#what-your-browser-does-instead). |
| **Plain** (can show a link preview) | The file as it is, with name and type | The image, video or filename, as before | Thumbnails, text from images, tag rules, archives, direct video links                      |

<Screenshot src="/screenshots/encryption/upload-choice.webp" alt="The upload form with the Encryption choice set to Encrypted and a line saying that the server cannot read the file or its name" caption="Encrypted is the default. The line under the choice says what each option costs." />

Pick **Plain** when a link must show its content in a chat or social preview. A crawler does not run Flare's page and never gets the key, so no design can put the content of an encrypted file into a preview.

You need your encryption keys unlocked to upload an encrypted file. If the form says your keys are locked, choose **Unlock** and enter your [passphrase](./passphrase). Dropping files anywhere in Flare uploads them encrypted with your default upload profile. While your keys are locked, a drop is refused with a message, not sent plain.

The form shows first what the selected [upload profile](./upload-profiles#encryption) says: **Plain** for a profile set to Plain, **Encrypted** for every other. Whatever you then select is what happens for this upload. Selecting a different profile shows that profile's value again.

Your administrator can [forbid plain uploads](/admin/#forbid-plain-uploads). The forms then show no choice, only the line that the upload is encrypted and that this server accepts encrypted uploads only. An administrator cannot turn encryption off.

<Screenshot src="/screenshots/encryption/upload-encrypted-only.png" alt="The upload form on a server that forbids plain uploads: the Encryption section has no choice, only a line that says the server accepts encrypted uploads only" caption="With plain uploads forbidden, there is nothing to choose." />

Screenshot tools and scripts encrypt with the [flare-upload program](./screenshot-tools). It holds your account's public key and no private key, so it can add files to your library and cannot read it.

## What the server still sees

For an encrypted file the server knows:

- the size of the ciphertext, which is the file size plus 26 bytes and 32 bytes for every 64 KiB,
- the upload time, each access time, and the network address of each visitor,
- the owner, the visibility and the expiration,
- which folder it is in and which tags it has, by their IDs,
- the view and download counts,
- whether it has a password,
- whether it has a thumbnail and stored image text, and that the uploader said it is an image,
- the length of its name and of its image text, roughly, from the sizes of the sealed records.

The server does not have the name, the type, the content, the image text, the thumbnail, the key, or the password.

For your library as a whole, the server also knows the shape of your folder tree, which folders are shared, how many tags you have, and which file has which tag. It does not have a folder's name, a tag's name, or a tag's rule: your browser seals those too. See [Folders](./folders#folder-names-are-encrypted) and [Tags](./tags#tag-names-and-rules-are-encrypted).

When you search, the server receives what you typed, because it searches your plain files. It is not told which encrypted files matched. If you then open one of them, the server can see that request like any other.

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

## What your browser does instead

The server cannot read an encrypted file, so the features that need its content run in your browser. They work while your keys are unlocked.

| Feature                | How it works for an encrypted file                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thumbnails             | Your browser makes a small WebP image at upload and seals it. [Library cards](./library#encrypted-files-in-the-library) decrypt it in memory.                                 |
| Text from images (OCR) | Your browser reads the image with a recognition program that Flare serves itself, and stores the text sealed. See [OCR](./library#encrypted-images-are-read-in-your-browser). |
| Search, type filter    | Your browser searches names and image text in memory, from a local cache of sealed records. See [Search](./library#search-and-narrow-the-results).                            |
| Automatic tag rules    | Your browser applies them, at upload and later for files that arrived without it. See [Tags](./tags#rules-run-in-your-browser).                                               |
| Shared folder links    | The link carries the folder's key. A visitor's browser opens the folder, the folders inside it and their files. See [Folders](./folders#share-a-folder).                      |

Work that needs your browser waits for it. A file that another device or a tool uploaded without your keys gets its thumbnail, its image text and its automatic tags the next time you open Flare with your keys unlocked.

<Screenshot src="/screenshots/encryption/library-work.webp" alt="File library where three encrypted images still show a file-type icon, with a small status at the bottom left reading Finishing new files, 0 of 3, and a pause button" caption="Files that arrived without a thumbnail or text are finished in the background. The status at the edge of the page shows the progress and can pause the work." />

## Files from before encryption

Files that were in your library before this release are plain files, and they stay plain until you decide otherwise. The server already has them, so it can encrypt them for you: your browser does not download or upload anything.

When the server encrypts one of your files:

- **The content, the name, the type and the image text become ciphertext** that only your keys open. The plain copy is deleted from storage only after the server read the whole file, wrote the encrypted copy, read that copy back and checked it.
- **Its tags, its folder, its visibility, its expiry, its view and download counts and its upload time stay.**
- **Its address changes.** An encrypted file has an address without a name. For a private file nothing breaks, because nobody had a link. For a public file the old link stops and answers "not found". You copy the new link from the library.
- **A password does not carry over.** The server only has a check value of the password you set, and an encrypted file needs the password itself to protect its key. A file that had a password is encrypted without one and made **private**, so it is never more exposed than before. The library marks it **Password removed** until you set a password again or change its visibility yourself.

| File            | What Flare suggests                                                          |
| --------------- | ---------------------------------------------------------------------------- |
| Private         | Encrypt. No link exists that can break.                                      |
| Public          | Keeps working as it is. Encrypt it when you are ready to share the new link. |
| With a password | Keeps working as it is. Encrypt it and then set the password again.          |

This protects your files from now on. It does not undo the past: the server stored these files readable until this moment, and old backups that your administrator has not yet replaced still contain them.

### Choose which files to encrypt

After you have set up your keys, a line above your library says how many files are stored readable. Choose **Choose** to open the question, or close the line to decide later. It comes back the next time you open Flare until you answer, and it never appears if you have no plain files.

<Screenshot src="/screenshots/encryption/existing-files-prompt.webp" alt="File library with a line above it that reads 6 files from before encryption are stored readable, The server can encrypt them for you, with a Choose button and a close button" caption="The question appears above your library one time. Closing it puts it off until you next open Flare." />

1. Read the table. It counts your private files, your public files and your files with a password, and says what encryption changes for each.
2. Pick **Private files** (the suggestion), **All files** or **None**.
3. Choose **Encrypt**. You can keep using Flare right away.

<Screenshot src="/screenshots/encryption/existing-files-choice.webp" alt="Dialog titled Encrypt your existing files with a table of private, public and password files and what encryption changes for each, three choices with Private files selected, a note that backups from before may still contain the files, and a button Encrypt 4 files" caption="The table counts your own files. Private files is the suggestion: nothing you shared changes." />

A small status at the edge of the page shows **Encrypting existing files** with a count while the server works. If your folders or tags still have to be converted, it says **Preparing folders and tags** first: your browser does that part, so keep Flare open with your keys unlocked until the count starts. The server then continues even if you close the tab. Images get their thumbnails from the server during this work; image text and tag rules are finished by your browser afterwards, like for any [file that arrived without them](#what-your-browser-does-instead).

<Screenshot src="/screenshots/encryption/existing-files-progress.webp" alt="File library with four plain files and a small status at the bottom left that reads Encrypting existing files, 0 of 4" caption="The status at the edge of the page counts the files while the server works. You can keep using Flare." />

You can change your answer at any time under **Profile → Your data → Files from before encryption**, with **Change what is encrypted**. Choosing **None** later stops what has not started. It does not turn encrypted files back into plain files; nothing can.

### Encrypt single files

A plain file has **Encrypt** in its menu in the library, and **Select** offers **Encrypt** for several files at once. Flare tells you what changes for the files you picked before it starts: a new link for public files, a removed password for protected ones. This is also how you encrypt files that a screenshot tool with an old configuration uploaded.

### After a public or protected file was encrypted

- **A public file:** open its menu and choose **Copy link**. Send the new link to the people who had the old one.
- **A file that had a password:** it is private now, and its card says **Password removed**. Open its menu, choose **Add password** and type a password. The file is shared again as it was, and people open it with the new link and that password. If you would rather share it without a password, change its visibility instead.

### If a file could not be encrypted

The status turns into **could not be encrypted**. Choose it to open a list with the reason for each file and **Try again**. A file on that list is unchanged and still plain. The most common reason is storage that did not answer; if the list says the stored file is missing, tell your administrator.

<Screenshot src="/screenshots/encryption/existing-files-failed.webp" alt="Dialog titled Encrypt your existing files with a red box that reads 1 file could not be encrypted, the name of the file, the reason The stored file is missing, a note that these files are unchanged and still plain, and a Try again button" caption="A file that failed is listed with its reason. It is still the plain file it was." />

## What does not work yet

These features do not work for encrypted files in this release. The controls are hidden or disabled rather than left to fail.

- **Declarative tool files.** A ShareX `.sxcu` file, an iTake `.itup` file or a `curl` script cannot encrypt. They upload plain files and need a [profile set to Plain](./upload-profiles#encryption).
- **Thumbnails, text and rule tags at the moment a tool uploads.** The flare-upload program has no key that opens your tag rules, makes no thumbnail and reads no text. Its files get all three the next time you open Flare with your keys unlocked.
- **Large archives.** Your browser extracts and creates archives of encrypted files up to a size limit. See [encrypted archives](./archives#archives-that-are-encrypted-files) for the limits and the formats.

Your [data export](./account#an-account-with-encrypted-files) contains encrypted files decrypted, under their real names: your browser builds it, because the server cannot. With your keys locked you can still take the server's export, which holds each encrypted file as ciphertext named by its file ID.

## What encryption does not protect against

- **The served application.** Your browser runs the code that Flare's server sends. Someone who controls the server can change that code to capture keys. This is true of every web application. An administrator's **Custom head** setting is such code too.
- **Your passphrase.** Someone with a copy of the database can try passphrases against your account offline. A long passphrase is your protection.
- **Files that others make for you.** Encrypting to your account needs only your public key, which the server has. A file in your library proves nothing about who made it.
- **Metadata.** Sizes, times, addresses, counts, your folder structure and which file has which tag are visible, as listed above.
- **Someone adding to a shared folder.** Putting a file into a shared folder's list needs only the folder's public key, which the server has.
- **A compromised server hiding or replaying records.** It can hide a file or serve an older password setting. It cannot forge a file's content under an existing link.

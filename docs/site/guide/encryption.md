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

Because an encrypted file is decrypted in your browser's memory before it can be shown, previews have size limits in this release:

| Kind            | Largest file previewed | Above that |
| --------------- | ---------------------- | ---------- |
| Images          | 64 MB                  | Download   |
| Video and audio | 128 MB                 | Download   |
| PDF             | 64 MB                  | Download   |
| Text and code   | 1 MB                   | Download   |
| SVG images      | 2 MB                   | Download   |

A PDF preview needs a browser that opens PDFs inside an isolated frame. Chrome, Edge and other Chromium browsers do not, so they offer the download instead.

Anyone can make a file that opens with your account key, so Flare treats decrypted content as untrusted. HTML, SVG and other files that could run script are never opened as a page: HTML is shown as source text, an SVG is drawn as a picture, and anything Flare does not recognize is offered as a download.

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

## What does not work yet

These features do not work for encrypted files in this release. The controls are hidden or disabled rather than left to fail.

- **Archive tools:** browsing, extracting and creating archives.
- **Video streaming.** A video is downloaded and decrypted whole before it plays.
- **Uploads from screenshot tools and API tokens.** They are plain.

Your [data export](./account) contains encrypted files as ciphertext, named by their file ID, with the records that open them listed in `user-data.json`.

## What encryption does not protect against

- **The served application.** Your browser runs the code that Flare's server sends. Someone who controls the server can change that code to capture keys. This is true of every web application. An administrator's **Custom head** setting is such code too.
- **Your passphrase.** Someone with a copy of the database can try passphrases against your account offline. A long passphrase is your protection.
- **Files that others make for you.** Encrypting to your account needs only your public key, which the server has. A file in your library proves nothing about who made it.
- **Metadata.** Sizes, times, addresses, counts, your folder structure and which file has which tag are visible, as listed above.
- **Someone adding to a shared folder.** Putting a file into a shared folder's list needs only the folder's public key, which the server has.
- **A compromised server hiding or replaying records.** It can hide a file or serve an older password setting. It cannot forge a file's content under an existing link.

---
title: Find files with search
description: Find a file without its filename, by the words inside it, its tags or its folder, and see why each result matched.
---

# Find files with search

Searching your library needs `files.read`. It only ever looks at your own files.

You don't need to remember a filename. Flare reads your files in the background and searches the words inside them along with names, tags and folders: the text in a screenshot or photo of a receipt, the pages of a PDF, a Word document, a spreadsheet, a paste, or the names of the files inside a ZIP. Every result says why it matched, with the matching words marked.

All of this happens on your Flare server. Flare doesn't send your files, their text or your searches to another service.

<Screenshot src="/screenshots/search/search-results.webp" alt="Searching the library for lisbon: a CSV file matched by its text, a ZIP matched by a file inside it, and a PDF matched by its text, each with the matching word marked" caption="Each result says where the word was found: in a file's text, inside an archive, in its name, tags or folder." />

[Watch a 43-second recording](/demos#find-files-by-what-is-inside-them) of these steps.

## Search your library

1. Open **Files**.
2. Type in **Search names, text in files, tags and folders…**. Results update as you type; press Enter to search at once.
3. Read the line under each result to see why it matched, then open the file as usual.

While you search, results are sorted by **Best match**. A word in the filename counts most, then a tag, the folder, and the file's text; among equally good matches the newest comes first. Choose another order in the sort menu if you'd rather see the newest or largest first. **Best match** only appears while you search, and clearing the search goes back to **Newest first**.

Search combines with every other control: a folder, a tag, **Visibility**, **Type & size** and **Upload date** narrow the results further.

## What search looks at

| Place              | What matches                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**           | Any part of the filename. Separators don't matter: `finalreport` finds `final_FINAL(2).docx` and `2024-03-01` finds `IMG_20240301_093012.jpg`.   |
| **Tags**           | Any part of a tag's name, such as `receipt` for the **Receipts** tag.                                                                            |
| **Folder**         | The file's folder and the folders above it: `taxes 2024` finds a file in **Taxes / 2024**.                                                       |
| **Text in image**  | Text Flare recognized in a screenshot, photo or scan (OCR), when your administrator has it turned on.                                            |
| **PDF text**       | The selectable text of a PDF, up to its first 200 pages.                                                                                         |
| **Document text**  | Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`) and OpenDocument (`.odt`, `.ods`, `.odp`) files.                                           |
| **File text**      | Pastes, text, Markdown, CSV, JSON, YAML, code, HTML and SVG files: the first 1 MiB.                                                              |
| **Inside archive** | The paths of the files inside a ZIP, TAR or TAR.GZ archive, such as `photos/lisbon-tram-28.jpg`. Flare doesn't read the contents of those files. |

Letter case and accents don't matter: `resume` finds `Résumé – Jane Doe.pdf`. Text in files matches the start of a word, and a trailing "s" is ignored on longer words, so `invoices` finds a PDF that says "Invoice". Flare keeps the first 100,000 characters of text from each file.

## Write a search

Every word has to match somewhere, though not all in the same place: `lisbon receipt` finds a photo tagged **Receipts** whose text mentions Lisbon. Choose **Search tips** (the question mark in the search box) for a short reminder of these:

| Write          | To find                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `"total due"`  | The words together, in this order                                               |
| `-draft`       | Files without the word                                                          |
| `name:report`  | The word in filenames only                                                      |
| `text:wifi`    | The word in text Flare read from the file only                                  |
| `tag:receipts` | The word in tag names only                                                      |
| `in:taxes`     | The word in folder names only, including parent folders. `folder:` is the same. |
| `type:pdf`     | An extension, such as `pdf` or `docx`, or a kind: `image`, `video`, `audio`     |

<Screenshot src="/screenshots/search/search-tips.webp" alt="The Search tips popover listing example searches: invoice lisbon, a quoted phrase, -draft, name:, text:, tag:, in: and type: prefixes, each with what it finds" caption="Search tips sits in the search box." />

A colon that isn't one of these prefixes is part of the word, so `11.32` or `10:32` still finds a screenshot named after the time it was taken. Searches can be up to 500 characters, and only the first 12 words count.

### When no file has every word

When nothing has all your words, Flare shows the files that have some of them, best matches first, rather than an empty page. A note under the search box says so, and each result shows what it's missing, such as **Missing: ~~wifi~~**. Searching `wifi password` still finds a router screenshot that says "Wireless settings … Password".

Words you excluded with `-` and words limited with a prefix such as `type:` must still match.

On a phone, the explanation sits under each card the same way.

<Screenshot src="/screenshots/search/search-mobile.webp" alt="A search result on a narrow phone screen: a boarding pass photo with Text in image and the words BOARDING and Gate marked in the recognized text" caption="Searching boarding gate on a 390-pixel-wide screen finds a photo by the text in it." />

<Screenshot src="/screenshots/search/search-partial.webp" alt="Searching wifi password: a note says no file has every word, and a screenshot of router settings shows the word Password marked and Missing: wifi" caption="No file mentions wifi, so Flare shows the closest result and the word it lacks. The router details are made-up demonstration data." />

## Narrow by size

**Type & size** holds the file type list and, below it, **Size**: **Under 1 MB**, **1 to 10 MB**, **10 to 100 MB** or **100 MB and larger**. Choose the checked size again to clear it. The filter shows as a chip under the search box, and **Reset filters** clears it too.

## See what search has read

Flare reads new files in the background a few seconds after they're uploaded, one or two at a time, and one image at a time for text recognition. Uploading never waits for it. A line under the search box shows progress while you search, or whenever files are still being read or couldn't be read:

- **Reading 12 files for search** while new files wait their turn.
- **Text read from 17 of 24 files** when Flare has caught up. Names, tags and folders of every file are searchable whatever it found.
- **2 files couldn't be read** when reading failed. Choose it to list those files.

<Screenshot src="/screenshots/search/search-reading.webp" alt="The library while searching for receipt, with a spinner and Reading 27 files for search under the search box" caption="Progress shows under the search box while files wait to be read." />

Results don't change under you while files are being read. When reading finishes for more files during a search, choose **More files were read. Update results** to include them.

<Screenshot src="/screenshots/search/search-index-failed.webp" alt="The library filtered to files that couldn't be read: a damaged PDF and a damaged ZIP, each with the reason, and a Try reading them again button" caption="Files Flare couldn't read, with the reason and a way to try again." />

Choosing the failed count filters the library to **Couldn’t be read**, and each card explains why, such as "Flare couldn’t read this PDF. It may be damaged." Choose **Try reading them again** after replacing a storage disk or fixing a file's storage. Flare reads those files again in the background, and the view adds **Waiting to be read** so you can watch them until each shows its new result. You can ask up to 10 times in 10 minutes. Remove the filter with its chip.

Every file is in one of these states:

| State                       | Meaning and what to do                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Waiting to be read**      | Not read yet. New uploads usually take seconds; after an upgrade, existing files are read newest first, which can take a while for a large library.       |
| **Text found**              | Searchable by its text.                                                                                                                                   |
| **No text found**           | Read fine, but there were no words, like a photo of a sunset, or a scanned PDF whose pages are pictures. Flare doesn't run text recognition on PDF pages. |
| **Couldn’t be read**        | Flare tried up to three times and failed: the file may be damaged, encrypted, password protected or missing from storage.                                 |
| **Skipped**                 | Reading that kind of file is turned off on this server, or the file is over a size limit: 25 MB for images, 50 MB for PDFs and Office files.              |
| **Contents not searchable** | Flare doesn't read this kind of file, such as video, audio, HEIC images or binary data.                                                                   |

Skipped files are read when your administrator turns reading back on. Find any state by choosing it from the status line; the card under each file then shows its state and reason.

## Privacy

Only you see your files' text. Search results contain a short excerpt around the matching words, and only your own searches can return it. Password-protected and private files are searched like your other files, since they're yours. Administrators with **View content** can open your files, but their searches of your library in **Users** match filenames and recognized image text only.

Text recognition and document reading run in the Flare server process. Flare downloads its English recognition data the first time it recognizes an image, but never uploads your files anywhere.

## Troubleshooting

- **A file you expected is missing.** Check that the filters and folder are what you want, then **Reset filters**. If the line under the search box says files are still being read, wait and choose **More files were read. Update results**.
- **Text in an image wasn't found.** Recognition reads clear, printed English text best. Open the file's menu and choose **Extract text (OCR)** to see what Flare read; that text is what search uses.
- **A PDF has no text.** Scanned PDFs are pictures of pages. Run them through a PDF tool with text recognition, upload the result, and Flare reads its text.
- **Your administrator turned reading off.** The status line counts those files as skipped. Names, tags and folders still match.

Search reads your files on the server you use. Its speed depends on that server and how many files you have: on a library of 50,000 files, searches by name took under a tenth of a second in our tests, and searches for common words in file text up to about half a second.

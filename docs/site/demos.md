---
title: Interactive demos
description: Walk through real Flare screens, watch recorded workflows, and experiment with upload settings.
---

<script setup>
import { withBase } from 'vitepress'
</script>

# A closer look at Flare

Explore real screens before you install, or discover a feature you have not tried yet. The walkthrough uses captured app screens; the settings lab runs locally in your browser. Neither connects to a live account.

## Explore the workspace

Choose a step, then enlarge the screenshot to inspect the details. The screenshots use demonstration accounts and files.

<DemoTour />

## Watch real workflows

These short, silent recordings capture actual browser interactions with Flare and an isolated test database. Playback is manual and downloads only when requested. The written steps below each video are also its descriptive transcript.

The audit, authenticator, passkey-enrollment, invitation, role, and session recordings retain an earlier visual revision. Their recorded actions and server operations are unchanged. Current guide screenshots show the password guidance, visibility controls, and administrator recovery hint now present in those forms. The passkey-required response recording below shows the current refusal screen.

### Browse a large library

<video class="demo-video" controls playsinline preload="none" aria-label="Browse a large library: silent Flare recording with demonstration files" :poster="withBase('/screenshots/timeline/library-desktop.webp')" :src="withBase('/demos/timeline-scroll.mp4')">Your browser does not support this video. Follow the transcript below.</video>

1. Open **Files** in the isolated demonstration account. The library shows **12,000 files** and its newest uploads from October 2026. The folder directory starts collapsed, leaving the file cards close to search.
2. Scroll down through the file cards. More files appear in the same continuous list, and the slim rail at the right shows the current upload period.
3. Drag the date rail to the middle of the upload history, then press End to jump to the oldest uploads, from July 2018. Each destination loads directly without stepping through intervening pages.
4. Return to the beginning, choose **Select**, and select visible files. Scroll until those cards leave the view; the selected count stays available in the selection bar. Return to the beginning and confirm the original cards remain selected.
5. Finish the selection with **Done** and search for **Northern lights**. The count becomes **1,000 files**. Clear the search to restore the full library.

This recording uses real application requests and a disposable account seeded with 12,000 demonstration files across several years. The upload dates and file contents are fixtures; the scrolling, date jumps, selection, and filtering are actual browser interactions. It does not measure the performance of your server or storage provider. [Follow the library guide](./guide/library#scroll-through-your-library) for keyboard controls, selection limits, and retry behavior.

### Browse the same library on a phone

<div style="max-width: 390px; margin-inline: auto">
<video class="demo-video" controls playsinline preload="none" aria-label="Browse the same library on a phone: silent Flare recording with Chromium touch emulation" :poster="withBase('/screenshots/timeline/library-mobile.webp')" :src="withBase('/demos/timeline-mobile.mp4')">Your browser does not support this video. Follow the transcript below.</video>
</div>

1. Open the demonstration library at 390 × 844. The compact **Your files** row shows **12K files**. Search, **Filters**, and the collapsed folder directory sit above the first file. Sorting is inside **Filters**.
2. Swipe upward through the newest uploads. The page scrolls normally, and the date bubble stays hidden.
3. Drag the visible date-rail thumb down to the oldest uploads, from July 2018. The date bubble appears during the drag and disappears when the thumb is released; the first and last year labels stay hidden.
4. Drag the thumb back up to October 2026, then swipe downward to return to the compact file controls and the first upload.

This recording uses Chromium touch emulation with a coarse pointer and real browser touch gestures against an isolated instance seeded with 12,000 demonstration files. The page scrolling, date jumps, and resulting files are real application behavior. This is not a physical-phone test or a measurement of your server's performance.

### Review and revoke browser sessions

<video class="demo-video" controls playsinline preload="none" aria-label="Review and revoke browser sessions: silent Flare recording" :src="withBase('/demos/session-management.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Open **Profile → Account** on the isolated demonstration instance and scroll to **Active sessions**.
2. Review **This browser** and the other signed-in browser sessions, including their sign-in methods and activity times.
3. Inspect **Login history**, where a rejected demonstration password appears as **Failed** beside successful sign-ins.
4. Choose **Revoke session** on another browser and confirm **Revoke session**. The list reloads without that session; the browser check separately verifies its next authenticated request is rejected.
5. Choose **Revoke all sessions** and confirm **Revoke all and sign out**. The current browser returns to sign-in too.

The recording uses real browser sign-ins and server revocations against a disposable database. Revocation applies to subsequent protected requests; API credentials and previously issued storage URLs have separate lifetimes. [Follow the account guide](./guide/account#login-history-and-active-sessions). The recording stays at desktop width. Separate screenshots and browser checks in that guide cover the mobile controls.

### Investigate instance activity

<video class="demo-video" controls playsinline preload="none" aria-label="Investigate instance activity: silent Flare audit-log recording" :src="withBase('/demos/audit-investigation.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Open **Admin → Audit log** on the isolated demonstration instance with an administrator session. The page starts in **Changes**, with **More filters** closed; this scope hides Requests and routine successful access.
2. Review recent changes, including file deletion and the audit failures produced by invalid-filter checks.
3. Enter **quarterly-report.txt** in **Search activity**, choose **Apply filters**, and expand a **File delete** event. The deleted filename and acting account remain recorded.
4. Review **Recorded details** and request context. Open **More filters**, choose **Clear filters**, set **Event scope** to **All activity** and **Outcome** to **Denied**, and apply. Choose **Hide filters** to review refused requests.
5. Add **missing-demo-filename** to search and apply. Flare shows **No activity matches these filters**. Reopen **More filters**, choose **Clear filters**, select the **Changes** quick view, and choose **Hide filters** to return to recent changes.

These screens display real events. Before the recorded page opens, API requests upload demonstration files, change visibility, download a report, attempt denied access, run actual OCR on a generated receipt image, reject OCR on a text file, delete the report, assign a role, and change an instance setting. The recording shows investigation of those events; it does not show the setup operations. The receipt image is generated test input, and the server performs real OCR; it is not a fabricated application screenshot. The audit log begins when the feature is installed, retains selected metadata, and does not capture every request outside Flare. It is not a tamper-evident ledger. [Read the audit guide](./admin/audit) for access, filtering, privacy, and retention; the guide also includes desktop and mobile screenshots. The recording stays at desktop width; mobile layout is covered by those separate captures and browser checks.

The audit guide also includes a [separate real-server archive investigation capture](./admin/audit), produced by creating, browsing, downloading from, and extracting an archive on the disposable instance. [Reproduce the combined archive/audit check](./contributing#sessions-and-audit-browser-checks-and-demos) to verify those events; they are separate from the recorded investigation above.

### Browse and extract an archive

<video class="demo-video" controls playsinline preload="none" aria-label="Browse and extract an archive: silent Flare recording" :src="withBase('/demos/archive-browse-extract.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. In Alex Morgan's demonstration library, open the menu for **Field kit.zip** and choose **Browse archive**. Flare displays four files and four folders. The arrow keys, **End**, and **Home** move focus through the folder list.
2. Search for **README** and select **guide/README.md**. Its text appears beside the matching path, with a **Download entry** action.
3. Search for **flare-icon** and select **images/flare-icon.png**. Flare previews the verified PNG directly from the archive.
4. Clear the search and choose **Extract all**. Select **Campaigns** under **Save to** and enter **Field kit unpacked** as **New folder name**.
5. Keep **Private (no profile)** and choose **Extract files**. **Archive extracted** confirms that four private files were saved and the original archive remains unchanged.
6. Choose **Open folder**. The wrapper contains **drafts**, **empty**, **guide**, and **images**. Open **guide** to see the new **README.md** and **checklist.csv** library files.

The app reads a real stored ZIP and publishes its new folder tree to the disposable database. The browser checks also verify the extracted bytes, the preserved empty directory, and the unchanged source archive. [Follow the archive guide](./guide/archives#browse-and-preview-entries) and [reproduce the checks](./contributing#archive-browser-checks-and-demos).

### Preview files in a large archive

<video class="demo-video" controls playsinline preload="none" aria-label="Preview files in a large archive: silent Flare recording" :src="withBase('/demos/archive-large-preview.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Open the menu for **Studio handoff.zip**, a 906 MB ZIP, and choose **Browse archive**. The listing appears at once: 20,025 files in 114 folders, 908 MB unpacked. **Extract all** is unavailable, and the line below it explains that the archive is larger than the 256 MB extraction limit.
2. Open **media** and select **share-walkthrough.webm**. The video plays inside the archive and jumps near its end without the rest of the archive being read.
3. Select **notification.wav** to show the audio player.
4. Return to **Archive root**, open **logs**, and select **server-2026-10-17.log**. Its first 256 KiB appear, and **Load more** adds the next 256 KiB of the 6 MB log.
5. Return to **Archive root**, open **photos** and then **2026-10**, and select the first image. **Expand** opens the full-screen viewer, and the right arrow moves to image 2 of 20.
6. Close the viewer; the image shown last is selected in the list. Search for **module-19999** to find one file among 20,000 project files.
7. Clear the search, return to **Archive root**, and open **projects**, **campaign-01**, and **src**. Pressing **End** in the list moves focus to **module-19968.ts**, the last of 417 files.

The archive is a disposable fixture generated for the check: 20 real Flare screenshots as photos, a real Flare recording as the video, a generated tone, a generated server log, 20,000 small project files, and a 900 MiB block of random data. It was uploaded through the normal chunked upload API to the local storage provider. The browser checks also confirm that seeking the video used partial (`206`) responses. [Read how Flare handles large archives](./guide/archives#large-archives).

### Read a large TAR.GZ

<video class="demo-video" controls playsinline preload="none" aria-label="Read a large TAR.GZ: silent Flare recording" :src="withBase('/demos/archive-large-tgz.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Open the menu for **Render outputs.tar.gz**, a 337 MB compressed archive, and choose **Browse archive**. A progress bar shows how much of the compressed data has been read, and the **frames** folder is listed while reading continues.
2. When reading finishes, the summary shows 81 files and 480 MB unpacked, and explains why **Extract all** is unavailable.
3. Search for **approved** and select **summary/approved-cut.md**, the last file in the archive. Its text appears in well under a second, because Flare resumes reading near the file instead of decompressing the archive from the start.

This TAR.GZ is a disposable generated fixture of 80 alternating log and random-data files plus a short summary at the end. TAR.GZ and GZIP files have no index, so the first read always takes time proportional to their size; later previews of the same archive start near the file while its index stays in memory.

### Create an archive with a saved profile

<video class="demo-video" controls playsinline preload="none" aria-label="Create an archive with a saved profile: silent Flare recording" :src="withBase('/demos/archive-create.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. In **Files**, choose **Select** and select **Field notes.txt** and **Launch checklist.csv**.
2. Choose **Create archive**, enter **Launch handoff.zip**, leave **Format** on **ZIP**, and select **Campaigns** as the destination. The initial profile choice is **Private (no profile)**.
3. Explicitly select **Public handoff** under **Upload profile**. Review the summary: public visibility, **1 week, then private**, randomized URL filenames, Delivery share page, and one tag. The form warns that public outputs expose their contents.
4. Choose **Create archive**. **Archive created** confirms the new file without changing the originals.
5. Choose **Open archive**. The generated ZIP contains **Field notes.txt** and **Launch checklist.csv** at its root.

This is a real stored ZIP generated from two private fixture files. The explicit profile makes the result public, applies the **Approved** tag, and sets expiration to make it private after one week. The server checks the displayed profile and effective settings before publication, including inherited defaults. The same browser suite separately exercises private TAR.GZ creation and profile-based extraction. [Review profile and privacy choices](./guide/archives#choose-an-upload-profile-deliberately) before packaging your own files.

### Browse and download a shared archive

<video class="demo-video" controls playsinline preload="none" aria-label="Browse and download a shared archive: silent Flare recording" :src="withBase('/demos/archive-share-browse.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Open the public **Field kit.zip** share page while signed out. **Archive contents** shows four files and four folders inline, above the whole-file **Download** action.
2. Open **guide** and select **README.md**. The text appears beside the folder contents.
3. Choose **Download entry**. The browser saves the actual **README.md** bytes and keeps the share page open.
4. Search for **flare-icon** and select **images/flare-icon.png**. The verified image appears without extracting files into an account.

This recording uses an anonymous visitor and a real unprotected public archive. The browser checks verify the downloaded bytes and that no **Extract all** action appears. Separate, unrecorded checks exercise protected-file access, reject missing or incorrect passwords, and deny unrelated visitors after the source becomes private. The guide includes the [password gate, unlocked page, and mobile captures](./guide/archives#browse-an-archive-shared-with-you). Existing file visibility and password rules apply to every shared entry request.

### Invite someone with a role

<video class="demo-video" controls playsinline preload="none" aria-label="Invite someone with a role: silent Flare recording with the invite token blurred" :poster="withBase('/screenshots/invites/create-invite.webp')" :src="withBase('/demos/admin-invite.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. As the demonstration administrator **Alex Morgan**, open **Settings → Access → Invites**. Turn on **Let everyone create invites**, then choose **Save settings**. **Settings updated** confirms the change.
2. Open **Admin → Users** and choose the **Invites** tab. It shows **No invites yet**.
3. Choose **Create invite** and enter the note **For Sam Rivera**. Keep **Uses** at **1 person** and choose **7 days** under **Expires after**.
4. Select the **Admin** role. A warning explains that anyone using the link becomes a full administrator. Clear **Admin** and select **Moderator** instead.
5. Choose **Create invite link**. **Your invite link is ready** shows the link, blurred in this recording. Choose **Copy link**; the button changes to **Copied**. The summary reads **Single use**, the expiry date, and **Grants Moderator**.
6. Choose **Done**. **For Sam Rivera** appears as **Active** with **0 of 1 use** and the **Moderator** role.

This recording performs real settings and invite operations on an isolated instance whose registration is closed. Turning on the switch grants Create invites to the Everyone role. [Read the administrator guide](./admin/users#invite-links).

### Join with an invite link

<video class="demo-video" controls playsinline preload="none" aria-label="Join with an invite link: silent Flare recording of a new account registration" :poster="withBase('/screenshots/invites/register-invite.webp')" :src="withBase('/demos/join-with-invite.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. In a separate signed-out browser, open the invite link from the previous recording.
2. **You’re invited** explains that **Alex Morgan invited you to join Flare** and lists the **Moderator** role.
3. Enter the username **Sam Rivera**, the demonstration address `sam@invite-demo.example`, and a password twice. The password is masked.
4. Choose **Create account**. Flare creates the account, signs in, and opens **Your files**. The bar shows **Users** because the invite granted Moderator, whose only administration page it is.

Afterward the single-use link is spent: opening it again shows **Invite unavailable** with **This invite link has already been used.** In **Users**, Sam’s account shows **Invited by Alex Morgan**. [Read what invited people see](./guide/invites#what-the-invited-person-sees).

### Let members invite people

<video class="demo-video" controls playsinline preload="none" aria-label="Let members invite people: silent Flare recording of Profile Invites with the invite token blurred" :poster="withBase('/screenshots/invites/profile-invites.webp')" :src="withBase('/demos/member-invites.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. As the ordinary member **Jamie Rivera**, open **Profile → Invites**. The note explains the member limits: up to five active invites, each link works once and expires within 30 days.
2. Choose **Create invite** and enter the note **For Priya**. **Uses** offers only **1 person**.
3. Under **Expires after**, choose **1 day**. Longer choices such as **90 days** and **Never** are not offered to members.
4. Choose **Create invite link**, then **Copy link**. The link is blurred in this recording.
5. Choose **Done**. **For Priya** appears as **Active** with **Copy link** and **Revoke** buttons.

The member has no role picker because they cannot assign roles. [Read about member limits](./guide/invites#limits-for-members).

### Enable, use, and recover two-factor authentication

<video class="demo-video" controls playsinline preload="none" aria-label="Enable, use, and recover two-factor authentication: silent Flare recording" :src="withBase('/demos/two-factor-demo.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Sign in to the isolated **Alex Morgan** account and open **Profile → Account → Sign-in security**.
2. Choose **Set up authenticator**, confirm the current password, and choose **Continue**. The real setup dialog displays the QR code and manual key; both are concealed before the recording captures a frame.
3. Enter a current authenticator code and choose **Enable two-factor authentication**.
4. In **Save your recovery codes**, download the ten codes, select **I have saved my recovery codes somewhere safe.**, and choose **Done**. The recording conceals the code values; the test deletes the downloaded fixture file afterward.
5. Choose **Sign in again**, submit the email/password, then enter a fresh code at **Verify your identity**. The dashboard opens only after the second step.
6. Sign out, submit the password again, and choose **Use a recovery code**. One unused code opens the dashboard.
7. Sign out and try that same recovery code again. Flare rejects it. Enter a different unused code to regain access.
8. Return to **Sign-in security**. Choose **Replace recovery codes**. The recent recovery-code sign-in supplies identity proof, so no second code is needed. Save the replacement set and sign in again.
9. Sign in with a replacement recovery code. Choose **Turn off** and finish **Turn off two-factor authentication** using the recent recovery-code sign-in as identity proof. After signing in again, the password alone opens the dashboard.

These are real enrollment, login, recovery, and removal operations against a disposable database. The authenticator code is generated by the test's TOTP client; no personal authenticator account is involved. QR/setup secrets, passwords, and recovery values are concealed throughout the capture. The recording stays at desktop width; the guide also shows real mobile captures, and the browser verification separately exercises recovery at 390px wide. [Follow the account security guide](./guide/security) for your own account, and [reproduce the checks](./contributing#security-browser-checks-and-demos) locally.

### Create, use, and remove a passkey

<video class="demo-video" controls playsinline preload="none" aria-label="Create, use, and remove a passkey: silent Flare recording with a virtual authenticator" :src="withBase('/demos/passkey-demo.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Sign in to the isolated **Jamie Rivera** account and open **Sign-in security**.
2. Choose **Add a passkey**, name it **Personal laptop**, confirm the password, and choose **Create passkey**.
3. Registration succeeds and ends the previous sessions. Choose **Sign in again**, then **Sign in with a passkey**. The verified credential opens the dashboard without entering the account password.
4. Return to **Sign-in security** and inspect **Personal laptop** in the passkey list.
5. Choose its **Rename** action and save **My laptop passkey**. The recent passkey sign-in supplies identity proof, and renaming keeps the session open.
6. Choose **Remove**, confirm **Remove passkey**, then choose **Sign in again**.
7. Try **Sign in with a passkey** using the credential still held by the test device. Flare rejects the removed credential and stays signed out.

The app and server operations are real; **Chromium's virtual authenticator simulates the device**. It performs actual WebAuthn cryptographic ceremonies but does not display a physical device's fingerprint, face, PIN, or security-key prompt. Your browser/provider supplies those prompts on your own device. This recording demonstrates server registration, passwordless sign-in, renaming, and revocation; it is not a hardware compatibility test. [Add a passkey](./guide/security#add-a-passkey).

<span id="require-a-passkey-and-recover-access"></span>

### When a passkey is required

<video class="demo-video" controls playsinline preload="none" aria-label="When a passkey is required: silent Flare recording of a refused password sign-in" :poster="withBase('/screenshots/security/passkey-required-password.webp')" :src="withBase('/demos/passkey-required-demo.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. The local sign-in form appears in a signed-out demonstration browser.
2. Submitting the demonstration account’s correct, concealed password produces a refusal because a passkey is required.
3. Focus moves to **Passkey required**, with **Sign in with a passkey**, **Use a passkey recovery code**, and **Change account** visible. The clip ends before selecting a choice; pause it to inspect the screen.

The result keeps the account signed out and presents the permitted next steps instead of retrying the blocked password method. This short recording uses one real password refusal; the account's passkey requirement was enabled before recording, and the password stays concealed by the application's native password field. It does not show enrollment, a device prompt, recovery-code use, changing accounts, or turning off the requirement. [Read the activation and recovery instructions](./guide/security#require-a-passkey-for-sign-in) before enabling it on your account.

### Create and assign a role

<video class="demo-video" controls playsinline preload="none" aria-label="Create and assign a role: 19-second silent Flare recording" :src="withBase('/demos/roles-demo.mp4')">Your browser does not support this video. Follow the transcript below.</video>

1. Open **Admin → Roles** and choose **Create role**.
2. Name the role **Content reviewer**, choose an amber color, and describe its purpose: “Review uploads and help keep the workspace tidy.” Set **Position** to `30`.
3. Search for **View users** and turn it on.
4. Search for **moderation**. Turn on **View all content** and **Edit all content**; leave **Delete all content** off.
5. Choose **Save role**. The role exists without any members yet.
6. Open **Admin → Users**, edit the demonstration account **Taylor Reed**, select **Content reviewer**, and choose **Save changes**.
7. Return to **Roles**, select **Content reviewer**, and confirm it shows **1 member** and the selected moderation permissions.

This recording makes real role and account changes in an isolated instance. Everyone remains the shared baseline; the new role adds review/edit capabilities without granting deletion of other users' content or settings administration. [Read the role guide](./admin/roles) for hierarchy and permission details. The separate [roles lab](#roles-and-permissions-lab) below is a local simulation.

### Organize and upload

<video class="demo-video" controls playsinline preload="none" aria-label="Organize and upload: 18-second silent Flare recording" :src="withBase('/demos/organizing-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. In **Files**, choose **New folder** and create a folder named Project launch. The new folder opens.
2. Go back to **Folders**, open **Unfiled**, select two files, and move them into Project launch.
3. Open Project launch and create a Week 39 subfolder, which opens in turn.
4. Use **Upload here** to upload a project checklist into the subfolder. **Save to** already shows Project launch / Week 39.
5. Choose **Open folder** in **Upload complete** to see the checklist in its folder.

Moving a file preserves its individual share link. [Read the folders guide](./guide/folders).

### Share a collection, then revoke access

<video class="demo-video" controls playsinline preload="none" aria-label="Share and revoke: 14-second silent Flare recording" :src="withBase('/demos/sharing-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. Open a folder, choose **Share**, and choose **Create share link**.
2. Open the shared folder link. It shows what any recipient sees: the public files, and a password-protected file as a generic locked tile.
3. Return to the folder, choose **Share**, and choose **Disable link**.
4. Revisit the link to confirm the shared page is unavailable.

Disabling a folder link does not revoke a file’s separate public URL. [Understand sharing boundaries](./guide/sharing).

### Open a protected file

<video class="demo-video" controls playsinline preload="none" aria-label="Protected-file handoff: 11-second silent Flare recording" :src="withBase('/demos/protected-file-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. Open a locked tile from a shared folder. The password page links back to the folder.
2. Enter an incorrect password; the file stays locked and its name stays hidden.
3. Enter the correct password to reveal the file and its normal viewer.

This flow is for a **public file protected by a password**. Private files are not included in a public folder share.

## Roles and permissions lab

Try Everyone, an additional contributor role, and Administrator. Removing a permission from one role does not deny a grant from another. The simulation also shows why a named token needs both its scope and its owner's current permission. [Follow the real role workflow](./admin/roles#create-and-assign-a-role).

<RoleLab />

## Upload options lab

Try the precedence rules behind account defaults, saved profiles, and per-upload choices. This is an educational model of the [upload profile rules](./guide/upload-profiles), with explicit inputs; it does not read your account.

<UploadLab />

## Build an API request

Generate curl, JavaScript, or Python examples with your instance address. The builder never asks for a token and never sends a request.

<ApiPlayground />

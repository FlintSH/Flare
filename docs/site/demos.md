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

1. Open **Audit log** on the isolated demonstration instance with an administrator session.
2. Review recorded activity produced by a real demonstration upload, visibility changes, download, denied access, actual OCR of a generated receipt image, a rejected OCR request on a text file, deletion, role assignment, and settings change.
3. Enter **quarterly-report.txt** in **Search activity**, choose **Apply filters**, and expand a **File delete** event. The deleted filename and acting account remain recorded.
4. Review **Recorded details** and request context. Choose **Clear filters**, set **Outcome** to **Denied**, and apply to inspect refused requests.
5. Add **missing-demo-filename** to search and apply. Flare shows **No activity matches these filters**. Clear the filters and return to recent instance activity.

These screens display real events produced by demonstration operations. The setup uses API requests before opening the recorded audit page; the recording shows investigation of those events. The receipt image is generated test input, and the server performs real OCR; it is not a fabricated application screenshot. The audit log begins when the feature is installed, retains selected metadata, and does not capture every request outside Flare. It is not a tamper-evident ledger. [Read the audit guide](./admin/audit) for access, filtering, privacy, and retention; the guide also includes desktop and mobile screenshots. The recording stays at desktop width; mobile layout is covered by those separate captures and browser checks.

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

### Require a passkey and recover access

<video class="demo-video" controls playsinline preload="none" aria-label="Require a passkey and recover access: silent Flare recording with a virtual authenticator" :src="withBase('/demos/passkey-required-demo.webm')">Your browser does not support this video. Follow the transcript below.</video>

1. Sign in to the isolated **Jamie Rivera** account, add **Required sign-in key**, and sign in again with that passkey.
2. Open **Sign-in security → Require passkey to sign in**. Review the password/authenticator/SSO restriction, then choose **Require passkey**. The recent passkey sign-in confirms the change.
3. In **Save your passkey recovery codes**, download the ten dedicated codes, select **I have saved my recovery codes somewhere safe.**, and choose **Done**. Values are concealed in the recording; the test deletes the downloaded fixture file. Existing browser sessions are invalidated.
4. Choose **Sign in again** and try the correct password. Flare refuses it and explains that a passkey is required. **Sign in with a passkey** opens the account; the requirement remains **Required**.
5. Sign out and choose **Use a passkey recovery code**. Enter the account email with different capitalization and one dedicated code, then choose **Sign in with recovery code**. The case-insensitive lookup succeeds: the dashboard opens without entering a password, and the requirement stays on.
6. Sign out and try that same code again. Flare rejects it. A different unused code restores access.
7. Open **Replace passkey recovery codes**, use the recent dedicated recovery sign-in as proof, and choose **Replace codes**. Save the replacement set before signing in again. An unused code from the old set is now rejected; a new code works.
8. Choose **Allow other sign-in methods → Allow other methods**. The fresh dedicated recovery sign-in confirms this explicit change. After signing in again, the password works and the dedicated recovery count is zero.

This is a real local account workflow; Chromium's virtual authenticator replaces the physical device. Password rejection and dedicated recovery use the actual server, with no mocked authentication responses. The same browser checks also verify rejection of stale sessions and last-key removal while required. The recording stays at desktop width; the guide includes separate mobile captures. It does not demonstrate a live external SSO provider or native biometric prompt. [Prepare required-passkey recovery](./guide/security#require-a-passkey-for-sign-in) before enabling it on your account.

### Create and assign a role

<video class="demo-video" controls playsinline preload="none" aria-label="Create and assign a role: 17-second silent Flare recording" :src="withBase('/demos/roles-demo.mp4')">Your browser does not support this video. Follow the transcript below.</video>

1. Open **Roles** and choose **Create role**.
2. Name the role **Content reviewer**, choose an amber color, and describe its purpose: “Review uploads and help keep the workspace tidy.” Set **Position** to `30`.
3. Search for **View users** and turn it on.
4. Search for **moderation**. Turn on **View all content** and **Edit all content**; leave **Delete all content** off.
5. Choose **Save role**. The role exists without any members yet.
6. Open **Users**, edit the demonstration account **Taylor Reed**, select **Content reviewer**, and choose **Save Changes**.
7. Return to **Roles**, select **Content reviewer**, and confirm it shows **1 member** and the selected moderation permissions.

This recording makes real role and account changes in an isolated instance. Everyone remains the shared baseline; the new role adds review/edit capabilities without granting deletion of other users' content or settings administration. [Read the role guide](./admin/roles) for hierarchy and permission details. The separate [roles lab](#roles-and-permissions-lab) below is a local simulation.

### Organize and upload

<video class="demo-video" controls playsinline preload="none" aria-label="Organize and upload: 23-second silent Flare recording" :src="withBase('/demos/organizing-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. In **Files**, create a folder named Project launch.
2. Select two existing files and move them into that folder.
3. Open the folder and create a Week 39 subfolder.
4. Use **Upload here** to upload a project checklist into the subfolder.
5. Open the destination from the completed upload.

Moving a file preserves its individual share link. [Read the folders guide](./guide/folders).

### Share a collection, then revoke access

<video class="demo-video" controls playsinline preload="none" aria-label="Share and revoke: 15-second silent Flare recording" :src="withBase('/demos/sharing-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. Open a folder’s sharing controls and create a share link.
2. Visit the collection as a recipient. Public files appear; a password-protected file appears as a generic locked tile.
3. Return to the owner’s sharing controls and disable the link.
4. Revisit the collection URL to confirm the shared page is unavailable.

Disabling a folder link does not revoke a file’s separate public URL. [Understand sharing boundaries](./guide/sharing).

### Open a protected file

<video class="demo-video" controls playsinline preload="none" aria-label="Protected-file handoff: 11-second silent Flare recording" :src="withBase('/demos/protected-file-demo.mp4')">Your browser does not support this video. Follow the steps below.</video>

1. Open a locked tile from a shared folder.
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

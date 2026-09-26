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

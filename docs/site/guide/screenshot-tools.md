---
title: Screenshot tools and scripts
description: Set up ShareX, iTake, Flameshot, Spectacle, or a Bash uploader with ready-to-use Flare configurations.
---

# Screenshot tools and scripts

Capture, upload, and copy a link without opening your browser. **Profile → Uploads → Screenshot tools and scripts** provides ready-to-use downloads for common capture tools and a general Bash uploader.

You do not need to create or manually paste an API key for these downloads. Flare includes your account upload token automatically.

<Screenshot src="/screenshots/preferences/profile-upload-tools.png" alt="Screenshot-tool setup options in Profile Uploads" caption="Download a configuration or script with your instance address and upload credential already included." />

## Choose your tool

| Your workflow                           | Flare download                |
| --------------------------------------- | ----------------------------- |
| Capture and upload on Windows           | ShareX `.sxcu` configuration. |
| Screenshots and recordings on macOS     | iTake `.itup` configuration.  |
| Annotated screenshots on Linux          | Flameshot Bash script.        |
| Screenshots and recordings on KDE       | Spectacle Bash script.        |
| Upload an existing file from a terminal | General Bash script.          |

For a particular sharing workflow, download the client from a saved [upload profile](./upload-profiles) instead of the general tools section. General downloads follow account defaults; profile downloads explicitly select that profile.

::: warning Downloads contain a credential
Keep these configurations and scripts private. Do not commit them to a public repository or attach them to a support issue without removing the token. Anyone with a working credential may be able to use the access it grants.
:::

## ShareX on Windows

1. Install and open ShareX.
2. In Flare, open **Profile → Uploads → Screenshot tools and scripts** and download the ShareX configuration.
3. Open the downloaded `.sxcu` file to import it into ShareX.
4. Select the imported custom uploader for the relevant file or image destination in ShareX.
5. Capture or upload a small test file, then open the returned link.

ShareX controls which captures upload and which after-upload actions run. Enable its copy-URL action if you want the link placed on your clipboard. Flare's configuration supplies the upload endpoint and response parsing; see the [ShareX custom uploader documentation](https://getsharex.com/docs/custom-uploader) for the tool's destination and import controls.

If you want different behavior for different tasks, create profiles such as **Public screenshots** and **Temporary clips**, then download the configuration for the appropriate profile.

## iTake on macOS

[iTake](https://github.com/SerStars/iTake) is an open-source menu-bar capture application for screenshots and screen recordings. Its published requirements are macOS 15 or later on Apple Silicon or Intel.

1. Install iTake using its [installation instructions](https://github.com/SerStars/iTake#installing), open it, and allow screen-recording access when prompted.
2. In Flare, choose **Set Up iTake → Download Config**. To select a particular upload profile, use that profile's **iTake** action instead.
3. Open the `.itup` download and confirm import in iTake.
4. In **Preferences → Uploader**, select **Flare — Account defaults** or the named Flare profile.
5. Enable **Upload Automatically** and keep **Auto Copy Link** enabled for automatic sharing.
6. Capture a screenshot or finish a recording. If iTake requests access to its uploader credential in Keychain, approve it so uploading can proceed.

Both images and recordings still follow your Flare upload limits, visibility, and expiration choices. If you change your instance address or replace the account upload token, remove the old uploader and import a fresh Flare configuration.

## Flameshot on Linux

Choose the Flameshot **Download Script** action, review the options, and download the generated Bash script. It can adjust capture behavior and includes switches for Wayland clipboard support and Hyprland compatibility.

The generated script expects `flameshot`, `curl`, `jq`, and `xsel`. When Wayland support is selected, it also checks for `wl-copy`. Follow the installation notes at the top of the file, then run it with Bash:

```sh
bash ./your-flameshot-script.sh
```

You can also make the file executable and bind its path to a desktop keyboard shortcut. Keep the script in a private location because it contains the upload token.

Flare's generated Flameshot script supports Linux only. Use the iTake integration for the documented macOS capture workflow.

## Spectacle on KDE

Open Spectacle's **Download Script** action and select **Screenshot** or **Screen Recording**.

Screenshot choices include full desktop, current monitor, active window, or selected region. Recording choices include full desktop, current monitor, or selected region. The form also offers Wayland clipboard support and an option to include the mouse pointer.

The generated script checks for `spectacle`, `curl`, `jq`, and `xsel`, plus `wl-copy` when Wayland support is selected. Read the script's setup notes, then run it with Bash. The available capture and recording behavior also depends on your installed Spectacle version and desktop session.

<Screenshot src="/screenshots/preferences/profile-spectacle-options.png" alt="Spectacle script configuration with screenshot and recording modes" caption="Choose the capture mode and desktop environment before downloading the Spectacle script." />

## Bash: upload any file

Download the general Bash script to send an existing file from the terminal. It requires `curl`, `jq`, and `file`.

Run the actual filename you downloaded, passing a path to one file:

```sh
bash ./your-flare-script.sh ./screenshot.png
bash ./your-flare-script.sh "./recordings/product demo.mp4"
```

The script prints the share-page URL. It also tries available clipboard utilities: `wl-copy`, `xsel`, `xclip`, or `pbcopy`. If none is available, copy the printed URL manually.

This script uses a regular multipart upload. It is useful for simple terminal uploads; it does not provide the browser's chunked-upload workflow or a resumable transfer interface. For a more specialized integration, see the [API guide](../api/index).

## Account upload token and named tokens

The account upload token is created for you and included in generated downloads. The tools section lets you reveal, copy, or **Replace token** when you need to configure a tool manually or disconnect old configurations.

Replacing it disconnects every tool using that account token. Download and import fresh configurations afterward. Existing named API tokens are unaffected.

Use [named API tokens](../api/authentication) when a custom connection needs its own permissions, expiration, profile binding, or revocation. Downloading a standard screenshot-tool configuration does not create a separate named token for that tool.

## Troubleshooting

| Symptom                                         | Check                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Capture succeeds but upload fails               | Test a browser upload; check the instance URL, token, quota, and file-size/type limits.                               |
| Tools stopped after replacing the token         | Download and import new configurations or update the token in each script.                                            |
| Link was created but clipboard is empty         | Check ShareX/iTake's copy action, or install the clipboard utility required by the script and desktop session.        |
| Correct credential, profile error               | Confirm the selected profile still exists. A deleted profile or profile-bound token requires reconfiguration.         |
| The generated URL uses an old host              | Ask the administrator to correct the instance's public URL, then download the configuration again.                    |
| Upload succeeds but recipients cannot open it   | Review visibility, password, and expiration. The copied link does not grant access to a private file.                 |
| Linux script exits with a missing-command error | Install the listed dependency. Wayland scripts currently also check for `xsel`; follow the generated script's checks. |

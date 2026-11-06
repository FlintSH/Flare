import {
  SHARE_LINK_PATH,
  SPECTACLE_CAPTURE_MODES,
  SPECTACLE_RECORDING_MODES,
  type UploaderOptions,
  uploaderClients,
} from '.'

/** What a script needs to upload as the account. */
interface ScriptTarget {
  uploadUrl: URL
  token: string
}

/** Lines of a script, leaving out the optional ones that are `false`. */
const lines = (...parts: (string | false)[]) =>
  parts.filter((part) => part !== false).join('\n')

const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')

function dependencyCheck(commands: string[]) {
  return `# Dependencies check
dependencies=(${commands.map((command) => `"${command}"`).join(' ')})

for cmd in "\${dependencies[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done`
}

function credentials({ token, uploadUrl }: ScriptTarget) {
  return `UPLOAD_TOKEN="${token}"
API_URL="${uploadUrl}"`
}

function createTempFile(template: string, comment = 'Create temp file') {
  return `# ${comment}
TEMP_FILE=$(mktemp ${template})
if [ ! -f "$TEMP_FILE" ]; then
  echo "Failed to create temporary file"
  exit 1
fi`
}

const requireCapture = `# Check if screenshot was captured
if [ ! -s "$TEMP_FILE" ]; then
  echo "No screenshot taken or file is empty"
  rm -f "$TEMP_FILE"
  exit 1
fi`

/**
 * Uploads `file` and leaves the share link in `$URL`, or exits with the
 * reason. curl's status is read before anything else runs.
 */
function upload({
  file,
  type,
  removeFile = false,
  notice,
}: {
  file: string
  type?: string
  /** Remove the uploaded file afterwards, whether or not the upload worked. */
  removeFile?: boolean
  /** Desktop notifications for failures, titled "<notice> Upload Failed". */
  notice?: 'Screenshot' | 'Recording'
}) {
  const notify = (message: string) =>
    notice !== undefined &&
    `  notify-send "${notice} Upload Failed" "${message}"`
  return lines(
    `RESPONSE=$(curl -s -X POST \\
  -H "Authorization: Bearer $UPLOAD_TOKEN" \\
  -F "file=@${file}${type ? `;type=${type}` : ''}" \\
  "$API_URL")
UPLOAD_STATUS=$?`,
    removeFile &&
      `
# Clean up temporary file
rm -f "${file}"`,
    `
# Check if curl command succeeded
if [ $UPLOAD_STATUS -ne 0 ]; then
  echo "Upload failed: Network error or invalid URL"`,
    notify('Network error or invalid URL'),
    `  exit 1
fi

# Parse the JSON response
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')

if [ ! -z "$ERROR" ]; then
  echo "Upload failed: $ERROR"`,
    notify('Error: $ERROR'),
    `  exit 1
fi

# Read the share link from the response
URL=$(echo "$RESPONSE" | jq -r '.${SHARE_LINK_PATH} // empty')

if [ -z "$URL" ]; then
  echo "Upload failed: Could not extract URL from response"
  echo "Debug info:"
  echo "$RESPONSE"`,
    notify('Error: Could not extract URL from response'),
    `  exit 1
fi`
  )
}

/** Copies `$URL` with the session's clipboard tool and announces it. */
function shareLink(useWayland: boolean, notice: 'Screenshot' | 'Recording') {
  return `echo -n "$URL" | ${useWayland ? 'wl-copy' : 'xsel -ib'}
echo "${notice} uploaded successfully: $URL"
notify-send "${notice} Uploaded" "URL copied to clipboard: $URL"`
}

export function bashScript(target: ScriptTarget) {
  return `#!/bin/bash

# Flare Upload Script
# This script uploads files to your Flare instance.

# ===========================================
# Installation & Usage Instructions
# ===========================================
#
# 1. Make the script executable:
#    chmod +x /path/to/this/script.sh
#
# 2. Usage:
#    ./script.sh <file>
#
#    Examples:
#    ./script.sh image.png
#    ./script.sh document.pdf
#    ./script.sh ~/Downloads/screenshot.jpg
#
# The script will upload the file and copy the URL to your clipboard.
# ===========================================

# Check if a file was provided
if [ $# -eq 0 ]; then
  echo "Error: No file specified"
  echo "Usage: $0 <file>"
  exit 1
fi

# Check if the file exists
if [ ! -f "$1" ]; then
  echo "Error: File '$1' not found"
  exit 1
fi

${dependencyCheck(uploaderClients.bash.dependencies({}))}

# Environment setup
${credentials(target)}

# Detect mimetype
MIMETYPE=$(file --mime-type -b "$1")
if [ $? -ne 0 ]; then
  echo "Error: Failed to detect file mimetype"
  exit 1
fi

# Upload the file
echo "Uploading file..."
echo "Detected mimetype: $MIMETYPE"
${upload({ file: '$1', type: '$MIMETYPE' })}

# Try to copy to clipboard using various clipboard tools
if command -v wl-copy >/dev/null 2>&1; then
  # Wayland
  echo -n "$URL" | wl-copy
elif command -v xsel >/dev/null 2>&1; then
  # X11 with xsel
  echo -n "$URL" | xsel -ib
elif command -v xclip >/dev/null 2>&1; then
  # X11 with xclip
  echo -n "$URL" | xclip -selection clipboard
elif command -v pbcopy >/dev/null 2>&1; then
  # macOS
  echo -n "$URL" | pbcopy
else
  echo "Note: No clipboard tool found. Install wl-copy, xsel, xclip, or pbcopy for automatic clipboard copy."
fi

echo "File uploaded successfully!"
echo "URL: $URL"
echo "URL has been copied to clipboard (if a clipboard tool was available)"
exit 0`
}

/** Both screenshot scripts capture to a temporary PNG and upload it. */
const uploadScreenshot = upload({
  file: '$TEMP_FILE',
  type: 'image/png',
  removeFile: true,
  notice: 'Screenshot',
})

export function flameshotScript(
  target: ScriptTarget,
  options: UploaderOptions<'flameshot'>
) {
  return `#!/bin/bash

# Flare Upload Script for Flameshot
# This script captures a screenshot using Flameshot and uploads it to Flare.

# ===========================================
# Installation & Usage Instructions
# ===========================================
#
# 1. Make the script executable:
#    chmod +x /path/to/this/script.sh
#
# 2. Recommended: Add a keyboard shortcut
#    For most desktop environments:
#    - Go to Keyboard Settings/Shortcuts
#    - Add a new custom shortcut
#    - Set the command to: /path/to/this/script.sh
#    - Assign a key combination (e.g., Ctrl+Shift+S)
#
# For specific desktop environments:
#
# GNOME:
#   Settings -> Keyboard -> View and Customize Shortcuts
#   -> Custom Shortcuts -> + -> Add the script
#
# KDE:
#   System Settings -> Shortcuts -> Custom Shortcuts
#   -> Edit -> New -> Global Shortcut -> Command/URL
#   -> Add the script path
#
# i3/Sway:
#   Add to your config (~/.config/i3/config or ~/.config/sway/config):
#   bindsym $mod+Shift+s exec /path/to/this/script.sh
#
# ===========================================

# Enable debug output
# set -x

${dependencyCheck(uploaderClients.flameshot.dependencies(options))}

${lines(
  '# Environment setup',
  options.useCompositor && 'export XDG_CURRENT_DESKTOP=sway',
  credentials(target)
)}

${createTempFile('/tmp/flameshot-XXXXXX.png')}

# Capture screenshot with Flameshot
if ! flameshot gui --raw > "$TEMP_FILE" 2>/dev/null; then
  echo "Flameshot failed to capture screenshot"
  rm -f "$TEMP_FILE"
  exit 1
fi

${requireCapture}

# Upload the screenshot
echo "Uploading screenshot to $API_URL..."
${uploadScreenshot}

${shareLink(options.useWayland, 'Screenshot')}
exit 0`
}

export function spectacleScript(
  target: ScriptTarget,
  options: UploaderOptions<'spectacle'>
) {
  return options.scriptType === 'screenshot'
    ? spectacleScreenshotScript(target, options)
    : spectacleRecordingScript(target, options)
}

function spectacleScreenshotScript(
  target: ScriptTarget,
  options: UploaderOptions<'spectacle'>
) {
  const { captureMode, delay = 0, includePointer, useWayland } = options
  return `#!/bin/bash

# Flare Upload Script for Spectacle Screenshots
# This script captures a screenshot using KDE's Spectacle and uploads it to Flare.

# ===========================================
# Installation & Usage Instructions
# ===========================================
#
# 1. Make the script executable:
#    chmod +x /path/to/this/script.sh
#
# 2. Recommended: Add a keyboard shortcut
#    For KDE:
#    - System Settings -> Shortcuts -> Custom Shortcuts
#    - Edit -> New -> Global Shortcut -> Command/URL
#    - Set the command to: /path/to/this/script.sh
#    - Assign a key combination (e.g., Ctrl+Shift+S)
#
# For other desktop environments:
#
# GNOME:
#   Settings -> Keyboard -> View and Customize Shortcuts
#   -> Custom Shortcuts -> + -> Add the script
#
# i3/Sway:
#   Add to your config (~/.config/i3/config or ~/.config/sway/config):
#   bindsym $mod+Shift+s exec /path/to/this/script.sh
#
# ===========================================

# Enable debug output
# set -x

${dependencyCheck(uploaderClients.spectacle.dependencies(options))}

${credentials(target)}

${createTempFile('/tmp/spectacle-XXXXXX.png')}

${lines(
  '# Capture screenshot with Spectacle',
  `SPECTACLE_ARGS="${SPECTACLE_CAPTURE_MODES[captureMode].flag} -b -n -o $TEMP_FILE"`,
  delay > 0 && `SPECTACLE_ARGS="$SPECTACLE_ARGS -d ${delay}"`,
  includePointer && 'SPECTACLE_ARGS="$SPECTACLE_ARGS -p"'
)}

if ! spectacle $SPECTACLE_ARGS; then
  echo "Spectacle failed to capture screenshot"
  rm -f "$TEMP_FILE"
  exit 1
fi

${requireCapture}

# Upload the screenshot
echo "Uploading screenshot to $API_URL..."
${uploadScreenshot}

${shareLink(useWayland, 'Screenshot')}
exit 0`
}

function spectacleRecordingScript(
  target: ScriptTarget,
  options: UploaderOptions<'spectacle'>
) {
  const { includePointer, recordingMode, useWayland } = options
  return `#!/bin/bash

# Flare Upload Script for Spectacle Screen Recording
# This script records the screen using KDE's Spectacle CLI and uploads it to Flare.

# ===========================================
# Installation & Usage Instructions
# ===========================================
#
# 1. Make the script executable:
#    chmod +x /path/to/this/script.sh
#
# 2. Recommended: Add a keyboard shortcut
#    For KDE:
#    - System Settings -> Shortcuts -> Custom Shortcuts
#    - Edit -> New -> Global Shortcut -> Command/URL
#    - Set the command to: /path/to/this/script.sh
#    - Assign a key combination (e.g., Ctrl+Shift+R)
#
# USAGE:
#   ./script.sh              - Start recording and auto-upload when done
#   ./script.sh --upload-last - Upload the most recent recording
#   ./script.sh /path/to/recording.mp4 - Upload specific file
#
# NOTES:
# - Requires Spectacle with CLI recording support (-R option)
# - Press Ctrl+C to stop recording
# - Recording will be automatically uploaded after stopping
#
# ===========================================

${dependencyCheck(uploaderClients.spectacle.dependencies(options))}

${credentials(target)}

# Function to find the latest recording
find_latest_recording() {
  # Common paths where Spectacle saves recordings
  POSSIBLE_PATHS=(
    "$HOME/Videos"
    "$HOME/Pictures"
    "$HOME/Desktop"
    "$(xdg-user-dir VIDEOS 2>/dev/null || echo "$HOME/Videos")"
    "$(xdg-user-dir PICTURES 2>/dev/null || echo "$HOME/Pictures")"
  )

  LATEST_FILE=""
  LATEST_TIME=0

  for path in "\${POSSIBLE_PATHS[@]}"; do
    if [ -d "$path" ]; then
      # Look for recent video files (last 30 minutes)
      while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then
          file_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
          if [ "$file_time" -gt "$LATEST_TIME" ] && [ "$file_time" -gt $(( $(date +%s) - 1800 )) ]; then
            LATEST_TIME=$file_time
            LATEST_FILE="$file"
          fi
        fi
      done < <(find "$path" -maxdepth 1 -type f \\( -name "*.mp4" -o -name "*.mkv" -o -name "*.webm" \\) -print0 2>/dev/null)
    fi
  done

  echo "$LATEST_FILE"
}

# Function to upload a recording file
upload_recording() {
  local RECORDING_FILE="$1"

  if [ ! -f "$RECORDING_FILE" ]; then
    echo "Error: Recording file not found: $RECORDING_FILE"
    exit 1
  fi

  echo "Found recording: $RECORDING_FILE"
  echo "File size: $(du -h "$RECORDING_FILE" | cut -f1)"

  # Detect MIME type for video files
  get_video_mime_type() {
    local file="$1"
    local ext="\${file##*.}"
    case "\${ext,,}" in
      mp4) echo "video/mp4" ;;
      mkv) echo "video/x-matroska" ;;
      webm) echo "video/webm" ;;
      avi) echo "video/x-msvideo" ;;
      mov) echo "video/quicktime" ;;
      wmv) echo "video/x-ms-wmv" ;;
      flv) echo "video/x-flv" ;;
      m4v) echo "video/x-m4v" ;;
      *) echo "video/mp4" ;; # Default for recordings
    esac
  }

  # Upload the recording
  echo "Uploading recording to $API_URL..."
  MIME_TYPE=$(get_video_mime_type "$RECORDING_FILE")
${indent(upload({ file: '$RECORDING_FILE', type: '$MIME_TYPE', notice: 'Recording' }))}

${indent(shareLink(useWayland, 'Recording'))}
}

# Handle command line arguments
if [ "$1" = "--upload-last" ]; then
  # Upload the most recent recording without starting a new one
  RECORDING_FILE=$(find_latest_recording)
  if [ -z "$RECORDING_FILE" ]; then
    echo "No recent recording found in common directories."
    exit 1
  fi
  upload_recording "$RECORDING_FILE"
  exit 0
elif [ -n "$1" ] && [ -f "$1" ]; then
  # Upload specific file provided as argument
  upload_recording "$1"
  exit 0
fi

# Default behavior: Start recording and upload when done
echo "Starting ${recordingMode} recording with Spectacle..."
echo "Press Ctrl+C to stop recording and upload automatically."
echo ""

${createTempFile(
  '/tmp/spectacle-recording-XXXXXX.mp4',
  'Create temp file for recording'
)}

# Set up trap to handle Ctrl+C and upload the recording
trap 'echo ""; echo "Stopping recording..."; upload_recording "$TEMP_FILE"; exit 0' INT

${lines(
  '# Start recording with Spectacle CLI',
  `RECORD_ARGS="-R ${SPECTACLE_RECORDING_MODES[recordingMode].flag} -b -n -o $TEMP_FILE"`,
  includePointer && 'RECORD_ARGS="$RECORD_ARGS -p"'
)}

echo "Recording started. File will be saved as: $TEMP_FILE"
echo "Press Ctrl+C when you want to stop recording and upload."

# Run spectacle recording (this will block until stopped)
if ! spectacle $RECORD_ARGS; then
  echo "Spectacle recording failed"
  rm -f "$TEMP_FILE"
  exit 1
fi

# If we get here, recording finished normally (not via Ctrl+C)
echo "Recording completed."
upload_recording "$TEMP_FILE"
exit 0`
}

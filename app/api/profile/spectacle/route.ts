import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

const spectacleSchema = z.object({
  scriptType: z.enum(['screenshot', 'recording']),
  useWayland: z.boolean(),
  includePointer: z.boolean(),
  captureMode: z.enum(['fullscreen', 'current', 'activewindow', 'region']),
  recordingMode: z.enum(['fullscreen', 'current', 'region']),
  delay: z.number().min(0).max(10000),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const json = await req.json()
    const body = spectacleSchema.parse(json)

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { uploadToken: true, urlId: true, name: true },
    })

    if (!user?.uploadToken) {
      return NextResponse.json(
        { error: 'Upload token not found' },
        { status: 404 }
      )
    }

    const script = generateSpectacleScript({
      uploadToken: user.uploadToken,
      ...body,
    })

    const sanitizedName = (user.name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')

    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${sanitizedName}-spectacle-${body.scriptType}.sh"`,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    console.error('Error generating Spectacle script:', error)
    return NextResponse.json(
      { error: 'Failed to generate Spectacle script' },
      { status: 500 }
    )
  }
}

interface ScriptOptions {
  uploadToken: string
  scriptType: 'screenshot' | 'recording'
  useWayland: boolean
  includePointer: boolean
  captureMode: 'fullscreen' | 'current' | 'activewindow' | 'region'
  recordingMode: 'fullscreen' | 'current' | 'region'
  delay: number
}

function generateSpectacleScript({
  uploadToken,
  scriptType,
  useWayland,
  includePointer,
  captureMode,
  recordingMode,
  delay,
}: ScriptOptions): string {
  const baseUrl =
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:3000'
      : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''

  if (scriptType === 'screenshot') {
    return generateScreenshotScript({
      uploadToken,
      baseUrl,
      useWayland,
      includePointer,
      captureMode,
      delay,
    })
  } else {
    return generateRecordingScript({
      uploadToken,
      baseUrl,
      useWayland,
      includePointer,
      recordingMode,
    })
  }
}

function generateScreenshotScript({
  uploadToken,
  baseUrl,
  useWayland,
  includePointer,
  captureMode,
  delay,
}: {
  uploadToken: string
  baseUrl: string
  useWayland: boolean
  includePointer: boolean
  captureMode: string
  delay: number
}): string {
  const modeFlag = {
    fullscreen: '-f',
    current: '-m',
    activewindow: '-a',
    region: '-r',
  }[captureMode]

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

# Dependencies check
dependencies=("spectacle" "curl" "jq" "xsel")
${useWayland ? 'dependencies+=("wl-copy")' : ''}

for cmd in "\${dependencies[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done

UPLOAD_TOKEN="${uploadToken}"
API_URL="${baseUrl}/api/files"

# Create temp file
TEMP_FILE=\$(mktemp /tmp/spectacle-XXXXXX.png)
if [ ! -f "$TEMP_FILE" ]; then
  echo "Failed to create temporary file"
  exit 1
fi

# Capture screenshot with Spectacle
SPECTACLE_ARGS="${modeFlag} -b -n -o \$TEMP_FILE"
${delay > 0 ? `SPECTACLE_ARGS="$SPECTACLE_ARGS -d ${delay}"` : ''}
${includePointer ? 'SPECTACLE_ARGS="$SPECTACLE_ARGS -p"' : ''}

if ! spectacle $SPECTACLE_ARGS; then
  echo "Spectacle failed to capture screenshot"
  rm -f "$TEMP_FILE"
  exit 1
fi

# Check if screenshot was captured
if [ ! -s "$TEMP_FILE" ]; then
  echo "No screenshot taken or file is empty"
  rm -f "$TEMP_FILE"
  exit 1
fi

# Detect MIME type based on file extension
get_mime_type() {
  local file="$1"
  local ext="\${file##*.}"
  case "\${ext,,}" in
    png) echo "image/png" ;;
    jpg|jpeg) echo "image/jpeg" ;;
    gif) echo "image/gif" ;;
    bmp) echo "image/bmp" ;;
    webp) echo "image/webp" ;;
    svg) echo "image/svg+xml" ;;
    *) echo "image/png" ;; # Default for screenshots
  esac
}

# Upload the screenshot
echo "Uploading screenshot to $API_URL..."
MIME_TYPE=\$(get_mime_type "$TEMP_FILE")
RESPONSE=\$(curl -s -X POST \\
  -H "Authorization: Bearer $UPLOAD_TOKEN" \\
  -F "file=@$TEMP_FILE;type=$MIME_TYPE" \\
  "$API_URL")

# Clean up temporary file
rm -f "$TEMP_FILE"

# Check if curl command succeeded
if [ $? -ne 0 ]; then
  echo "Upload failed: Network error or invalid URL"
  notify-send "Screenshot Upload Failed" "Network error or invalid URL"
  exit 1
fi

# Parse the JSON response
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')

if [ ! -z "$ERROR" ]; then
  echo "Upload failed: $ERROR"
  notify-send "Screenshot Upload Failed" "Error: $ERROR"
  exit 1
fi

# Try to extract URL using different possible response formats
URL=$(echo "$RESPONSE" | jq -r '.url // .data.url // empty')

if [ -z "$URL" ]; then
  # If URL is still empty, the response might be directly the upload response object
  URL=$(echo "$RESPONSE" | jq -r '. | if type=="object" then .url else empty end')
fi

if [ "$URL" == "null" ] || [ -z "$URL" ]; then
  echo "Upload failed: Could not extract URL from response"
  echo "Debug info:"
  echo "$RESPONSE"
  notify-send "Screenshot Upload Failed" "Error: Could not extract URL from response"
  exit 1
fi

${useWayland ? 'echo -n "$URL" | wl-copy' : 'echo -n "$URL" | xsel -ib'}
echo "Screenshot uploaded successfully: $URL"
notify-send "Screenshot Uploaded" "URL copied to clipboard: $URL"
exit 0`
}

function generateRecordingScript({
  uploadToken,
  baseUrl,
  useWayland,
  includePointer,
  recordingMode,
}: {
  uploadToken: string
  baseUrl: string
  useWayland: boolean
  includePointer: boolean
  recordingMode: string
}): string {
  const modeFlag = {
    fullscreen: 's',
    current: 's',
    region: 'r',
  }[recordingMode]

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

# Dependencies check
dependencies=("spectacle" "curl" "jq" "xsel")
${useWayland ? 'dependencies+=("wl-copy")' : ''}

for cmd in "\${dependencies[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done

UPLOAD_TOKEN="${uploadToken}"
API_URL="${baseUrl}/api/files"

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
          file_time=\$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
          if [ "$file_time" -gt "$LATEST_TIME" ] && [ "$file_time" -gt \$(( \$(date +%s) - 1800 )) ]; then
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
  echo "File size: \$(du -h "$RECORDING_FILE" | cut -f1)"
  
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
  MIME_TYPE=\$(get_video_mime_type "$RECORDING_FILE")
  RESPONSE=\$(curl -s -X POST \\
    -H "Authorization: Bearer $UPLOAD_TOKEN" \\
    -F "file=@$RECORDING_FILE;type=$MIME_TYPE" \\
    "$API_URL")
  
  # Check if curl command succeeded
  if [ $? -ne 0 ]; then
    echo "Upload failed: Network error or invalid URL"
    notify-send "Recording Upload Failed" "Network error or invalid URL"
    exit 1
  fi
  
  # Parse the JSON response
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  
  if [ ! -z "$ERROR" ]; then
    echo "Upload failed: $ERROR"
    notify-send "Recording Upload Failed" "Error: $ERROR"
    exit 1
  fi
  
  # Try to extract URL using different possible response formats
  URL=$(echo "$RESPONSE" | jq -r '.url // .data.url // empty')
  
  if [ -z "$URL" ]; then
    # If URL is still empty, the response might be directly the upload response object
    URL=$(echo "$RESPONSE" | jq -r '. | if type=="object" then .url else empty end')
  fi
  
  if [ "$URL" == "null" ] || [ -z "$URL" ]; then
    echo "Upload failed: Could not extract URL from response"
    echo "Debug info:"
    echo "$RESPONSE"
    notify-send "Recording Upload Failed" "Error: Could not extract URL from response"
    exit 1
  fi
  
  ${useWayland ? 'echo -n "$URL" | wl-copy' : 'echo -n "$URL" | xsel -ib'}
  echo "Recording uploaded successfully: $URL"
  notify-send "Recording Uploaded" "URL copied to clipboard: $URL"
}

# Handle command line arguments
if [ "$1" = "--upload-last" ]; then
  # Upload the most recent recording without starting a new one
  RECORDING_FILE=\$(find_latest_recording)
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

# Create temp file for recording
TEMP_FILE=\$(mktemp /tmp/spectacle-recording-XXXXXX.mp4)
if [ ! -f "$TEMP_FILE" ]; then
  echo "Failed to create temporary file"
  exit 1
fi

# Set up trap to handle Ctrl+C and upload the recording
trap 'echo ""; echo "Stopping recording..."; upload_recording "$TEMP_FILE"; exit 0' INT

# Start recording with Spectacle CLI
RECORD_ARGS="-R ${modeFlag} -b -n -o \$TEMP_FILE"
${includePointer ? 'RECORD_ARGS="$RECORD_ARGS -p"' : ''}

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

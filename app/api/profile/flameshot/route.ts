import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

const flameshotSchema = z.object({
  useWayland: z.boolean(),
  useCompositor: z.boolean(),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const json = await req.json()
    const body = flameshotSchema.parse(json)

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

    // Generate the Flameshot upload script
    const script = generateFlameshotScript({
      uploadToken: user.uploadToken,
      useWayland: body.useWayland,
      useCompositor: body.useCompositor,
    })

    // Use sanitized username for the filename
    const sanitizedName = (user.name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')

    // Return the script as a downloadable file
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${sanitizedName}-flameshot.sh"`,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    console.error('Error generating Flameshot script:', error)
    return NextResponse.json(
      { error: 'Failed to generate Flameshot script' },
      { status: 500 }
    )
  }
}

interface ScriptOptions {
  uploadToken: string
  useWayland: boolean
  useCompositor: boolean
}

function generateFlameshotScript({
  uploadToken,
  useWayland,
  useCompositor,
}: ScriptOptions): string {
  // Get base URL from NEXTAUTH_URL and ensure no trailing slash
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''

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

# Dependencies check
dependencies=("flameshot" "curl" "jq" "xsel")
${useWayland ? 'dependencies+=("wl-copy")' : ''}

for cmd in "\${dependencies[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done

# Environment setup
${useCompositor ? 'export XDG_CURRENT_DESKTOP=sway' : ''}
UPLOAD_TOKEN="${uploadToken}"
API_URL="${baseUrl}/api/files"

# Create temp file
TEMP_FILE=\$(mktemp /tmp/flameshot-XXXXXX.png)
if [ ! -f "$TEMP_FILE" ]; then
  echo "Failed to create temporary file"
  exit 1
fi

# Capture screenshot with Flameshot
if ! flameshot gui --raw > "$TEMP_FILE" 2>/dev/null; then
  echo "Flameshot failed to capture screenshot"
  rm -f "$TEMP_FILE"
  exit 1
fi

# Check if screenshot was captured
if [ ! -s "$TEMP_FILE" ]; then
  echo "No screenshot taken or file is empty"
  rm -f "$TEMP_FILE"
  exit 1
fi

# Upload the screenshot
echo "Uploading screenshot to $API_URL..."
RESPONSE=\$(curl -s -X POST \\
  -H "Authorization: Bearer $UPLOAD_TOKEN" \\
  -F "file=@$TEMP_FILE" \\
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
URL=\$(echo "$RESPONSE" | jq -r '.url')
ERROR=\$(echo "$RESPONSE" | jq -r '.error // empty')

if [ ! -z "$ERROR" ]; then
  echo "Upload failed: $ERROR"
  notify-send "Screenshot Upload Failed" "Error: $ERROR"
  exit 1
fi

if [ "$URL" != "null" ] && [ ! -z "$URL" ]; then
  ${useWayland ? 'echo -n "$URL" | wl-copy' : 'echo -n "$URL" | xsel -ib'}
  echo "Screenshot uploaded successfully: $URL"
  ${useWayland ? 'notify-send "Screenshot Uploaded" "URL copied to clipboard: $URL"' : 'notify-send "Screenshot Uploaded" "URL copied to clipboard: $URL"'}
  exit 0
else
  echo "Upload failed: Invalid response format"
  echo "Debug info:"
  echo "$RESPONSE"
  notify-send "Screenshot Upload Failed" "Error: Invalid response format"
  exit 1
fi`
}

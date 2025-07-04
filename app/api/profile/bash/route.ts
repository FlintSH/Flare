import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { uploadToken: true, name: true },
    })

    if (!user?.uploadToken) {
      return NextResponse.json(
        { error: 'Upload token not found' },
        { status: 404 }
      )
    }

    const baseUrl =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''

    const script = generateBashScript({
      uploadToken: user.uploadToken,
      baseUrl,
    })

    const sanitizedName = (user.name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')

    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${sanitizedName}-upload.sh"`,
      },
    })
  } catch (error) {
    console.error('Error generating bash script:', error)
    return NextResponse.json(
      { error: 'Failed to generate bash script' },
      { status: 500 }
    )
  }
}

interface ScriptOptions {
  uploadToken: string
  baseUrl: string
}

function generateBashScript({ uploadToken, baseUrl }: ScriptOptions): string {
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

# Dependencies check
dependencies=("curl" "jq" "file")

for cmd in "\${dependencies[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done

# Environment setup
UPLOAD_TOKEN="${uploadToken}"
API_URL="${baseUrl}/api/files"

# Detect mimetype
MIMETYPE=$(file --mime-type -b "$1")
if [ $? -ne 0 ]; then
  echo "Error: Failed to detect file mimetype"
  exit 1
fi

# Upload the file
echo "Uploading file..."
echo "Detected mimetype: $MIMETYPE"
RESPONSE=\$(curl -s -X POST \\
  -H "Authorization: Bearer $UPLOAD_TOKEN" \\
  -H "X-File-Type: $MIMETYPE" \\
  -F "file=@$1;type=$MIMETYPE" \\
  "$API_URL")

# Check if curl command succeeded
if [ $? -ne 0 ]; then
  echo "Upload failed: Network error or invalid URL"
  exit 1
fi

# Parse the JSON response
ERROR=\$(echo "$RESPONSE" | jq -r '.error // empty')

if [ ! -z "$ERROR" ]; then
  echo "Upload failed: $ERROR"
  exit 1
fi

# Try to extract URL using different possible response formats
URL=\$(echo "$RESPONSE" | jq -r '.url // .data.url // empty')

if [ -z "$URL" ]; then
  # If URL is still empty, the response might be directly the upload response object
  URL=\$(echo "$RESPONSE" | jq -r '. | if type=="object" then .url else empty end')
fi

if [ "$URL" == "null" ] || [ -z "$URL" ]; then
  echo "Upload failed: Could not extract URL from response"
  echo "Debug info:"
  echo "$RESPONSE"
  exit 1
fi

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

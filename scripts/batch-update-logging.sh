#!/bin/bash

# Script to batch update API routes with logging

echo "Starting batch logging update..."

# Function to update a file
update_file() {
    local file=$1
    local logger_name=$2
    
    echo "Updating $file with logger: $logger_name"
    
    # Check if file already has logger import
    if grep -q "@/lib/logger" "$file"; then
        echo "  - Already has logger import"
    else
        # Add import after the last import statement
        sed -i "/^import.*from/{ 
            /^import.*from.*$/{ 
                h
                s/.*/&/
                x
                n
                /^$/!b
                i\\
import { loggers } from '@/lib/logger'\\
\\
const logger = loggers.$logger_name
            }
        }" "$file"
        
        # If that didn't work, add after the last import
        if ! grep -q "@/lib/logger" "$file"; then
            awk '/^import/ {p=NR} END {print p}' "$file" | while read line_num; do
                sed -i "${line_num}a\\
\\
import { loggers } from '@/lib/logger'\\
\\
const logger = loggers.$logger_name" "$file"
            done
        fi
    fi
    
    # Replace console.error statements
    sed -i "s/console\.error(\(.*\))/logger.error(\1 as Error)/g" "$file"
    
    # Replace console.log statements
    sed -i "s/console\.log(\(.*\))/logger.info(\1)/g" "$file"
    
    # Replace console.warn statements
    sed -i "s/console\.warn(\(.*\))/logger.warn(\1)/g" "$file"
    
    echo "  - Updated console statements"
}

# Update URL routes
update_file "app/api/urls/route.ts" "api"
update_file "app/(shorturl)/u/[shortCode]/route.ts" "api"

# Update file serving routes
update_file "app/api/favicon/route.ts" "files"
update_file "app/(raw)/[userUrlId]/[filename]/direct/route.ts" "files"
update_file "app/(raw)/[userUrlId]/[filename]/raw/route.ts" "files"

# Update user management routes
update_file "app/api/users/route.ts" "users"
update_file "app/api/users/[id]/route.ts" "users"
update_file "app/api/users/[id]/files/route.ts" "users"
update_file "app/api/users/[id]/files/[fileId]/route.ts" "users"
update_file "app/api/users/[id]/login/route.ts" "auth"
update_file "app/api/users/[id]/sessions/route.ts" "users"
update_file "app/api/users/[id]/urls/route.ts" "users"

# Update profile routes
update_file "app/api/profile/route.ts" "users"
update_file "app/api/profile/bash/route.ts" "users"
update_file "app/api/profile/export/route.ts" "users"
update_file "app/api/profile/flameshot/route.ts" "users"
update_file "app/api/profile/sharex/route.ts" "users"
update_file "app/api/profile/spectacle/route.ts" "users"
update_file "app/api/profile/upload-token/route.ts" "users"

# Update settings routes
update_file "app/api/settings/route.ts" "config"
update_file "app/api/settings/favicon/route.ts" "config"

# Update setup routes
update_file "app/api/setup/route.ts" "startup"
update_file "app/api/setup/check/route.ts" "startup"

# Update storage routes
update_file "app/api/storage/type/route.ts" "storage"

# Update file chunk routes
update_file "app/api/files/chunks/route.ts" "files"
update_file "app/api/files/chunks/[uploadId]/complete/route.ts" "files"
update_file "app/api/files/chunks/[uploadId]/part/[partNumber]/route.ts" "files"

# Update other file routes
update_file "app/api/files/[id]/download/route.ts" "files"
update_file "app/api/files/[id]/expiry/route.ts" "files"
update_file "app/api/files/[id]/ocr/route.ts" "ocr"
update_file "app/api/files/[id]/thumbnail/route.ts" "files"
update_file "app/api/files/[...path]/route.ts" "files"
update_file "app/api/files/types/route.ts" "files"

# Update updates route
update_file "app/api/updates/check/route.ts" "api"

echo "Batch update complete!"
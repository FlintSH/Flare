#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Map of file patterns to logger names
const LOGGER_MAP = {
  files: ['files', 'ocr'],
  users: ['users', 'auth'],
  config: ['config', 'settings'],
  storage: ['storage'],
  api: ['api'],
  startup: ['startup', 'setup'],
}

function getLoggerForFile(filePath) {
  if (
    filePath.includes('files') ||
    filePath.includes('favicon') ||
    filePath.includes('thumbnail')
  )
    return 'files'
  if (
    filePath.includes('users') ||
    filePath.includes('profile') ||
    filePath.includes('login')
  )
    return 'users'
  if (filePath.includes('settings') || filePath.includes('config'))
    return 'config'
  if (filePath.includes('storage')) return 'storage'
  if (filePath.includes('setup')) return 'startup'
  if (filePath.includes('ocr')) return 'ocr'
  return 'api'
}

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')

  // Skip if already has logger import
  if (content.includes("from '@/lib/logger'")) {
    console.log(`✓ ${path.basename(filePath)} - already has logger`)
    return
  }

  const logger = getLoggerForFile(filePath)

  // Find the last import line
  const lines = content.split('\n')
  let lastImportIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ')) {
      lastImportIndex = i
    }
  }

  if (lastImportIndex === -1) {
    console.log(`⚠ ${path.basename(filePath)} - no imports found`)
    return
  }

  // Add logger import after last import
  lines.splice(lastImportIndex + 1, 0, `import { loggers } from '@/lib/logger'`)
  lines.splice(lastImportIndex + 2, 0, ``)
  lines.splice(lastImportIndex + 3, 0, `const logger = loggers.${logger}`)

  content = lines.join('\n')

  // Replace console statements
  content = content.replace(/console\.error\((.*?)\)/g, (match, args) => {
    // Check if error is the second argument
    if (args.includes(',')) {
      const parts = args.split(',').map((p) => p.trim())
      if (parts.length === 2) {
        return `logger.error(${parts[0]}, ${parts[1]} as Error)`
      }
    }
    return `logger.error(${args} as Error)`
  })

  content = content.replace(/console\.log\(/g, 'logger.info(')
  content = content.replace(/console\.warn\(/g, 'logger.warn(')

  fs.writeFileSync(filePath, content)
  console.log(`✅ ${path.basename(filePath)} - updated with logger: ${logger}`)
}

// Files to update
const filesToUpdate = [
  'app/api/favicon/route.ts',
  'app/api/files/chunks/[uploadId]/part/[partNumber]/route.ts',
  'app/api/files/[id]/expiry/route.ts',
  'app/api/files/[id]/ocr/route.ts',
  'app/api/files/[id]/thumbnail/route.ts',
  'app/api/files/[...path]/route.ts',
  'app/api/files/types/route.ts',
  'app/api/profile/export/route.ts',
  'app/api/profile/route.ts',
  'app/api/profile/upload-token/route.ts',
  'app/api/settings/favicon/route.ts',
  'app/api/setup/check/route.ts',
  'app/api/storage/type/route.ts',
  'app/api/updates/check/route.ts',
  'app/api/users/[id]/files/[fileId]/route.ts',
  'app/api/users/[id]/files/route.ts',
  'app/api/users/[id]/login/route.ts',
  'app/api/users/[id]/route.ts',
  'app/api/users/[id]/sessions/route.ts',
  'app/api/users/[id]/urls/route.ts',
]

console.log('🚀 Starting logging migration for remaining files...\n')

filesToUpdate.forEach((file) => {
  const fullPath = path.join(process.cwd(), file)
  if (fs.existsSync(fullPath)) {
    updateFile(fullPath)
  } else {
    console.log(`❌ ${file} - file not found`)
  }
})

console.log('\n✨ Migration complete!')

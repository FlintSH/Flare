#!/usr/bin/env node

/**
 * Script to help migrate console.log statements to the new logging system
 * This script identifies files with console statements and provides
 * information about what needs to be updated.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Map of file patterns to logger names
const LOGGER_MAP = {
  'api/files': 'files',
  'api/users': 'users',
  'api/profile': 'users',
  'api/auth': 'auth',
  'api/settings': 'config',
  'api/storage': 'storage',
  'api/urls': 'api',
  'api/updates': 'api',
  'api/setup': 'startup',
  'api/avatars': 'files',
  'api/favicon': 'files',
  'lib/events': 'events',
  'lib/ocr': 'ocr',
  'lib/storage': 'storage',
  'lib/config': 'config',
  'lib/database': 'db',
  'lib/middleware': 'middleware',
  'lib/auth': 'auth',
  'hooks/': 'api',
  'components/': 'api',
}

function getLoggerName(filePath) {
  for (const [pattern, logger] of Object.entries(LOGGER_MAP)) {
    if (filePath.includes(pattern)) {
      return logger
    }
  }
  return 'api' // default
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  const consoleStatements = []
  lines.forEach((line, index) => {
    if (line.match(/console\.(log|error|warn|info)/)) {
      consoleStatements.push({
        line: index + 1,
        type: line.match(/console\.(\w+)/)?.[1],
        content: line.trim(),
      })
    }
  })

  if (consoleStatements.length === 0) return null

  const hasLoggerImport = content.includes("from '@/lib/logger'")
  const suggestedLogger = getLoggerName(filePath)

  return {
    file: filePath,
    statements: consoleStatements,
    hasLoggerImport,
    suggestedLogger,
  }
}

function main() {
  console.log('🔍 Analyzing files with console statements...\n')

  // Get all TypeScript files with console statements
  const files = execSync(
    `find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) -not -path "./node_modules/*" -not -path "./.next/*" -exec grep -l "console\\.\\(log\\|error\\|warn\\)" {} \\;`,
    { encoding: 'utf8', cwd: process.cwd() }
  )
    .trim()
    .split('\n')
    .filter(Boolean)

  const results = files.map(analyzeFile).filter(Boolean)

  // Group by directory
  const byDirectory = {}
  results.forEach((result) => {
    const dir = path.dirname(result.file)
    if (!byDirectory[dir]) {
      byDirectory[dir] = []
    }
    byDirectory[dir].push(result)
  })

  // Print summary
  console.log(`📊 Found ${results.length} files with console statements\n`)

  // Print by directory
  Object.entries(byDirectory).forEach(([dir, files]) => {
    console.log(`\n📁 ${dir} (${files.length} files)`)
    files.forEach((fileInfo) => {
      const fileName = path.basename(fileInfo.file)
      console.log(`  📄 ${fileName}`)
      console.log(`     Logger: loggers.${fileInfo.suggestedLogger}`)
      console.log(`     Statements: ${fileInfo.statements.length}`)
      fileInfo.statements.forEach((stmt) => {
        const mapping = {
          log: 'info',
          error: 'error',
          warn: 'warn',
          info: 'info',
        }
        console.log(
          `       Line ${stmt.line}: console.${stmt.type} → logger.${mapping[stmt.type]}`
        )
      })
    })
  })

  // Print migration instructions
  console.log('\n📝 Migration Instructions:')
  console.log('1. Add import: import { loggers } from "@/lib/logger"')
  console.log('2. Add logger: const logger = loggers.<module>')
  console.log('3. Replace console.log → logger.info')
  console.log('4. Replace console.error → logger.error (with error as Error)')
  console.log('5. Replace console.warn → logger.warn')
  console.log('6. Add context objects instead of string concatenation')

  // Count by type
  const counts = {
    api: 0,
    client: 0,
    scripts: 0,
  }

  results.forEach((r) => {
    if (r.file.includes('/api/')) counts.api++
    else if (
      r.file.includes('components/') ||
      r.file.includes('app/') ||
      r.file.includes('hooks/')
    )
      counts.client++
    else if (r.file.includes('scripts/')) counts.scripts++
  })

  console.log('\n📈 By Category:')
  console.log(`   API Routes: ${counts.api} files`)
  console.log(`   Client Code: ${counts.client} files`)
  console.log(`   Scripts: ${counts.scripts} files`)
}

main()

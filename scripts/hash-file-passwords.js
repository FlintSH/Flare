#!/usr/bin/env node

const {
  migrateFilePasswordsVerbose,
} = require('../lib/migrations/password-hash.js')

async function main() {
  console.log('🚀 Starting file password migration...')
  console.log(
    '⚠️  This will hash all plaintext file passwords in the database.'
  )
  console.log('📝 Existing hashed passwords will be skipped.\n')

  try {
    require('../package.json')
  } catch (error) {
    console.error('❌ Please run this script from the Flare root directory')
    process.exit(1)
  }

  await migrateFilePasswordsVerbose()
}

if (require.main === module) {
  main().catch(console.error)
}

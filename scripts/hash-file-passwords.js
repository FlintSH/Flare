#!/usr/bin/env node

/**
 * Migration script to hash existing plaintext file passwords
 * This script should be run once to upgrade existing Flare instances
 */

const { PrismaClient } = require('@prisma/client')
const { hash, compare } = require('bcryptjs')

const prisma = new PrismaClient()

async function isPasswordHashed(password) {
  // Bcrypt hashes always start with $2a$, $2b$, or $2y$ and are typically 60 characters long
  return password.startsWith('$2') && password.length === 60
}

async function migrateFilePasswords() {
  try {
    console.log('Checking for file password migrations...')

    const filesWithPasswords = await prisma.file.findMany({
      where: {
        password: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        password: true,
      },
    })

    if (filesWithPasswords.length === 0) {
      console.log('No files with passwords found')
      return
    }

    let hashedCount = 0
    let skippedCount = 0
    let failedCount = 0

    for (const file of filesWithPasswords) {
      try {
        // Check if password is already hashed
        if (await isPasswordHashed(file.password)) {
          skippedCount++
          continue
        }

        // Hash the plaintext password
        const hashedPassword = await hash(file.password, 10)

        // Update the file with the hashed password
        await prisma.file.update({
          where: { id: file.id },
          data: { password: hashedPassword },
        })

        hashedCount++

        // Verify the hash works by comparing
        const isValid = await compare(file.password, hashedPassword)
        if (!isValid) {
          console.error(`Hash verification failed for file: ${file.name}`)
          failedCount++
        }
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error.message)
        failedCount++
      }
    }

    if (hashedCount > 0) {
      console.log(`Hashed ${hashedCount} file passwords`)
    }
    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} already hashed passwords`)
    }
    // Flare checks file passwords only against bcrypt hashes, so a file left
    // unhashed can't be opened with its password until a later start hashes
    // it. One unreadable row shouldn't keep the instance from starting.
    if (failedCount > 0) {
      console.error(
        `Could not hash ${failedCount} of ${filesWithPasswords.length} file passwords`
      )
      return
    }

    console.log('File password migrations completed successfully')
  } finally {
    await prisma.$disconnect()
  }
}

// The start scripts stop on a non-zero exit instead of starting the server.
migrateFilePasswords().catch((error) => {
  console.error('Failed to migrate file passwords:', error)
  process.exitCode = 1
})

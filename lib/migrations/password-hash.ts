import { compare, hash } from 'bcryptjs'

import { prisma } from '@/lib/database/prisma'

function isPasswordHashed(password: string): boolean {
  return password.startsWith('$2') && password.length === 60
}

export async function migrateFilePasswords(): Promise<{
  success: boolean
  message: string
  hashedCount?: number
  errorCount?: number
}> {
  try {
    const filesWithPasswords = await prisma.file.findMany({
      where: {
        password: {
          not: null,
        },
      },
      select: {
        id: true,
        password: true,
      },
    })

    if (filesWithPasswords.length === 0) {
      return { success: true, message: 'No files with passwords found' }
    }

    let hashedCount = 0
    let errorCount = 0

    for (const file of filesWithPasswords) {
      try {
        if (!file.password || isPasswordHashed(file.password)) {
          continue
        }

        const hashedPassword = await hash(file.password, 10)
        await prisma.file.update({
          where: { id: file.id },
          data: { password: hashedPassword },
        })
        hashedCount++

        const isValid = await compare(file.password, hashedPassword)
        if (!isValid) {
          console.error(`Hash verification failed for file ${file.id}`)
          errorCount++
        }
      } catch (error) {
        errorCount++
        console.error(
          `Failed to hash password for file ${file.id}:`,
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    }

    if (errorCount > 0) {
      return {
        success: false,
        message: `Failed to hash ${errorCount} passwords`,
        hashedCount,
        errorCount,
      }
    }

    return {
      success: true,
      message: `Successfully hashed ${hashedCount} file passwords`,
      hashedCount,
    }
  } catch (error) {
    return {
      success: false,
      message: `Migration failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    }
  }
}

export async function migrateFilePasswordsVerbose(): Promise<void> {
  console.log('🔍 Scanning for files with plaintext passwords...')

  try {
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
        urlPath: true,
      },
    })

    console.log(`📁 Found ${filesWithPasswords.length} files with passwords`)

    if (filesWithPasswords.length === 0) {
      console.log('✅ No files with passwords found. Migration complete!')
      return
    }

    let hashedCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const file of filesWithPasswords) {
      try {
        if (!file.password || isPasswordHashed(file.password)) {
          console.log(`⏭️  Skipping ${file.name} - password already hashed`)
          skippedCount++
          continue
        }

        const hashedPassword = await hash(file.password, 10)

        await prisma.file.update({
          where: { id: file.id },
          data: { password: hashedPassword },
        })

        console.log(`✅ Hashed password for file: ${file.name}`)
        hashedCount++

        const isValid = await compare(file.password, hashedPassword)
        if (!isValid) {
          console.error(`❌ Hash verification failed for file: ${file.name}`)
          errorCount++
        }
      } catch (error) {
        console.error(
          `❌ Error processing file ${file.name}:`,
          error instanceof Error ? error.message : 'Unknown error'
        )
        errorCount++
      }
    }

    console.log('\n🎉 Migration Summary:')
    console.log(`   ✅ Passwords hashed: ${hashedCount}`)
    console.log(`   ⏭️  Already hashed: ${skippedCount}`)
    console.log(`   ❌ Errors: ${errorCount}`)

    if (errorCount > 0) {
      console.log(
        '\n⚠️  Some passwords failed to hash. Please check the errors above.'
      )
      process.exit(1)
    } else {
      console.log('\n🎊 All file passwords have been successfully hashed!')
    }
  } catch (error) {
    console.error('💥 Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

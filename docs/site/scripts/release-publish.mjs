import { cp, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const filesystem = { cp, lstat, mkdir, rename, rm }
const paths = (destination) => ({
  staging: `${destination}.staging`,
  previous: `${destination}.previous`,
})

async function exists(path, io) {
  try {
    await io.lstat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

// A completed staging-to-destination rename is the publication boundary. If
// interrupted before it, restore the backup; afterward, retain the new output.
export async function recoverDirectoryPublication(
  destination,
  { operations = {} } = {}
) {
  const io = { ...filesystem, ...operations }
  const { staging, previous } = paths(destination)
  if (await exists(previous, io)) {
    if (await exists(destination, io))
      await io.rm(previous, { recursive: true, force: true })
    else await io.rename(previous, destination)
  }
  await io.rm(staging, { recursive: true, force: true })
}

export async function replaceDirectory(
  source,
  destination,
  { operations = {} } = {}
) {
  const io = { ...filesystem, ...operations }
  const { staging, previous } = paths(destination)
  await recoverDirectoryPublication(destination, { operations: io })
  await io.mkdir(dirname(destination), { recursive: true })
  let movedPrevious = false
  try {
    // Copy onto the destination filesystem before touching the last good site.
    // Both subsequent directory renames therefore stay on the same filesystem.
    await io.cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    if (await exists(destination, io)) {
      await io.rename(destination, previous)
      movedPrevious = true
    }
    await io.rename(staging, destination)
  } catch (error) {
    const failures = [error]
    if (movedPrevious) {
      try {
        await io.rename(previous, destination)
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
    }
    try {
      await io.rm(staging, { recursive: true, force: true })
    } catch (cleanupError) {
      failures.push(cleanupError)
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        `Site replacement failed; any previous output is retained at ${destination} or ${previous}. Rerun the release build to recover.`
      )
    throw error
  }
  if (movedPrevious) await io.rm(previous, { recursive: true, force: true })
}

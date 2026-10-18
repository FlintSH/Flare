/* eslint-disable @typescript-eslint/no-require-imports */
// Generates disposable large archives for the optional large-archive checks.
// Nothing here is committed: outputs go to a temporary directory.
const { randomBytes } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { mkdtemp, readdir, readFile, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const archiver = require('archiver')

const root = path.join(__dirname, '../..')

/** Pseudo-random bytes in 1 MiB chunks, so payloads do not compress away. */
function noise(bytes) {
  let remaining = bytes
  return Readable.from(
    (function* () {
      while (remaining > 0) {
        const size = Math.min(remaining, 1024 * 1024)
        remaining -= size
        yield randomBytes(size)
      }
    })()
  )
}

/** A short, valid PCM WAV chord. */
function wav(seconds = 3, rate = 22050) {
  const samples = seconds * rate
  const data = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index++) {
    const time = index / rate
    const fade = Math.min(1, (samples - index) / (rate / 2))
    const value =
      (Math.sin(2 * Math.PI * 523.25 * time) +
        Math.sin(2 * Math.PI * 659.25 * time) +
        Math.sin(2 * Math.PI * 783.99 * time)) /
      3
    data.writeInt16LE(Math.round(value * 0.4 * fade * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function serverLog(lines) {
  const levels = ['INFO', 'INFO', 'INFO', 'WARN', 'DEBUG']
  const routes = ['/api/files', '/dashboard', '/api/upload', '/s/handoff']
  const output = []
  for (let index = 0; index < lines; index++) {
    const minute = String(index % 60).padStart(2, '0')
    const second = String((index * 7) % 60).padStart(2, '0')
    output.push(
      `2026-10-17T14:${minute}:${second}Z ${levels[index % levels.length]} request ${index} ${routes[index % routes.length]} completed in ${(index * 37) % 900}ms`
    )
  }
  return output.join('\n') + '\n'
}

async function write(archive, destination) {
  const writing = pipeline(archive, createWriteStream(destination))
  await archive.finalize()
  await writing
  return (await stat(destination)).size
}

/**
 * A ZIP over the old 256 MiB browsing limit with more than 1,000 entries,
 * real images and video, generated audio, a long log, and a large payload.
 */
async function largeZip(directory, payloadBytes) {
  const destination = path.join(directory, 'Studio handoff.zip')
  const archive = archiver('zip', { zlib: { level: 1 } })
  const images = path.join(root, 'docs/images/archives')
  // A fixed number of real screenshots keeps entry counts stable.
  const photos = (await readdir(images))
    .filter((name) => name.endsWith('.webp'))
    .sort()
    .slice(0, 20)
  for (const [index, name] of photos.entries())
    archive.append(await readFile(path.join(images, name)), {
      name: `photos/2026-10/${String(index + 1).padStart(2, '0')}-${name}`,
      store: true,
    })
  archive.append(
    await readFile(
      path.join(root, '.github/assets/archives/archive-share-browse.webm')
    ),
    { name: 'media/share-walkthrough.webm', store: true }
  )
  archive.append(wav(), { name: 'media/notification.wav' })
  archive.append(serverLog(90_000), { name: 'logs/server-2026-10-17.log' })
  archive.append(
    '# Studio handoff\n\nEverything for the October launch, in one archive.\n\n- photos: approved exports\n- media: walkthrough video and notification sound\n- projects: source for every campaign page\n- datasets: the raw capture used for the color study\n',
    { name: 'README.md' }
  )
  for (let index = 0; index < 20_000; index++) {
    const project = `campaign-${String((index % 48) + 1).padStart(2, '0')}`
    const folder = ['src', 'src/components', 'styles', 'content'][index % 4]
    const extension =
      folder === 'styles' ? 'css' : folder === 'content' ? 'md' : 'ts'
    archive.append(
      `// ${project} module ${index}\nexport const id = ${index}\n`,
      { name: `projects/${project}/${folder}/module-${index}.${extension}` }
    )
  }
  archive.append(noise(payloadBytes), {
    name: 'datasets/raw-capture.bin',
    store: true,
  })
  // Photos, video, audio, log, README, modules, and the payload.
  const files = photos.length + 5 + 20_000
  return { destination, files, size: await write(archive, destination) }
}

/** A TAR.GZ that takes several seconds to read, with useful files at the end. */
async function slowTarGz(directory, members) {
  const destination = path.join(directory, 'Render outputs.tar.gz')
  const archive = archiver('tar', { gzip: true, gzipOptions: { level: 1 } })
  for (let index = 0; index < members; index++)
    archive.append(
      index % 2 ? noise(8 * 1024 * 1024) : Buffer.from(serverLog(60_000)),
      {
        name: `frames/batch-${String(index + 1).padStart(3, '0')}.${index % 2 ? 'bin' : 'log'}`,
      }
    )
  archive.append(
    '# Render summary\n\nAll batches finished. The last batch is the approved cut.\n',
    { name: 'summary/approved-cut.md' }
  )
  return { destination, size: await write(archive, destination) }
}

async function createLargeFixtures(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'flare-large-archives-'))
  try {
    const zip = await largeZip(
      directory,
      options.payloadBytes ?? 900 * 1024 ** 2
    )
    const tgz = await slowTarGz(directory, options.tarMembers ?? 80)
    return {
      directory,
      zip,
      tgz,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

module.exports = { createLargeFixtures }

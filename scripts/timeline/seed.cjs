/* eslint-disable @typescript-eslint/no-require-imports */
// Public, reproducible fixtures. This script refuses other database names and
// existing accounts; it never touches a normal Flare installation.
const { mkdir, writeFile, link, unlink } = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')
const sharp = require('../../docs/site/node_modules/sharp')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_timeline_test_local' ||
  database.hash ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'Timeline fixtures require the local flare_timeline_test_local database and public schema.'
  )

const prisma = new PrismaClient()
const userId = 'timeline-demo-alex'
const otherUserId = 'timeline-demo-other'
const count = 12_000
const storageRoot = path.join(process.cwd(), 'uploads', 'timeline-demo')
const subjects = [
  'Alpine morning',
  'Pacific coast',
  'Desert light',
  'Northern lights',
  'Blue hour',
  'Forest walk',
  'Rose dusk',
  'Quiet horizon',
  'Mountain lake',
  'Autumn hills',
  'Lunar valley',
  'Ocean air',
]
const palettes = [
  ['#a5d8ee', '#eaf0de', '#6b8690', '#284754'],
  ['#e4ba9d', '#f4ddac', '#719fad', '#2a6478'],
  ['#edcda0', '#d67b5d', '#a95246', '#623f46'],
  ['#092c48', '#62bcac', '#316f84', '#142a46'],
  ['#797eac', '#c7a5bd', '#4b668a', '#293c64'],
  ['#bdd5ab', '#e4dab1', '#6d9586', '#345953'],
  ['#e0abb2', '#efccb9', '#b88490', '#80576c'],
  ['#9abfc8', '#efe1c4', '#96b0a6', '#4c7a79'],
  ['#aecbd2', '#e4dfbd', '#6d919c', '#365b71'],
  ['#e3c793', '#f1dba5', '#c69868', '#8d7759'],
  ['#9b94b6', '#d0b9bf', '#696780', '#424059'],
  ['#b8deda', '#e6edda', '#75b0ae', '#397a89'],
]

// Original abstract landscape illustrations are fixture uploads, not invented
// app screenshots. Capture scripts always render the real application.
function landscape(index) {
  const [sky, glow, ridge, near] = palettes[index]
  const sun = index % 3 === 0 ? 570 : 185
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${glow}"/></linearGradient><linearGradient id="lake" x2="0" y2="1"><stop stop-color="${ridge}"/><stop offset="1" stop-color="${sky}"/></linearGradient></defs>
    <rect width="960" height="640" fill="url(#sky)"/>
    <circle cx="${sun}" cy="175" r="62" fill="${glow}" opacity=".9"/>
    <path d="M0 395 145 230 260 335 425 135 615 330 715 235 960 415V640H0Z" fill="${ridge}" opacity=".7"/>
    <path d="m337 225 88-90 95 97-75-34-32 18-32-15Z" fill="${glow}" opacity=".7"/>
    <path d="M0 450 165 350 315 435 540 335 715 405 960 320V640H0Z" fill="${near}"/>
    <path d="M0 480Q210 450 405 485T960 455V640H0Z" fill="url(#lake)"/>
    <path d="M80 535h350m-220 28h280m50-51h300m-60 71h160" stroke="${glow}" stroke-opacity=".4" stroke-width="3"/>
    <path d="M0 640V525Q135 570 255 640M960 640V490Q865 565 695 640" fill="${near}"/>
  </svg>`
}

async function main() {
  if (
    await prisma.user.count({
      where: { id: { notIn: [userId, otherUserId] } },
    })
  )
    throw new Error('Refusing to seed a database containing other accounts.')
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  if (!config)
    throw new Error('Run migrations and scripts/migrate-config.js first.')
  config.value.settings.general.setup = {
    completed: true,
    completedAt: '2026-10-01T00:00:00.000Z',
  }
  config.value.settings.general.ocr = { enabled: false }
  config.value.settings.general.oidc = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  })
  const password = await hash('Timeline-demo-only-2026!', 10)
  for (const [id, name] of [
    [userId, 'Alex Morgan'],
    [otherUserId, 'Jamie Rivera'],
  ]) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        password,
        roles: { connect: { systemKey: 'administrator' } },
        urlId: id,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  }
  await prisma.vaultFolder.create({
    data: {
      id: 'timeline-demo-travel',
      userId,
      name: 'Travel journal',
      normalizedName: 'travel journal',
    },
  })
  await prisma.vaultTag.create({
    data: {
      id: 'timeline-demo-favorites',
      userId,
      name: 'Favorites',
      normalizedName: 'favorites',
    },
  })
  await mkdir(storageRoot, { recursive: true })
  const sizes = []
  for (let index = 0; index < subjects.length; index++) {
    const bytes = await sharp(Buffer.from(landscape(index)))
      .webp({ quality: 85 })
      .toBuffer()
    sizes.push(bytes.length)
    await writeFile(path.join(storageRoot, `landscape-${index}.webp`), bytes)
  }
  const filePassword = await hash('Public-fixture-share-password!', 10)
  let storageUsed = 0
  const latest = Date.parse('2026-10-01T18:00:00Z')
  for (let offset = 0; offset < count; offset += 500) {
    const files = []
    const tags = []
    for (let index = offset; index < Math.min(offset + 500, count); index++) {
      const id = `timeline-demo-file-${String(index).padStart(5, '0')}`
      const illustration = index % subjects.length
      const filename = `${id}.webp`
      const target = path.join(storageRoot, filename)
      await unlink(target).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
      await link(
        path.join(storageRoot, `landscape-${illustration}.webp`),
        target
      )
      storageUsed += sizes[illustration]
      files.push({
        id,
        userId,
        name: `${subjects[illustration]} ${String(index + 1).padStart(5, '0')}.webp`,
        mimeType: 'image/webp',
        urlPath: `/${userId}/${filename}`,
        path: `uploads/timeline-demo/${filename}`,
        size: sizes[illustration] / 1024 ** 2,
        storageTarget: { provider: 'local' },
        uploadedAt: new Date(latest - index * 6 * 60 * 60 * 1000),
        visibility: index % 29 === 17 ? 'PRIVATE' : 'PUBLIC',
        password: index % 37 === 23 ? filePassword : null,
        folderId: index % 7 === 5 ? 'timeline-demo-travel' : null,
        isOcrProcessed: true,
        ocrText:
          index % 3 === 0
            ? 'A peaceful landscape from the travel journal.'
            : null,
      })
      if (index % 3 === 0)
        tags.push({ fileId: id, tagId: 'timeline-demo-favorites' })
    }
    await prisma.file.createMany({ data: files })
    await prisma.vaultFileTag.createMany({ data: tags })
  }
  await prisma.file.create({
    data: {
      id: 'timeline-demo-other-account-file',
      userId: otherUserId,
      name: 'Other account isolation marker.webp',
      mimeType: 'image/webp',
      urlPath: `/${otherUserId}/isolation.webp`,
      path: 'uploads/timeline-demo/landscape-0.webp',
      size: sizes[0] / 1024 ** 2,
      storageTarget: { provider: 'local' },
      uploadedAt: new Date(latest),
      isOcrProcessed: true,
    },
  })
  await prisma.user.update({
    where: { id: userId },
    data: { storageUsed: storageUsed / 1024 ** 2 },
  })
  console.log(
    `Created ${count.toLocaleString()} demo files spanning 2018–2026, plus an isolated second account.`
  )
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

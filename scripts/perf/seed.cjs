/* eslint-disable @typescript-eslint/no-require-imports */
// A large, reproducible library for performance measurements. This script
// refuses any database but a local `flare_perf` or `flare_perf_<side>` one and
// refuses to add to existing accounts; it never touches a normal Flare
// installation.
const { mkdir, writeFile, link, stat } = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')
const sharp = require('../../docs/site/node_modules/sharp')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !/^\/flare_perf(_[a-z]+)?$/.test(database.pathname)
)
  throw new Error(
    'Performance fixtures require a local database named flare_perf or flare_perf_<side>.'
  )

const prisma = new PrismaClient()
const number = (name, fallback) => Number(process.env[name] || fallback)
const FILES = number('PERF_FILES', 100_000)
const OTHER_USERS = number('PERF_USERS', 400)
const FILES_PER_OTHER_USER = 50
const FOLDERS = 300
const TAGS = 200
const LINKS = number('PERF_LINKS', 5_000)
const AUDIT_EVENTS = number('PERF_AUDIT_EVENTS', 300_000)
const EXPIRIES = number('PERF_EXPIRIES', 5_000)

const OWNER = 'perf-owner'
const PASSWORD = 'Perf-bench-only-2026!'
// Flare finds a named token by the SHA-256 of its text. This is the digest of
// the public fixture token scripts/perf/api.cjs sends,
// `flr_perf-public-disposable-benchmark-token`.
const API_TOKEN_DIGEST =
  '5e9aae5bfcf80bdb39bf93dd02def61a5ec8fecc894a38c9ec537eaa061c4054'
const storageRoot = path.join(process.cwd(), 'uploads', 'perf')

// Deterministic, so two seeded databases hold the same rows.
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS =
  `invoice total subtotal balance due payment receipt order shipping address
  customer account number reference meeting notes agenda action items deadline
  project roadmap quarter revenue forecast budget report summary draft review
  release build deploy server error warning timeout connection database query
  password username login settings profile dashboard upload download share
  screenshot window terminal console editor branch commit merge request issue
  travel flight hotel booking confirmation passport boarding gate departure
  recipe ingredients butter flour sugar minutes oven temperature servings`
    .split(/\s+/)
    .filter(Boolean)

function sentence(next, length) {
  const words = []
  for (let index = 0; index < length; index++)
    words.push(WORDS[Math.floor(next() * WORDS.length)])
  return words.join(' ')
}

// Kinds by share of a screenshot-heavy library. Each lists the source files
// its rows link to, so every row serves real bytes of a realistic size.
const KINDS = [
  { share: 55, kind: 'screenshot', mime: 'image/png', ext: 'png' },
  { share: 15, kind: 'photo', mime: 'image/jpeg', ext: 'jpg' },
  { share: 5, kind: 'picture', mime: 'image/webp', ext: 'webp' },
  { share: 5, kind: 'clip', mime: 'video/mp4', ext: 'mp4' },
  { share: 8, kind: 'text', mime: 'text/plain', ext: 'txt' },
  { share: 6, kind: 'document', mime: 'application/pdf', ext: 'pdf' },
  { share: 6, kind: 'archive', mime: 'application/zip', ext: 'zip' },
]
const kindAt = (roll) => {
  let edge = 0
  for (const kind of KINDS) {
    edge += kind.share
    if (roll * 100 < edge) return kind
  }
  return KINDS[0]
}

// A code editor: a sidebar of file names and lines of text, the detail that
// makes a real screenshot hundreds of kilobytes and its thumbnail more than
// a flat tile.
function screenshotSvg(index, width, height) {
  const hue = (index * 47) % 360
  const next = random(index + 1)
  const rows = []
  for (let row = 0; row < 30; row++) {
    const y = 176 + row * 41
    const indent = 330 + Math.floor(next() * 4) * 44
    rows.push(
      `<text x="258" y="${y}" font-family="monospace" font-size="22" fill="#475569">${row + 1}</text>`,
      `<text x="${indent}" y="${y}" font-family="monospace" font-size="22" fill="hsl(${(hue + row * 23) % 360} 60% 72%)">${sentence(next, 3 + Math.floor(next() * 9))}</text>`
    )
  }
  const files = []
  for (let row = 0; row < 24; row++)
    files.push(
      `<text x="26" y="${130 + row * 38}" font-family="sans-serif" font-size="20" fill="#94a3b8">${sentence(next, 1)}-${row}.ts</text>`
    )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 2560 1440">
    <rect width="2560" height="1440" fill="#0f172a"/>
    <rect width="2560" height="72" fill="#1e293b"/>
    <circle cx="40" cy="36" r="12" fill="#ef4444"/><circle cx="80" cy="36" r="12" fill="#f59e0b"/><circle cx="120" cy="36" r="12" fill="#22c55e"/>
    <text x="1180" y="46" font-family="sans-serif" font-size="26" fill="#cbd5e1">Fixture window ${index + 1}</text>
    <rect y="72" width="220" height="1368" fill="#111c33"/>
    <rect x="220" y="72" width="2340" height="64" fill="hsl(${hue} 40% 22%)"/>
    ${files.join('')}
    ${rows.join('')}
  </svg>`
}

function photoSvg(index) {
  const hue = (index * 53) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4032" height="3024" viewBox="0 0 960 720">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="hsl(${hue} 60% 72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 70% 88%)"/></linearGradient></defs>
    <rect width="960" height="720" fill="url(#sky)"/>
    <circle cx="${180 + (index % 5) * 140}" cy="170" r="64" fill="hsl(${(hue + 60) % 360} 90% 90%)"/>
    <path d="M0 430 145 250 260 360 425 150 615 350 715 255 960 440V720H0Z" fill="hsl(${(hue + 180) % 360} 28% 42%)"/>
    <path d="M0 500 165 390 315 480 540 370 715 450 960 360V720H0Z" fill="hsl(${(hue + 200) % 360} 34% 28%)"/>
    <path d="M0 560Q210 520 405 565T960 530V720H0Z" fill="hsl(${(hue + 210) % 360} 40% 36%)"/>
  </svg>`
}

// Noise drawn `scale` times smaller and enlarged: detail of that size, like
// clouds, foliage and gravel, which survives being scaled down to a thumbnail.
function texture(scale, sigma) {
  return sharp({
    create: {
      width: Math.round(4032 / scale),
      height: Math.round(3024 / scale),
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma },
    },
  })
    .png({ compressionLevel: 1 })
    .toBuffer()
    .then((small) =>
      sharp(small)
        .resize(4032, 3024, { kernel: 'cubic', fit: 'fill' })
        .png({ compressionLevel: 1 })
        .toBuffer()
    )
}

// A 12-megapixel camera photo: a scene, texture at three sizes, and the
// sensor noise that makes a camera JPEG megabytes rather than kilobytes.
async function photo(index) {
  const layers = await Promise.all([
    texture(64, 40),
    texture(12, 34),
    texture(3, 26),
    texture(1, 9),
  ])
  return sharp(Buffer.from(photoSvg(index)))
    .composite(layers.map((input) => ({ input, blend: 'soft-light' })))
    .jpeg({ quality: 88 })
    .toBuffer()
}

async function sources() {
  await mkdir(storageRoot, { recursive: true })
  const made = {}
  const write = async (kind, index, ext, bytes) => {
    const name = `source-${kind}-${index}.${ext}`
    const target = path.join(storageRoot, name)
    const existing = await stat(target).catch(() => null)
    if (!existing) await writeFile(target, await bytes())
    const size = existing?.size ?? (await stat(target)).size
    ;(made[kind] ??= []).push({ name, size })
  }
  for (let index = 0; index < 12; index++) {
    await write('screenshot', index, 'png', () =>
      sharp(
        Buffer.from(
          index % 3 === 2
            ? screenshotSvg(index, 3840, 2160)
            : screenshotSvg(index, 2560, 1440)
        )
      )
        .png()
        .toBuffer()
    )
    await write('picture', index, 'webp', () =>
      sharp(Buffer.from(photoSvg(index)))
        .resize(1600)
        .webp({ quality: 82 })
        .toBuffer()
    )
  }
  for (let index = 0; index < 8; index++)
    await write('photo', index, 'jpg', () => photo(index))
  const next = random(7)
  for (let index = 0; index < 4; index++) {
    await write('text', index, 'txt', async () =>
      Buffer.from(
        Array.from({ length: 400 }, () => sentence(next, 12)).join('\n')
      )
    )
    // Opaque bytes: these kinds are listed and downloaded, never decoded.
    for (const [kind, ext, megabytes] of [
      ['clip', 'mp4', 6],
      ['document', 'pdf', 0.4],
      ['archive', 'zip', 2],
    ])
      await write(kind, index, ext, async () => {
        const bytes = Buffer.alloc(Math.round(megabytes * 262_144) * 4)
        const fill = random(index + 100)
        for (let offset = 0; offset < bytes.length; offset += 4)
          bytes.writeUInt32LE(Math.floor(fill() * 2 ** 32), offset)
        return bytes
      })
  }
  return made
}

function displayName(kind, index, when) {
  const date = when.toISOString().slice(0, 10)
  const time = when.toISOString().slice(11, 19).replace(/:/g, '.')
  switch (kind.kind) {
    case 'screenshot':
      return `Screenshot ${date} at ${time}.png`
    case 'photo':
      return `IMG_${String(index % 10000).padStart(4, '0')}.jpg`
    case 'picture':
      return `wallpaper-${index}.webp`
    case 'clip':
      return `clip-${date}-${index}.mp4`
    case 'text':
      return `notes-${date}-${index}.txt`
    case 'document':
      return `invoice-${date}-${index}.pdf`
    default:
      return `backup-${date}-${index}.zip`
  }
}

async function batches(total, size, build, insert) {
  for (let offset = 0; offset < total; offset += size) {
    const rows = []
    for (let index = offset; index < Math.min(offset + size, total); index++)
      rows.push(...[build(index)].flat())
    await insert(rows)
  }
}

async function main() {
  if (await prisma.user.count())
    throw new Error('Refusing to seed a database that already has accounts.')
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
  config.value.settings.general.storage.maxUploadSize = {
    value: 2,
    unit: 'GB',
  }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })

  const made = await sources()
  const password = await hash(PASSWORD, 10)
  const latest = Date.parse('2026-11-01T18:00:00Z')
  const span = 8 * 365 * 86_400_000

  await prisma.user.create({
    data: {
      id: OWNER,
      name: 'Perf Owner',
      email: 'perf-owner@example.test',
      password,
      roles: { connect: { systemKey: 'administrator' } },
      urlId: 'perf',
      uploadToken: 'perf-owner-public-disposable-upload-token',
      apiTokens: {
        create: {
          name: 'Benchmark',
          hash: API_TOKEN_DIGEST,
          scopes: ['files:upload', 'files:read', 'urls:read', 'urls:write'],
        },
      },
    },
  })
  await prisma.user.createMany({
    data: Array.from({ length: OTHER_USERS }, (_, index) => ({
      id: `perf-user-${index}`,
      name: `Member ${index + 1}`,
      email: `perf-user-${index}@example.test`,
      password,
      urlId: `m${index}`,
      uploadToken: `perf-user-${index}-public-disposable-upload-token`,
      createdAt: new Date(latest - (index + 1) * 86_400_000),
      storageUsed: 60,
    })),
  })
  const userRole = await prisma.role.findFirst({ where: { systemKey: 'user' } })
  if (userRole)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_RoleToUser" ("A", "B") SELECT $1, id FROM "User" WHERE id LIKE 'perf-user-%' ON CONFLICT DO NOTHING`,
      userRole.id
    )

  await prisma.vaultFolder.createMany({
    data: Array.from({ length: FOLDERS }, (_, index) => ({
      id: `perf-folder-${index}`,
      userId: OWNER,
      name: `Folder ${index + 1}`,
      normalizedName: `folder ${index + 1}`,
      // The first thirty are roots; the rest nest under them.
      parentId: index < 30 ? null : `perf-folder-${index % 30}`,
    })),
  })
  await prisma.vaultTag.createMany({
    data: Array.from({ length: TAGS }, (_, index) => ({
      id: `perf-tag-${index}`,
      userId: OWNER,
      name: `${WORDS[index % WORDS.length]}-${index}`,
      normalizedName: `${WORDS[index % WORDS.length]}-${index}`,
    })),
  })

  const next = random(42)
  const filePassword = await hash('Public-fixture-share-password!', 10)
  let storageUsed = 0
  const fileRow = (userId, urlId, id, index, when, linked) => {
    const kind = kindAt(next())
    const source = made[kind.kind][index % made[kind.kind].length]
    const filename = `${id}.${kind.ext}`
    const image = kind.mime.startsWith('image/')
    return {
      row: {
        id,
        userId,
        name: displayName(kind, index, when),
        mimeType: kind.mime,
        urlPath: `/${urlId}/${filename}`,
        path: linked
          ? `uploads/perf/${filename}`
          : `uploads/perf/${source.name}`,
        size: source.size / 1024 ** 2,
        storageTarget: { provider: 'local' },
        uploadedAt: when,
        visibility: next() < 0.2 ? 'PRIVATE' : 'PUBLIC',
        password: next() < 0.03 ? filePassword : null,
        folderId:
          userId === OWNER && next() < 0.6
            ? `perf-folder-${Math.floor(next() * FOLDERS)}`
            : null,
        isOcrProcessed: true,
        ocrText:
          image && next() < 0.6
            ? sentence(next, 30 + Math.floor(next() * 60))
            : null,
        views: Math.floor(next() ** 4 * 5000),
        downloads: Math.floor(next() ** 6 * 500),
      },
      source,
      filename,
    }
  }

  for (let offset = 0; offset < FILES; offset += 2_000) {
    const files = []
    const tags = []
    const links = []
    for (let index = offset; index < Math.min(offset + 2_000, FILES); index++) {
      const id = `perf-file-${String(index).padStart(6, '0')}`
      const when = new Date(latest - Math.floor((index / FILES) * span))
      const { row, source, filename } = fileRow(
        OWNER,
        'perf',
        id,
        index,
        when,
        true
      )
      files.push(row)
      storageUsed += source.size
      links.push(
        link(
          path.join(storageRoot, source.name),
          path.join(storageRoot, filename)
        ).catch((error) => {
          if (error.code !== 'EEXIST') throw error
        })
      )
      const tagCount = Math.floor(next() * 4)
      const first = Math.floor(next() * TAGS)
      for (let tag = 0; tag < tagCount; tag++)
        tags.push({ fileId: id, tagId: `perf-tag-${(first + tag * 7) % TAGS}` })
    }
    await Promise.all(links)
    await prisma.file.createMany({ data: files })
    await prisma.vaultFileTag.createMany({ data: tags })
  }
  // Files the benchmarks name. They are the oldest, so the first screens of
  // the library stay as the loop above made them.
  const named = [
    ['perf-private-photo', 'photo', 'image/jpeg', 'jpg', 'PRIVATE'],
    ['perf-public-photo', 'photo', 'image/jpeg', 'jpg', 'PUBLIC'],
    ['perf-public-screenshot', 'screenshot', 'image/png', 'png', 'PUBLIC'],
    ['perf-public-notes', 'text', 'text/plain', 'txt', 'PUBLIC'],
  ]
  for (const [id, kind, mimeType, ext, visibility] of named) {
    const source = made[kind][0]
    storageUsed += source.size
    await link(
      path.join(storageRoot, source.name),
      path.join(storageRoot, `${id}.${ext}`)
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    await prisma.file.create({
      data: {
        id,
        userId: OWNER,
        name: `${id}.${ext}`,
        mimeType,
        urlPath: `/perf/${id}.${ext}`,
        path: `uploads/perf/${id}.${ext}`,
        size: source.size / 1024 ** 2,
        storageTarget: { provider: 'local' },
        uploadedAt: new Date(latest - span - 86_400_000),
        visibility,
        isOcrProcessed: true,
      },
    })
  }
  await prisma.user.update({
    where: { id: OWNER },
    data: { storageUsed: storageUsed / 1024 ** 2 },
  })

  await batches(
    OTHER_USERS * FILES_PER_OTHER_USER,
    5_000,
    (index) => {
      const user = Math.floor(index / FILES_PER_OTHER_USER)
      return fileRow(
        `perf-user-${user}`,
        `m${user}`,
        `perf-member-file-${index}`,
        index,
        new Date(latest - index * 3_600_000),
        false
      ).row
    },
    (data) => prisma.file.createMany({ data })
  )

  await batches(
    LINKS,
    5_000,
    (index) => ({
      id: `perf-link-${index}`,
      shortCode: `p${index.toString(36)}`,
      targetUrl: `https://example.test/articles/${index}?ref=flare`,
      clicks: Math.floor(next() ** 3 * 900),
      createdAt: new Date(latest - index * 7_200_000),
      userId: OWNER,
    }),
    (data) => prisma.shortenedUrl.createMany({ data })
  )

  // Pending expiries, as accounts with a default expiry hold them. They fall
  // a year or more ahead, so the expiry worker leaves the fixtures alone.
  await batches(
    EXPIRIES,
    5_000,
    (index) => {
      const fileId = `perf-file-${String(index * 3).padStart(6, '0')}`
      const expiresAt = new Date(latest + (index + 9_000) * 3_600_000)
      return {
        type: 'file.schedule-expiration',
        status: 'SCHEDULED',
        scheduledAt: expiresAt,
        payload: {
          fileId,
          userId: OWNER,
          fileName: fileId,
          expiresAt: expiresAt.toISOString(),
          action: 'DELETE',
        },
      }
    },
    (data) => prisma.event.createMany({ data })
  )

  // The log an instance of this size has after some months of use.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (id, "createdAt", action, category, outcome, "actorId", "actorName", "targetType", "targetId", "targetName", "requestId", method, route, status, details)
     SELECT 'perf-audit-' || n,
       $1::timestamp - (n * INTERVAL '40 seconds'),
       (ARRAY['file.viewed','file.thumbnail','file.uploaded','file.listed','auth.session.read','file.deleted','url.clicked','user.updated'])[1 + n % 8],
       (ARRAY['files','files','files','files','authentication','files','urls','users'])[1 + n % 8],
       CASE WHEN n % 41 = 0 THEN 'failure' ELSE 'success' END,
       CASE WHEN n % 5 = 0 THEN NULL ELSE 'perf-user-' || (n % ${OTHER_USERS}) END,
       CASE WHEN n % 5 = 0 THEN NULL ELSE 'Member ' || (1 + n % ${OTHER_USERS}) END,
       'file', 'perf-file-' || lpad((n % ${FILES})::text, 6, '0'), 'Screenshot ' || n || '.png',
       'perf-request-' || n, 'GET', '/api/files/[id]/thumbnail', 200, '{}'::jsonb
     FROM generate_series(1, ${AUDIT_EVENTS}) AS n`,
    new Date(latest)
  )
  // As autovacuum leaves a database that has been running for a while.
  await prisma.$executeRawUnsafe('VACUUM ANALYZE')

  console.log(
    JSON.stringify({
      files: await prisma.file.count(),
      ownerFiles: await prisma.file.count({ where: { userId: OWNER } }),
      users: await prisma.user.count(),
      tags: await prisma.vaultFileTag.count(),
      links: await prisma.shortenedUrl.count(),
      expiries: await prisma.event.count(),
      auditEvents: await prisma.auditEvent.count(),
      storageGiB: +(storageUsed / 1024 ** 3).toFixed(1),
    })
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

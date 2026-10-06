/* eslint-disable @typescript-eslint/no-require-imports */
// Public, disposable fixtures only. This guard deliberately excludes live databases.
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/archive_demo' ||
  database.searchParams.getAll('schema').length > 1 ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'Archive demos require the public schema of a local PostgreSQL database named archive_demo.'
  )

const prisma = new PrismaClient()
async function seed() {
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  if (!config)
    throw new Error(
      'Open /auth/login once to initialize application configuration.'
    )
  config.value.settings.general.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  }
  config.value.settings.general.ocr = { enabled: false }
  config.value.settings.general.oidc = { enabled: false }
  config.value.settings.general.storage.provider = 'local'
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  // Delete only the named public fixtures; rerunning never resets unrelated accounts.
  for (const id of ['archive-demo-alex', 'archive-demo-jamie']) {
    await prisma.file.deleteMany({ where: { userId: id } })
    // Explicit child-first removal respects the folder tree's NoAction relation.
    let folders = await prisma.vaultFolder.findMany({
      where: { userId: id },
      select: { id: true, parentId: true },
    })
    while (folders.length) {
      const parents = new Set(folders.map((folder) => folder.parentId))
      const leaves = folders
        .filter((folder) => !parents.has(folder.id))
        .map((folder) => folder.id)
      if (!leaves.length)
        throw new Error('Unexpected folder cycle in demonstration account.')
      await prisma.vaultFolder.deleteMany({
        where: { id: { in: leaves }, userId: id },
      })
      folders = folders.filter((folder) => !leaves.includes(folder.id))
    }
    await prisma.user.deleteMany({ where: { id } })
    await prisma.user.create({
      data: {
        id,
        name: id.endsWith('alex') ? 'Alex Morgan' : 'Jamie Rivera',
        email: `${id}@example.test`,
        password: await hash('Archive-demo-only-2026!', 10),
        urlId: id,
        uploadToken: `${id}-disposable-fixture-token`,
      },
    })
  }
  console.log('Created isolated archive demonstration accounts.')
}
seed()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

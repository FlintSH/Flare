/* eslint-disable @typescript-eslint/no-require-imports */
// Public fixtures only. Never point this script at an existing application DB.
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const database = new URL(process.env.DATABASE_URL)
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/flare_auth_demo')
)
  throw new Error('Security demos require a local flare_auth_demo database.')

const prisma = new PrismaClient()
async function seed() {
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  if (!config)
    throw new Error(
      'Open /auth/login once to initialize the app configuration.'
    )
  config.value.settings.general.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  }
  config.value.settings.general.ocr = { enabled: false }
  config.value.settings.general.oidc = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  // Re-running the demonstration starts these two fixtures from scratch.
  await prisma.user.deleteMany({
    where: { id: { in: ['security-demo-alex', 'security-demo-jamie'] } },
  })
  await prisma.authRateLimit.deleteMany()
  for (const [id, name] of [
    ['security-demo-alex', 'Alex Morgan'],
    ['security-demo-jamie', 'Jamie Rivera'],
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        email: `${id}@example.test`,
        password: await hash('Security-demo-only-2026!', 10),
        roles: { connect: { systemKey: 'administrator' } },
        urlId: id,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  }
  console.log('Created isolated security demonstration accounts.')
}
seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

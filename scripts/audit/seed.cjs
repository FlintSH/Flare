/* eslint-disable @typescript-eslint/no-require-imports */
// Public fixtures only. Never point this script at an existing application DB.
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_audit_demo' ||
  database.searchParams.getAll('schema').length > 1 ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'Audit demos require a local PostgreSQL database named exactly flare_audit_demo using its public schema.'
  )

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
  config.value.settings.general.registrations = {
    enabled: true,
    disabledMessage: '',
  }
  config.value.settings.general.oidc = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  // Re-running the demonstration starts these three fixtures from scratch.
  await prisma.user.deleteMany({
    where: {
      id: { in: ['audit-demo-alex', 'audit-demo-jamie', 'audit-demo-casey'] },
    },
  })
  await prisma.authRateLimit.deleteMany()
  await prisma.role.deleteMany({
    where: { name: 'Audit reviewers', systemKey: null },
  })
  await prisma.auditEvent.deleteMany()
  for (const [id, name] of [
    ['audit-demo-alex', 'Alex Morgan'],
    ['audit-demo-jamie', 'Jamie Rivera'],
    ['audit-demo-casey', 'Casey Chen'],
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        email: `${id}@example.test`,
        password: await hash('Audit-demo-only-2026!', 10),
        roles: {
          connect: {
            systemKey: id === 'audit-demo-alex' ? 'administrator' : 'everyone',
          },
        },
        urlId: id,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  }
  console.log('Created isolated audit demonstration accounts.')
}
seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

/* eslint-disable @typescript-eslint/no-require-imports */
// Public fixtures only. Never point this script at an existing application DB.
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_file_requests_demo' ||
  database.searchParams.getAll('schema').length > 1 ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'File request demos require a local PostgreSQL database named exactly flare_file_requests_demo using its public schema.'
  )

const prisma = new PrismaClient()
const fixtures = [
  ['request-demo-alex', 'Alex Morgan', 'alexm', 'administrator'],
  ['request-demo-jamie', 'Jamie Rivera', 'jamie', null],
]

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
    ...config.value.settings.general.registrations,
    enabled: false,
    disabledMessage: 'This is a private instance.',
  }
  config.value.settings.general.storage.maxUploadSize = {
    value: 2,
    unit: 'GB',
  }
  config.value.settings.general.oidc = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  // Re-running the demonstration starts every fixture from scratch.
  await prisma.fileRequest.deleteMany()
  await prisma.user.deleteMany({
    where: { id: { in: fixtures.map(([id]) => id) } },
  })
  await prisma.authRateLimit.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.event.deleteMany({ where: { type: 'file-request.notify' } })
  const everyone = await prisma.role.findUniqueOrThrow({
    where: { systemKey: 'everyone' },
  })
  // The demo starts from the default: only administrators request files.
  await prisma.role.update({
    where: { id: everyone.id },
    data: {
      permissions: everyone.permissions.filter(
        (permission) => permission !== 'fileRequests.manage'
      ),
    },
  })
  for (const [id, name, urlId, systemKey] of fixtures)
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        password: await hash('Request-demo-only-2026!', 10),
        roles: systemKey ? { connect: { systemKey } } : undefined,
        urlId,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  const tag = await prisma.vaultTag.create({
    data: {
      userId: 'request-demo-alex',
      name: 'Clients',
      normalizedName: 'clients',
    },
  })
  await prisma.vaultFolder.create({
    data: {
      userId: 'request-demo-alex',
      name: 'Acme rebrand',
      normalizedName: 'acme rebrand',
    },
  })
  await prisma.uploadProfile.create({
    data: {
      userId: 'request-demo-alex',
      name: 'Client deliveries',
      options: { tagIds: [tag.id], randomizeFileUrls: true },
    },
  })
  console.log('Created isolated file request demonstration accounts.')
}
seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

/* eslint-disable @typescript-eslint/no-require-imports */
// Public fixtures only. Never point this script at an existing application DB.
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_invites_demo' ||
  database.searchParams.getAll('schema').length > 1 ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'Invite demos require a local PostgreSQL database named exactly flare_invites_demo using its public schema.'
  )

const prisma = new PrismaClient()
const fixtures = [
  ['invite-demo-alex', 'Alex Morgan', 'alexm', 'administrator'],
  ['invite-demo-jamie', 'Jamie Rivera', 'jamie', null],
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
    enabled: false,
    disabledMessage:
      'This is a private instance. Ask a member for an invite link.',
    inviteLimits: { activeInvites: 5, usesPerInvite: 1, lifetimeDays: 30 },
  }
  config.value.settings.general.oidc = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  // Re-running the demonstration starts every invite fixture from scratch.
  await prisma.invite.deleteMany()
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: { in: fixtures.map(([id]) => id) } },
        { email: { endsWith: '@invite-demo.example' } },
      ],
    },
  })
  await prisma.authRateLimit.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.role.deleteMany({
    where: { name: { in: ['Moderator', 'Community host'] }, systemKey: null },
  })
  const everyone = await prisma.role.findUniqueOrThrow({
    where: { systemKey: 'everyone' },
  })
  // The demo starts from the default: only administrators can invite.
  await prisma.role.update({
    where: { id: everyone.id },
    data: {
      permissions: everyone.permissions.filter(
        (permission) => !permission.startsWith('invites.')
      ),
    },
  })
  await prisma.role.create({
    data: {
      name: 'Moderator',
      description: 'Reviews uploads and keeps the workspace tidy.',
      color: '#f59e0b',
      position: 30,
      permissions: ['users.read', 'content.read', 'content.update'],
    },
  })
  // Everyone applies implicitly; only additional roles are connected.
  for (const [id, name, urlId, systemKey] of fixtures)
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        password: await hash('Invite-demo-only-2026!', 10),
        roles: systemKey ? { connect: { systemKey } } : undefined,
        urlId,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  console.log('Created isolated invite demonstration accounts.')
}
seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

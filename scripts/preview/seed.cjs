// Public synthetic fixtures only. These defaults are part of the PR image and
// can be changed by its author. The separate trusted gateway and deployment
// controller enforce the public boundary, limits and expiry.
const { randomBytes } = require('node:crypto')

const DEMO_EMAIL = 'demo@example.test'
const DEMO_PASSWORD = 'Flare-preview-only!2026'

function validateEnvironment(env = process.env) {
  if (env.FLARE_PR_PREVIEW !== 'true')
    throw new Error('Preview fixtures require FLARE_PR_PREVIEW=true.')

  let database
  let origin
  try {
    database = new URL(env.DATABASE_URL)
    origin = new URL(env.NEXTAUTH_URL)
  } catch {
    throw new Error('Preview database and public origin must be configured.')
  }
  if (
    !['postgresql:', 'postgres:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    database.port !== '5432' ||
    !database.username ||
    !database.password ||
    !/^\/[a-zA-Z0-9_]+$/.test(database.pathname) ||
    database.hash ||
    [...database.searchParams].some(
      ([key, value]) => key !== 'schema' || value !== 'public'
    )
  )
    throw new Error('Preview fixtures require the isolated local database.')
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Preview NEXTAUTH_URL must be an HTTPS origin.')
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32)
    throw new Error(
      'Preview requires a fresh session secret of at least 32 characters.'
    )
}

function createPreviewConfig() {
  return {
    version: '1.1.0',
    settings: {
      email: {
        enabled: false,
        smtp: {
          host: '',
          port: 465,
          security: 'tls',
          authentication: true,
          username: '',
          password: '',
          ca: '',
          timeoutSeconds: 15,
        },
        recovery: { enabled: false },
        verification: { mode: 'off', appliedMode: 'off', trustOidc: false },
        changes: { enabled: false },
      },
      general: {
        setup: { completed: true, completedAt: new Date().toISOString() },
        registrations: {
          enabled: false,
          disabledMessage:
            'Public disposable preview. Use the demo login from the pull request.',
        },
        storage: {
          provider: 'local',
          s3: {
            bucket: '',
            region: '',
            accessKeyId: '',
            secretAccessKey: '',
            endpoint: '',
            forcePathStyle: false,
          },
          quotas: { enabled: true, default: { value: 50, unit: 'MB' } },
          maxUploadSize: { value: 5, unit: 'MB' },
        },
        credits: { showFooter: true },
        ocr: { enabled: false },
        oidc: {
          enabled: false,
          issuer: '',
          clientId: '',
          clientSecret: '',
          buttonText: 'Sign in with SSO',
          autoProvision: false,
          requireEmailVerified: true,
          enforceSso: false,
        },
      },
      appearance: { theme: 'dark', favicon: null, customColors: {} },
      advanced: { customCSS: '', customHead: '' },
    },
  }
}

async function seed(prisma, hash) {
  const password = await hash(DEMO_PASSWORD, 10)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
    if ((await tx.user.count()) !== 0)
      throw new Error(
        'Refusing to seed a database that already contains users.'
      )

    // Keep bootstrap closed even if a future PR lets a visitor delete the demo
    // user. No password or public credential grants access to this administrator.
    await tx.user.create({
      data: {
        id: 'preview-bootstrap-sentinel',
        name: 'Preview bootstrap sentinel',
        email: 'preview-sentinel@example.test',
        password: null,
        role: 'ADMIN',
        emailExempt: true,
        urlId: 'preview-sentinel',
        uploadToken: randomBytes(32).toString('hex'),
      },
    })
    await tx.user.create({
      data: {
        id: 'preview-demo-user',
        name: 'Public preview demo',
        email: DEMO_EMAIL,
        password,
        role: 'USER',
        emailExempt: true,
        urlId: 'preview-demo',
        uploadToken: randomBytes(32).toString('hex'),
        defaultFileExpiration: 'HOUR',
        defaultFileExpirationAction: 'DELETE',
      },
    })
    const value = createPreviewConfig()
    await tx.config.upsert({
      where: { key: 'flare_config' },
      create: { key: 'flare_config', value },
      update: { value },
    })
  })
}

async function main() {
  validateEnvironment()
  if (process.argv[2] === '--check-environment') return
  // The fixture script lives outside /app, so resolve baked dependencies from
  // their explicit location rather than relying on the current working directory.
  const { PrismaClient } = require('/app/node_modules/@prisma/client')
  const { hash } = require('/app/node_modules/bcryptjs')
  const prisma = new PrismaClient()
  try {
    if (process.argv[2] === '--check-empty') {
      if ((await prisma.user.count()) !== 0)
        throw new Error(
          'Refusing to seed a database that already contains users.'
        )
      return
    }
    await seed(prisma, hash)
    console.log('Public preview fixtures ready.')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module)
  main().catch((error) => {
    // Do not include database URLs or credentials in public workflow logs.
    console.error('Preview initialization failed:', error.message)
    process.exitCode = 1
  })

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  validateEnvironment,
  createPreviewConfig,
  seed,
}

// Public fixtures for the isolated Meticulous image, never production data.
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const url = new URL(process.env.DATABASE_URL)
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('Meticulous fixtures require a local disposable database')
}
const prisma = new PrismaClient()
async function seed() {
  await prisma.user.upsert({
    where: { id: 'meticulous-test-admin' },
    update: {},
    create: {
      id: 'meticulous-test-admin',
      email: 'meticulous@example.test',
      name: 'Meticulous Test',
      password: await bcrypt.hash('Flare-test-only-2026!', 10),
      roles: { connect: { systemKey: 'administrator' } },
      urlId: 'meticulous-test',
      uploadToken: 'meticulous-local-fixture-upload-token',
    },
  })
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  config.value.settings.general.setup = {
    completed: true,
    completedAt: '2026-01-01T00:00:00.000Z',
  }
  config.value.settings.general.ocr = { enabled: false }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
}
seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

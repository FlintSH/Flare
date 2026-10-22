const assert = require('node:assert/strict')
const { readdirSync } = require('node:fs')
const { PrismaClient } = require('@prisma/client')
const { hash, compare } = require('bcryptjs')

const prisma = new PrismaClient()
const fixturePassword = 'public-fixture-only-file-password'

async function main() {
  const mode = process.argv[2]
  const migrations = await prisma.$queryRaw`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `
  const expected = readdirSync('/app/prisma/migrations', { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(migrations.map(row => row.migration_name).sort(), expected)
  assert.equal(expected.length, 6)
  const incomplete = await prisma.$queryRaw`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `
  assert.equal(incomplete.length, 0)

  const config = await prisma.config.findUniqueOrThrow({where: {key: 'flare_config'}})
  assert.equal(config.value.version, '1.1.0')
  assert.equal(config.value.settings.general.setup.completed, false)
  assert.equal(config.value.settings.general.ocr.enabled, true)

  if (mode === 'seed-upgrade') {
    assert.equal(await prisma.user.count(), 0)
    const user = await prisma.user.create({data: {
      urlId: 'incident-fixture-user', uploadToken: 'public-fixture-only-upload-token',
    }})
    const originalHash = await hash(fixturePassword, 4)
    const common = {userId: user.id, mimeType: 'text/plain', size: 0}
    await prisma.file.create({data: {
      ...common, name: 'plaintext-fixture', urlPath: 'plaintext-fixture',
      path: '/tmp/nonexistent-plaintext-fixture', password: fixturePassword,
    }})
    await prisma.file.create({data: {
      ...common, name: 'hashed-fixture', urlPath: 'hashed-fixture',
      path: '/tmp/nonexistent-hashed-fixture', password: originalHash,
    }})
    await prisma.config.create({data: {
      key: 'incident_fixture_evidence', value: {originalHash},
    }})
    delete config.value.settings.general.ocr
    config.value.version = 'fixture-legacy-version'
    await prisma.config.update({where: {key: config.key}, data: {value: config.value}})
  } else if (mode === 'verify-upgrade') {
    const evidence = await prisma.config.findUniqueOrThrow({where: {key: 'incident_fixture_evidence'}})
    const plaintext = await prisma.file.findUniqueOrThrow({where: {urlPath: 'plaintext-fixture'}})
    const prehashed = await prisma.file.findUniqueOrThrow({where: {urlPath: 'hashed-fixture'}})
    assert.match(plaintext.password, /^\$2[aby]\$/)
    assert.equal(await compare(fixturePassword, plaintext.password), true)
    assert.equal(prehashed.password, evidence.value.originalHash)
    if (evidence.value.migratedHash) {
      assert.equal(plaintext.password, evidence.value.migratedHash)
    } else {
      await prisma.config.update({where: {key: evidence.key}, data: {
        value: {...evidence.value, migratedHash: plaintext.password},
      }})
    }
  } else {
    assert.equal(mode, 'verify-initial')
  }
  console.log(JSON.stringify({fixtureMode: mode, migrations: expected.length, assertions: 'passed'}))
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())

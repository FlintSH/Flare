/* eslint-disable @typescript-eslint/no-require-imports */
// Real-server integration check using the isolated scripts/audit/seed.cjs accounts.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const origin = process.env.FLARE_AUDIT_TEST_ORIGIN || 'http://localhost:3071'
const destination = new URL(origin)
if (destination.hostname !== 'localhost' || destination.protocol !== 'http:')
  throw new Error('Use a disposable localhost HTTP instance.')
const screenshots = process.env.FLARE_AUDIT_SCREENSHOTS

async function request(ctx, route, method = 'GET', data, status = 200) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  })
  assert.equal(response.status(), status, await response.text())
  return response
}
async function json(...args) {
  return (await request(...args)).json()
}
async function login(ctx, user) {
  const csrf = await json(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      headers: { Origin: origin },
      form: {
        csrfToken: csrf.csrfToken,
        email: `audit-demo-${user}@example.test`,
        password: 'Audit-demo-only-2026!',
        json: 'true',
        callbackUrl: origin + '/dashboard',
      },
    }
  )
  assert.ok(!(await response.json()).url.includes('error='))
}
async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    const admin = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      colorScheme: 'dark',
    })
    const member = await browser.newContext()
    const visitor = await browser.newContext()
    await login(admin, 'alex')
    await login(member, 'jamie')
    const upload = await member.request.post(origin + '/api/files', {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: 'handoff-notes.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(
            'Public archive audit demonstration. Contents must stay out of logs.'
          ),
        },
      },
    })
    assert.equal(upload.status(), 200, await upload.text())
    const uploaded = await upload.json()
    const source = uploaded.data || uploaded
    const sourceId = new URL(source.downloadUrl).pathname.split('/')[3]
    const created = (
      await json(member, '/api/files/archive', 'POST', {
        fileIds: [sourceId],
        name: 'Team handoff',
        format: 'zip',
        folderId: null,
      })
    ).data.file
    const manifest = (await json(member, `/api/files/${created.id}/archive`))
      .data
    assert.equal(manifest.fileCount, 1)
    const entry = manifest.entries.find((item) => item.type === 'file')
    const downloaded = await request(
      member,
      `/api/files/${created.id}/archive/entry?path=${encodeURIComponent(entry.path)}`
    )
    assert.match(await downloaded.text(), /Public archive audit demonstration/)
    await json(member, `/api/files/${created.id}/archive/extract`, 'POST', {
      folderId: null,
      name: `Audit handoff ${Date.now()}`,
    })
    await request(
      visitor,
      `/api/files/${created.id}/archive`,
      'GET',
      undefined,
      401
    )
    await request(
      member,
      `/api/files/${sourceId}/archive`,
      'GET',
      undefined,
      415
    )
    const events = (await json(admin, '/api/audit?category=archives&limit=100'))
      .events
    for (const action of [
      'archive.create',
      'archive.browse',
      'archive.entry.read',
      'archive.member.read',
      'archive.extract',
      'archive.member.extract',
      'archive.source.read',
    ]) {
      assert.ok(
        events.some(
          (event) =>
            event.action === action &&
            event.outcome === 'success' &&
            event.actorId === 'audit-demo-jamie'
        ),
        `Missing successful attributed ${action}`
      )
    }
    assert.ok(
      events.some(
        (event) =>
          event.action === 'archive.browse' &&
          event.outcome === 'denied' &&
          event.targetId === created.id
      )
    )
    assert.ok(
      events.some(
        (event) =>
          event.action === 'archive.browse' &&
          event.outcome === 'failure' &&
          event.targetName === 'handoff-notes.txt'
      )
    )
    assert.ok(
      events.some(
        (event) =>
          event.action === 'archive.extract' &&
          event.targetId === created.id &&
          event.targetName === 'Team handoff.zip'
      )
    )
    assert.ok(
      events.some(
        (event) =>
          event.action === 'archive.member.read' &&
          event.details.name === entry.path
      )
    )
    assert.ok(
      !JSON.stringify(events).includes('Contents must stay out of logs')
    )
    const page = await admin.newPage()
    await page.goto(origin + '/dashboard/audit')
    await page.getByLabel('Category', { exact: true }).selectOption('archives')
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: 'Audit events' })
    ).toHaveAttribute('aria-busy', 'false', { timeout: 45000 })
    await expect(
      page.getByRole('region', { name: 'Audit events' })
    ).toContainText('Team handoff.zip')
    await page.evaluate(() => document.fonts.ready)
    if (screenshots) {
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      })
      await mkdir(screenshots, { recursive: true })
      await sharp(await page.screenshot({ animations: 'disabled' }))
        .webp({ quality: 88 })
        .toFile(path.join(screenshots, 'archive-events.webp'))
    }
    console.log(
      'PASS: Real archive create/browse/member download/extract, per-file attribution, denied/failure outcomes, content exclusion, and admin category filter.'
    )
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

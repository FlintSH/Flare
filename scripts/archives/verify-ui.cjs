/* eslint-disable @typescript-eslint/no-require-imports */
// Real application/server walkthrough using scripts/archives/seed.cjs accounts.
const assert = require('node:assert/strict')
const { mkdir, readFile } = require('node:fs/promises')
const path = require('node:path')
const { gzipSync } = require('node:zlib')
const archiver = require('archiver')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const axe = require('../../docs/site/node_modules/axe-core')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_ARCHIVE_TEST_ORIGIN || 'http://localhost:3062'
const destination = new URL(origin)
if (
  destination.hostname !== 'localhost' ||
  destination.protocol !== 'http:' ||
  destination.username ||
  destination.password ||
  destination.pathname !== '/' ||
  destination.search ||
  destination.hash
)
  throw new Error(
    'Use a disposable localhost HTTP origin matching NEXTAUTH_URL.'
  )
const screenshots = process.env.FLARE_ARCHIVE_SCREENSHOTS
const videos = process.env.FLARE_ARCHIVE_VIDEOS
const password = 'Archive-demo-only-2026!'
const results = []

async function api(
  ctx,
  route,
  method = 'GET',
  data,
  expected = 200,
  headers = {}
) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin, ...headers },
  })
  assert.equal(
    response.status(),
    expected,
    `${method} ${route}: ${response.status()} ${response.ok() ? '' : await response.text()}`
  )
  return response.json()
}

async function login(browser, account = 'alex') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(origin + '/auth/login?local=1')
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`archive-demo-${account}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 90000 })
  return ctx
}

async function bundle(format, png) {
  const archive =
    format === 'zip' ? archiver('zip') : archiver('tar', { gzip: true })
  const chunks = []
  const collecting = (async () => {
    for await (const chunk of archive) chunks.push(Buffer.from(chunk))
  })()
  archive.append(
    '# Field kit\n\nA small project handoff, organized for the team.\n\n- Review the launch checklist.\n- Keep original files in Flare.\n- Extract this kit into a project folder.\n',
    { name: 'guide/README.md' }
  )
  archive.append(
    'Task,Owner,Status\nReview copy,Alex,Ready\nCheck images,Jamie,Ready\nPublish handoff,Alex,Pending\n',
    { name: 'guide/checklist.csv' }
  )
  archive.append(png, { name: 'images/flare-icon.png' })
  archive.append('', { name: 'drafts/.keep' })
  archive.append('', { name: 'empty/', type: 'directory' })
  await archive.finalize()
  await collecting
  return Buffer.concat(chunks)
}

async function fixtures(ctx) {
  const png = await sharp(
    await readFile(path.join(__dirname, '../../public/icon.svg'))
  )
    .resize(480, 480)
    .png()
    .toBuffer()
  const zip = await bundle('zip', png)
  const damaged = Buffer.from(zip)
  const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  damaged[central + 16] ^= 0xff
  const uploads = [
    ['Field kit.zip', 'application/zip', zip],
    ['Research bundle.tar.gz', 'application/gzip', await bundle('tar.gz', png)],
    [
      'diagnostics.log.gz',
      'application/gzip',
      gzipSync(
        '2026-10-06 Archive demo started\nAll files are disposable fixtures.\n'
      ),
    ],
    ['Damaged bundle.zip', 'application/zip', damaged],
    [
      'Field notes.txt',
      'text/plain',
      Buffer.from(
        'Launch notes\n\nFinal copy reviewed. Images approved. Ready for the team.\n'
      ),
    ],
    [
      'Launch checklist.csv',
      'text/csv',
      Buffer.from('Task,Status\nCopy,Ready\nImages,Ready\nHandoff,Pending\n'),
    ],
  ]
  for (const [name, mimeType, buffer] of uploads) {
    const response = await ctx.request.post(origin + '/api/files', {
      headers: { Origin: origin, 'X-Upload-Profile': 'none' },
      multipart: {
        file: { name, mimeType, buffer },
        visibility: 'PRIVATE',
        expiration: 'DISABLED',
      },
    })
    assert.equal(
      response.status(),
      200,
      `Upload ${name}: ${await response.text()}`
    )
  }
  const folder = (
    await api(ctx, '/api/folders', 'POST', {
      name: 'Campaigns',
      parentId: null,
    })
  ).data
  const tagResponse = await ctx.request.post(origin + '/api/tags', {
    headers: { Origin: origin },
    data: { name: 'Approved' },
  })
  assert.ok(tagResponse.ok(), await tagResponse.text())
  const tag = (await tagResponse.json()).data
  const profile = (
    await api(
      ctx,
      '/api/upload-profiles',
      'POST',
      {
        name: 'Public handoff',
        options: {
          visibility: 'PUBLIC',
          expiration: 'WEEK',
          expiryAction: 'SET_PRIVATE',
          randomizeFileUrls: true,
          shareStyle: 'delivery',
          tagIds: [tag.id],
        },
      },
      201
    )
  ).data
  const files = (await api(ctx, '/api/files?limit=100')).data
  const reviewedProfile = (
    await api(ctx, '/api/upload-profiles')
  ).data.profiles.find((entry) => entry.id === profile.id)
  return { files, folder, profile: reviewedProfile, tag, png }
}

async function shot(page, name, fullPage = false) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  const bytes = await page.screenshot({ animations: 'disabled', fullPage })
  await sharp(bytes)
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, `${name}.webp`))
  if (videos) await page.waitForTimeout(1200)
}

async function accessibleDialog(page) {
  await page.addScriptTag({ content: axe.source })
  const violations = await page.evaluate(async () =>
    (
      await window.axe.run(document.querySelector('[role="dialog"]'), {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      })
    ).violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target }) => target),
    }))
  )
  assert.deepEqual(violations, [], 'Archive dialog accessibility violations')
}

async function demoContext(
  browser,
  state,
  name,
  mobile = false,
  light = false
) {
  const ctx = await browser.newContext({
    storageState: state,
    colorScheme: light ? 'light' : 'dark',
    reducedMotion: 'reduce',
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    ...(videos && !mobile && name !== 'errors'
      ? { recordVideo: { dir: videos, size: { width: 1440, height: 1000 } } }
      : {}),
  })
  if (light)
    await api(ctx, '/api/customization/preferences', 'PATCH', {
      themeMode: 'light',
    })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard')
  await expect(
    page.getByRole('list', { name: 'Your files', exact: true })
  ).toHaveAttribute('aria-busy', 'false')
  return {
    ctx,
    page,
    async close() {
      const video = page.video()
      assert.deepEqual(errors, [], 'Unexpected browser errors')
      await ctx.close()
      if (video && videos) {
        await video.saveAs(path.join(videos, `${name}.webm`))
        await video.delete()
      }
    },
  }
}

async function findFile(page, name) {
  const menu = page.getByRole('button', { name: `Manage ${name}`, exact: true })
  // Virtual rows outside the current window are not mounted. Search the library
  // before opening a file that is beyond the visible cards, including on mobile.
  if (!(await menu.count()))
    await page
      .getByRole('searchbox', { name: 'Search files by name' })
      .fill(name)
  await expect(menu).toBeVisible()
  return menu
}

async function browse(page, name) {
  await (await findFile(page, name)).click()
  await page
    .getByRole('menuitem', { name: 'Browse archive', exact: true })
    .click()
  await expect(page.getByLabel('Search archive', { exact: true })).toBeVisible()
}

async function browseAndExtract(browser, state, fixture) {
  const demo = await demoContext(browser, state, 'archive-browse-extract')
  const { page, ctx } = demo
  await browse(page, 'Field kit.zip')
  await expect(
    page.getByRole('button', { name: 'Extract all', exact: true })
  ).toBeEnabled()
  await accessibleDialog(page)
  await shot(page, 'browse')
  await page.getByLabel('Search archive', { exact: true }).fill('README')
  await page
    .getByRole('button', { name: 'Preview guide/README.md', exact: true })
    .click()
  await expect(
    page.getByText('A small project handoff, organized for the team.', {
      exact: false,
    })
  ).toBeVisible()
  await shot(page, 'entry-preview')
  await page.getByLabel('Search archive', { exact: true }).fill('flare-icon')
  await page
    .getByRole('button', { name: 'Preview images/flare-icon.png', exact: true })
    .click()
  await expect(page.getByRole('img', { name: /flare-icon/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /flare-icon/ })).toHaveJSProperty(
    'naturalWidth',
    480
  )
  await shot(page, 'image-preview')
  // The preview stays beside the entry list; extraction always uses the whole archive.
  await page.getByLabel('Search archive', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Extract all', exact: true }).click()
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click()
  await page
    .getByLabel('New folder name', { exact: true })
    .fill('Field kit unpacked')
  await shot(page, 'extract')
  await accessibleDialog(page)
  await page.getByRole('button', { name: 'Extract files', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Archive extracted', exact: true })
  ).toBeVisible()
  await shot(page, 'extract-result')
  const folders = (await api(ctx, '/api/folders')).data
  const root = folders.find((folder) => folder.name === 'Field kit unpacked')
  assert.equal(root.parentId, fixture.folder.id)
  const files = (await api(ctx, '/api/files?limit=100')).data
  const extracted = files.filter(
    (file) => !fixture.files.some((source) => source.id === file.id)
  )
  assert.equal(extracted.length, 4)
  assert.ok(extracted.every((file) => file.visibility === 'PRIVATE'))
  assert.ok(
    folders.some(
      (folder) => folder.parentId === root.id && folder.name === 'empty'
    )
  )
  const readme = extracted.find((file) => file.name === 'README.md')
  assert.equal(readme.mimeType, 'text/markdown')
  const content = await ctx.request.get(
    origin + `/api/files/${readme.id}/download`
  )
  assert.ok((await content.text()).includes('A small project handoff'))
  await page.getByRole('link', { name: 'Open folder', exact: true }).click()
  await page.waitForURL((url) => url.searchParams.get('folder') === root.id)
  const guide = page
    .getByRole('region', { name: 'Subfolders', exact: true })
    .getByRole('button', { name: 'Open folder guide', exact: true })
  await expect(guide).toBeVisible()
  await shot(page, 'extracted-folder')
  await guide.click()
  await expect(
    page.getByRole('button', { name: 'Manage README.md', exact: true })
  ).toBeVisible()
  await shot(page, 'extracted-files')
  results.push(
    'ZIP browse/text preview and atomic nested extraction: four private files, empty folder, exact content, original archive retained'
  )
  await demo.close()
}

async function createSelected(browser, state, fixture) {
  const demo = await demoContext(browser, state, 'archive-create')
  const { page, ctx } = demo
  await page.getByRole('button', { name: 'Select files', exact: true }).click()
  await page.getByLabel('Select Field notes.txt', { exact: true }).check()
  await page.getByLabel('Select Launch checklist.csv', { exact: true }).check()
  await page
    .getByRole('button', { name: 'Create archive', exact: true })
    .click()
  await page
    .getByLabel('Archive name', { exact: true })
    .fill('Launch handoff.zip')
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click()
  await shot(page, 'create')
  await page.getByLabel('Upload profile', { exact: true }).click()
  await page
    .getByRole('option', { name: 'Public handoff', exact: true })
    .click()
  await shot(page, 'create-profile')
  await accessibleDialog(page)
  const submission = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/files/archive'
  )
  await page
    .getByRole('button', { name: 'Create archive', exact: true })
    .click()
  const submitted = (await submission).postDataJSON()
  assert.equal(submitted.profileId, fixture.profile.id)
  assert.equal(submitted.profileRevision, fixture.profile.updatedAt)
  assert.equal(
    submitted.profileEffectiveRevision,
    fixture.profile.effectiveRevision
  )
  await expect(
    page.getByRole('heading', { name: 'Archive created', exact: true })
  ).toBeVisible()
  await shot(page, 'create-result')
  const files = (await api(ctx, '/api/files?limit=100')).data
  const created = files.find((file) => file.name === 'Launch handoff.zip')
  assert.ok(created)
  assert.equal(created.folderId, fixture.folder.id)
  assert.equal(created.visibility, 'PUBLIC')
  assert.ok(created.expiresAt)
  assert.ok(created.tags.some((tag) => tag.id === fixture.tag.id))
  const manifest = (await api(ctx, `/api/files/${created.id}/archive`)).data
  assert.deepEqual(manifest.entries.map((entry) => entry.path).sort(), [
    'Field notes.txt',
    'Launch checklist.csv',
  ])
  await page.getByRole('button', { name: 'Open archive', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Preview Field notes.txt', exact: true })
  ).toBeVisible()
  await shot(page, 'created-archive')
  results.push(
    'Selected files become a stored ZIP; explicit upload profile applies public visibility, Approved tag, expiry, and chosen destination'
  )
  await demo.close()
}

async function reviewedProfileChecks(browser, state) {
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  await api(ctx, '/api/profile', 'PUT', {
    defaultFileExpiration: 'DISABLED',
    defaultFileExpirationAction: 'DELETE',
  })
  await api(
    ctx,
    '/api/upload-profiles',
    'POST',
    {
      name: 'Inherited settings',
      options: {},
    },
    201
  )
  const originalIds = (await api(ctx, '/api/files?limit=100')).data
    .map((file) => file.id)
    .sort()
  const page = await ctx.newPage()
  try {
    await page.goto(origin + '/dashboard')
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page.getByLabel('Select Field notes.txt', { exact: true }).check()
    await page
      .getByRole('button', { name: 'Create archive', exact: true })
      .click()
    await page
      .getByLabel('Archive name', { exact: true })
      .fill('Review inherited settings.zip')
    await page.getByLabel('Upload profile', { exact: true }).click()
    await page
      .getByRole('option', { name: 'Inherited settings', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText('no expiry')
    // Emulate a settings update in another tab after this dialog was reviewed.
    await api(ctx, '/api/profile', 'PUT', {
      defaultFileExpiration: 'HOUR',
      defaultFileExpirationAction: 'DELETE',
    })
    const submitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/files/archive' &&
        response.request().method() === 'POST'
    )
    await page
      .getByRole('button', { name: 'Create archive', exact: true })
      .click()
    assert.equal((await submitted).status(), 409)
    await expect(page.getByRole('alert')).toContainText(/changed|review/i)
    await expect(page.getByRole('dialog')).toContainText('then deleted')
    assert.deepEqual(
      (await api(ctx, '/api/files?limit=100')).data
        .map((file) => file.id)
        .sort(),
      originalIds
    )
    results.push(
      'Reviewed upload-profile snapshot rejects inherited account expiration changes with409, refreshes the visible deletion policy, and creates no output'
    )
  } finally {
    await api(ctx, '/api/profile', 'PUT', {
      defaultFileExpiration: 'DISABLED',
      defaultFileExpirationAction: 'DELETE',
    })
    await ctx.close()
  }
}

async function additionalChecks(browser, state, fixture) {
  const ctx = await browser.newContext({ storageState: state })
  const zip = fixture.files.find((file) => file.name === 'Field kit.zip')
  const tgz = fixture.files.find(
    (file) => file.name === 'Research bundle.tar.gz'
  )
  const gzip = fixture.files.find((file) => file.name === 'diagnostics.log.gz')
  for (const [source, count] of [
    [tgz, 4],
    [gzip, 1],
  ]) {
    const manifest = (await api(ctx, `/api/files/${source.id}/archive`)).data
    assert.equal(manifest.fileCount, count)
  }
  const profiled = (
    await api(ctx, `/api/files/${tgz.id}/archive/extract`, 'POST', {
      folderId: fixture.folder.id,
      name: 'Profile extraction',
      profileId: fixture.profile.id,
    })
  ).data
  assert.equal(profiled.fileCount, 4)
  const folders = (await api(ctx, '/api/folders')).data
  const profiledFolderIds = new Set([profiled.folderId])
  for (let pass = 0; pass < 20; pass++)
    for (const folder of folders)
      if (profiledFolderIds.has(folder.parentId))
        profiledFolderIds.add(folder.id)
  const saved = (await api(ctx, '/api/files?limit=100')).data.filter((file) =>
    profiledFolderIds.has(file.folderId)
  )
  assert.equal(saved.length, 4)
  assert.ok(
    saved.every(
      (file) =>
        file.visibility === 'PUBLIC' &&
        file.expiresAt &&
        file.tags.some((tag) => tag.id === fixture.tag.id)
    )
  )
  const notes = fixture.files.find((file) => file.name === 'Field notes.txt')
  const packed = (
    await api(ctx, '/api/files/archive', 'POST', {
      fileIds: [notes.id],
      name: 'Private notes',
      format: 'tar.gz',
      folderId: null,
    })
  ).data.file
  assert.equal(packed.name, 'Private notes.tar.gz')
  assert.equal(
    (await api(ctx, `/api/files/${packed.id}/archive`)).data.fileCount,
    1
  )
  const packedFile = (await api(ctx, '/api/files?limit=100')).data.find(
    (file) => file.id === packed.id
  )
  assert.equal(packedFile.visibility, 'PRIVATE')
  assert.equal(packedFile.expiresAt, null)
  await api(
    ctx,
    '/api/files/archive',
    'POST',
    {
      fileIds: [notes.id],
      name: 'Stale profile rejected',
      format: 'zip',
      folderId: null,
      profileId: fixture.profile.id,
      profileRevision: '2000-01-01T00:00:00.000Z',
    },
    409
  )
  const member = await ctx.request.get(
    origin +
      `/api/files/${zip.id}/archive/entry?path=${encodeURIComponent('images/flare-icon.png')}`
  )
  assert.equal(member.status(), 200)
  assert.equal(member.headers()['x-content-type-options'], 'nosniff')
  assert.deepEqual(await member.body(), fixture.png)
  await api(
    ctx,
    `/api/files/${zip.id}/archive/extract`,
    'POST',
    { folderId: fixture.folder.id, name: 'Field kit unpacked' },
    409
  )
  await api(
    ctx,
    `/api/files/${zip.id}/archive/extract`,
    'POST',
    { folderId: fixture.folder.id, name: 'Rejected origin' },
    403,
    { Origin: 'https://untrusted.example' }
  )
  const foreign = await login(browser, 'jamie')
  await api(foreign, `/api/files/${zip.id}/archive`, 'GET', undefined, 404)
  const anonymous = await browser.newContext()
  await api(anonymous, `/api/files/${zip.id}/archive`, 'GET', undefined, 401)
  await anonymous.close()
  await foreign.close()
  await ctx.close()
  results.push(
    'TAR.GZ and GZIP manifests; profile settings applied to every extracted file; private TAR.GZ creation; exact raster download; duplicate destination rollback; origin/ownership/session boundaries'
  )

  const mobile = await demoContext(browser, state, 'mobile', true)
  await browse(mobile.page, 'Field kit.zip')
  await expect(
    mobile.page.getByRole('button', { name: 'Extract all', exact: true })
  ).toBeEnabled()
  await shot(mobile.page, 'mobile-browse')
  await accessibleDialog(mobile.page)
  assert.equal(
    await mobile.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  )
  await mobile.page
    .getByRole('button', { name: 'Extract all', exact: true })
    .click()
  await shot(mobile.page, 'mobile-extract')
  await accessibleDialog(mobile.page)
  await mobile.close()

  const errorDemo = await demoContext(browser, state, 'errors', false, true)
  await (await findFile(errorDemo.page, 'Damaged bundle.zip')).click()
  await errorDemo.page
    .getByRole('menuitem', { name: 'Browse archive', exact: true })
    .click()
  await expect(errorDemo.page.getByRole('alert')).toBeVisible()
  await shot(errorDemo.page, 'invalid-archive')
  await errorDemo.close()
  results.push(
    'Mobile browsing/extraction layout and genuine damaged-archive error in light theme'
  )
}

async function sharedArchiveChecks(browser, state, fixture) {
  const owner = await browser.newContext({ storageState: state })
  const originalFileIds = (await api(owner, '/api/files?limit=100')).data
    .map((file) => file.id)
    .sort()
  const zip = fixture.files.find((file) => file.name === 'Field kit.zip')
  const sharedPath = `/api/files/${zip.id}/archive/share`
  const shareUrl = origin + zip.urlPath
  await api(owner, `/api/files/${zip.id}`, 'PATCH', { visibility: 'PUBLIC' })
  const anonymous = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    ...(videos
      ? { recordVideo: { dir: videos, size: { width: 1440, height: 1000 } } }
      : {}),
  })
  const page = await anonymous.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(shareUrl)
  await expect(page.getByLabel('Search archive', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Extract all', exact: true })
  ).toHaveCount(0)
  await shot(page, 'share-browse')
  await page
    .getByRole('button', { name: 'Open folder guide', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Preview guide/README.md', exact: true })
    .click()
  await expect(page.getByLabel('Entry text', { exact: true })).toContainText(
    'A small project handoff'
  )
  await shot(page, 'share-entry')
  const downloadReady = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download entry', exact: true })
    .click()
  const download = await downloadReady
  assert.equal(download.suggestedFilename(), 'README.md')
  assert.ok(
    (await readFile(await download.path(), 'utf8')).includes(
      'A small project handoff'
    )
  )
  await page.getByLabel('Search archive', { exact: true }).fill('flare-icon')
  await page
    .getByRole('button', { name: 'Preview images/flare-icon.png', exact: true })
    .click()
  await expect(page.getByRole('img', { name: /flare-icon/ })).toHaveJSProperty(
    'naturalWidth',
    480
  )
  await shot(page, 'share-image')
  await page.addScriptTag({ content: axe.source })
  assert.deepEqual(
    await page.evaluate(async () =>
      (
        await window.axe.run({
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        })
      ).violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target),
      }))
    ),
    [],
    'Shared archive accessibility violations'
  )
  assert.deepEqual(pageErrors, [])
  const video = page.video()
  await anonymous.close()
  if (video && videos) {
    await video.saveAs(path.join(videos, 'archive-share-browse.webm'))
    await video.delete()
  }

  const publicClient = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  assert.equal(
    (await api(publicClient, sharedPath, 'POST', {})).data.fileCount,
    4
  )
  const binary = await publicClient.request.post(
    origin + sharedPath + '/entry',
    {
      headers: { Origin: origin },
      data: { path: 'images/flare-icon.png' },
    }
  )
  assert.equal(binary.status(), 200)
  assert.deepEqual(await binary.body(), fixture.png)
  assert.equal(binary.headers()['cache-control'], 'private, no-store')
  assert.equal(binary.headers()['x-content-type-options'], 'nosniff')
  await api(publicClient, sharedPath, 'POST', {}, 403, {
    Origin: 'https://untrusted.example',
  })
  await api(publicClient, sharedPath, 'POST', {}, 401, {
    Authorization: 'Bearer disposable-test-token',
  })
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  const mobilePage = await mobile.newPage()
  await mobilePage.goto(shareUrl)
  await expect(
    mobilePage.getByLabel('Search archive', { exact: true })
  ).toBeVisible()
  await mobilePage.getByLabel('Search archive', { exact: true }).fill('README')
  await mobilePage
    .getByRole('button', { name: 'Preview guide/README.md', exact: true })
    .click()
  await expect(
    mobilePage.getByLabel('Entry text', { exact: true })
  ).toContainText('A small project handoff')
  assert.equal(
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  )
  await shot(mobilePage, 'share-mobile', true)
  await mobile.close()

  // This public fixture password is never recorded in the walkthrough. The
  // existing share-page form unlocks the page; new archive requests use bodies.
  const fixturePassword = 'Public-archive-demo-password'
  await api(owner, `/api/files/${zip.id}`, 'PATCH', {
    password: fixturePassword,
  })
  await api(publicClient, sharedPath, 'POST', {}, 401)
  await api(publicClient, sharedPath, 'POST', { password: 'incorrect' }, 401)
  await api(
    publicClient,
    sharedPath + '/entry',
    'POST',
    { path: 'guide/README.md' },
    401
  )
  const protectedPage = await publicClient.newPage()
  await protectedPage.goto(shareUrl)
  await expect(
    protectedPage.getByLabel('File password', { exact: true })
  ).toBeVisible()
  await expect(
    protectedPage.getByLabel('Search archive', { exact: true })
  ).toHaveCount(0)
  await expect(
    protectedPage.getByText('Field kit.zip', { exact: true })
  ).toHaveCount(0)
  await shot(protectedPage, 'share-password')
  await protectedPage
    .getByLabel('File password', { exact: true })
    .fill(fixturePassword)
  const archiveRequest = protectedPage.waitForRequest(
    (request) => new URL(request.url()).pathname === sharedPath
  )
  await protectedPage
    .getByRole('button', { name: 'Access File', exact: true })
    .click()
  await expect(
    protectedPage.getByLabel('Search archive', { exact: true })
  ).toBeVisible()
  const unlockRequest = await archiveRequest
  assert.equal(unlockRequest.method(), 'POST')
  assert.equal(new URL(unlockRequest.url()).search, '')
  assert.equal(unlockRequest.postDataJSON().password, fixturePassword)
  await protectedPage
    .getByLabel('Search archive', { exact: true })
    .fill('README')
  await protectedPage
    .getByRole('button', { name: 'Preview guide/README.md', exact: true })
    .click()
  await expect(
    protectedPage.getByLabel('Entry text', { exact: true })
  ).toContainText('A small project handoff')
  await shot(protectedPage, 'share-unlocked')
  const protectedDownloadReady = protectedPage.waitForEvent('download')
  await protectedPage
    .getByRole('button', { name: 'Download entry', exact: true })
    .click()
  const protectedDownload = await protectedDownloadReady
  assert.equal(protectedDownload.suggestedFilename(), 'README.md')
  assert.ok(
    (await readFile(await protectedDownload.path(), 'utf8')).includes(
      'A small project handoff'
    )
  )
  await api(owner, `/api/files/${zip.id}`, 'PATCH', { visibility: 'PRIVATE' })
  await api(
    publicClient,
    sharedPath,
    'POST',
    { password: fixturePassword },
    404
  )
  await api(
    publicClient,
    sharedPath + '/entry',
    'POST',
    { path: 'guide/README.md', password: fixturePassword },
    404
  )
  const ownerPage = await owner.newPage()
  await ownerPage.goto(shareUrl)
  await expect(
    ownerPage.getByLabel('Search archive', { exact: true })
  ).toBeVisible()
  await expect(
    ownerPage.getByRole('button', { name: 'Extract all', exact: true })
  ).toHaveCount(0)
  const foreign = await login(browser, 'jamie')
  await api(foreign, sharedPath, 'POST', { password: fixturePassword }, 404)
  await foreign.close()
  await publicClient.close()
  assert.deepEqual(
    (await api(owner, '/api/files?limit=100')).data
      .map((file) => file.id)
      .sort(),
    originalFileIds,
    'Browsing and downloading shared archives must not create library files'
  )
  await owner.close()
  results.push(
    'Shared archive inline browse, text/image previews, exact public/protected downloads, mobile layout, password-body transport, no extraction controls, and live visibility/origin/bearer boundaries'
  )
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    slowMo: videos ? 110 : 0,
  })
  try {
    const authenticated = await login(browser)
    const fixture = await fixtures(authenticated)
    const state = await authenticated.storageState()
    await authenticated.close()
    if (process.env.FLARE_ARCHIVE_SHARE_ONLY !== 'true') {
      await browseAndExtract(browser, state, fixture)
      await createSelected(browser, state, fixture)
      await reviewedProfileChecks(browser, state)
      await additionalChecks(browser, state, fixture)
    }
    await sharedArchiveChecks(browser, state, fixture)
    console.log(JSON.stringify({ passed: results }, null, 2))
  } catch (error) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    if (pages.length)
      await pages
        .at(-1)
        .screenshot({ path: '/tmp/flare-archives-browser-failure.png' })
        .catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

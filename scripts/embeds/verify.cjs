/* eslint-disable @typescript-eslint/no-require-imports */
// Asks a running instance for share links the way link-preview fetchers do
// and checks every answer. It creates accounts and files and edits the saved
// appearance, so use only a disposable local instance and database.
const assert = require('node:assert/strict')
const { PrismaClient } = require('@prisma/client')
const { hash } = require('bcryptjs')

const origin = process.env.FLARE_EMBEDS_TEST_ORIGIN || 'http://localhost:3070'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('Use a disposable local instance.')
const database = new URL(process.env.DATABASE_URL)
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_embeds_demo'
)
  throw new Error(
    'Embed checks require a local PostgreSQL database named exactly flare_embeds_demo.'
  )

const prisma = new PrismaClient()
const password = 'Embeds-demo-only-2026!'
const filePassword = 'correct horse battery'
const token = 'embeds-demo-mira-public-disposable-upload-token'

const DISCORD =
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const X = 'Twitterbot/1.0'
const WHATSAPP = 'WhatsApp/2.23.20.0 A'
const BROWSER =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const UNKNOWN = 'SomeChatApp-LinkPreview/1.0'

// The smallest files the upload checks accept as these types.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2'),
  Buffer.alloc(64),
])
const ZIP = Buffer.concat([
  Buffer.from('PK\x05\x06', 'latin1'),
  Buffer.alloc(18),
])

// The instance's name, which the default card shows as its site name.
let instance = 'Flare'

const results = []
async function check(name, run) {
  await run()
  results.push(name)
}

async function upload(name, type, bytes, fields = {}) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  const response = await fetch(`${origin}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${name}: ${JSON.stringify(body)}`)
  return new URL(body.data.url).pathname
}

function ask(path, agent) {
  return fetch(origin + path, {
    redirect: 'manual',
    headers: { 'User-Agent': agent },
  })
}

async function page(path, agent) {
  const response = await ask(path, agent)
  assert.equal(response.status, 200, `${path} as ${agent}`)
  return response.text()
}

const tag = (html, name) =>
  new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(
    html
  )?.[1]

async function sharing(change) {
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  const { published } = config.value.settings.customization
  published.sharing = { ...published.sharing, ...change }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
}

const INSTANCE_EMBED = {
  embedMode: 'direct',
  personalEmbeds: true,
  siteNameTemplate: '{{instanceName}}',
  authorTemplate: '',
  titleTemplate: '{{filename}} ({{size}})',
  descriptionTemplate: 'Uploaded by {{uploader}}',
  embedColor: '',
}

async function seed() {
  await fetch(`${origin}/auth/login`)
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
  instance = config.value.settings.customization.published.brand.name
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await sharing(INSTANCE_EMBED)
  await prisma.user.deleteMany({
    where: { id: { in: ['embeds-demo-alex', 'embeds-demo-mira'] } },
  })
  for (const [id, name, role, urlId] of [
    ['embeds-demo-alex', 'Alex Morgan', 'administrator', 'alex1'],
    ['embeds-demo-mira', 'Mira Chen', 'everyone', 'mira1'],
  ])
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        password: await hash(password, 10),
        roles: { connect: { systemKey: role } },
        urlId,
        uploadToken: `${id}-public-disposable-upload-token`,
      },
    })
  return {
    image: await upload('photo.png', 'image/png', PNG),
    video: await upload('clip.mp4', 'video/mp4', MP4),
    archive: await upload('backup.zip', 'application/zip', ZIP),
    locked: await upload('locked.png', 'image/png', PNG, {
      password: filePassword,
    }),
    hidden: await upload('hidden.png', 'image/png', PNG, {
      visibility: 'PRIVATE',
    }),
  }
}

async function main() {
  const files = await seed()

  await check(
    'an app that shows images on their own is sent to the image',
    async () => {
      const response = await ask(files.image, DISCORD)
      assert.equal(response.status, 307)
      assert.equal(response.headers.get('location'), `${files.image}/raw`)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.match(response.headers.get('vary'), /User-Agent/)
      const image = await fetch(origin + files.image, {
        headers: { 'User-Agent': DISCORD },
      })
      assert.equal(image.headers.get('content-type'), 'image/png')
      assert.equal((await image.arrayBuffer()).byteLength, PNG.length)
    }
  )

  await check(
    'an app that only draws cards gets the image in a card',
    async () => {
      const html = await page(files.image, X)
      assert.equal(tag(html, 'twitter:card'), 'summary_large_image')
      assert.equal(tag(html, 'og:image'), `${origin}${files.image}/raw`)
      assert.equal(tag(html, 'og:url'), origin + files.image)
      assert.equal(tag(html, 'og:site_name'), instance)
      assert.match(tag(html, 'og:title'), /^photo\.png \(/)
      assert.equal(tag(html, 'og:description'), 'Uploaded by Mira Chen')
      assert.ok(html.length < 2500, 'the preview page stays small')
    }
  )

  await check(
    'a video is its player and title, from an address that lasts',
    async () => {
      const html = await page(files.video, DISCORD)
      assert.equal(tag(html, 'og:type'), 'video.other')
      assert.equal(tag(html, 'og:video'), `${origin}${files.video}/raw`)
      assert.equal(tag(html, 'og:video:type'), 'video/mp4')
      assert.equal(tag(html, 'og:image'), `${origin}/video-poster.png`)
      assert.equal(tag(html, 'og:site_name'), undefined)
      assert.equal(tag(html, 'og:description'), undefined)
      const poster = await ask('/video-poster.png', DISCORD)
      assert.equal(poster.status, 200)
      assert.equal(poster.headers.get('content-type'), 'image/png')
      const media = await ask(`${files.video}/media`, DISCORD)
      assert.equal(media.status, 302)
      assert.equal(media.headers.get('location'), `${files.video}/raw`)
      assert.equal(media.headers.get('cache-control'), 'private, no-store')
    }
  )

  await check(
    'a file with nothing to show gets the card, not its bytes',
    async () => {
      const html = await page(files.archive, DISCORD)
      assert.equal(tag(html, 'twitter:card'), 'summary')
      assert.match(tag(html, 'og:title'), /^backup\.zip \(/)
      assert.equal(tag(html, 'og:image'), undefined)
    }
  )

  await check(
    'a file behind a password says only that it is protected',
    async () => {
      const html = await page(files.locked, DISCORD)
      assert.equal(tag(html, 'og:title'), `Protected file - ${instance}`)
      assert.equal(tag(html, 'robots'), 'noindex, nofollow')
      assert.doesNotMatch(html, /locked\.png\/raw|Mira/)
      const query = new URLSearchParams({ password: filePassword })
      const unlocked = await ask(`${files.locked}?${query}`, DISCORD)
      assert.equal(unlocked.status, 307)
      assert.equal(
        unlocked.headers.get('location'),
        `${files.locked}/raw?${query}`
      )
    }
  )

  await check('a private or missing file answers with nothing', async () => {
    for (const path of [files.hidden, '/mira1/nothing-here.png']) {
      const response = await ask(path, DISCORD)
      assert.equal(response.status, 404, path)
      assert.equal(await response.text(), '')
    }
    assert.equal((await ask(`${files.hidden}/media`, DISCORD)).status, 404)
  })

  await check(
    'browsers and unknown fetchers get the share page, tags in its head',
    async () => {
      for (const agent of [BROWSER, UNKNOWN]) {
        const html = await page(files.image, agent)
        const head = html.slice(0, html.indexOf('</head>'))
        assert.match(html, /<body/)
        assert.match(head, /property="og:image"/, agent)
        assert.match(head, /name="twitter:card" content="summary_large_image"/)
        assert.equal(tag(head, 'og:site_name'), instance)
      }
    }
  )

  await check('a rich embed puts every file in the card', async () => {
    await sharing({
      embedMode: 'rich',
      authorTemplate: '{{uploader}}',
      descriptionTemplate: '{{type}} · {{size}} · {{views}} views',
      embedColor: '#5b8def',
    })
    const response = await ask(files.image, DISCORD)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.equal(tag(html, 'theme-color'), '#5b8def')
    assert.equal(tag(html, 'og:image'), `${origin}${files.image}/raw`)
    assert.match(tag(html, 'og:description'), /^PNG · .+ · \d+ views$/)
    const oembed = /type="application\/json\+oembed" href="([^"]+)"/.exec(
      html
    )?.[1]
    assert.ok(oembed, 'the card links to its oEmbed answer')
    const answer = await fetch(oembed.replace(/&amp;/g, '&'))
    assert.equal(answer.status, 200)
    assert.deepEqual(Object.assign(await answer.json(), { title: 'checked' }), {
      version: '1.0',
      type: 'link',
      title: 'checked',
      author_name: 'Mira Chen',
      provider_name: instance,
      provider_url: origin,
    })
    const video = await page(files.video, DISCORD)
    assert.equal(tag(video, 'og:site_name'), instance)
    assert.equal(tag(video, 'og:video'), `${origin}${files.video}/raw`)
  })

  await check('oEmbed answers only for files anyone may open', async () => {
    for (const path of [files.locked, files.hidden, '/mira1/nothing.png']) {
      const response = await fetch(
        `${origin}/api/oembed?${new URLSearchParams({ url: origin + path })}`
      )
      assert.equal(response.status, 404, path)
    }
  })

  await check("an account's own embed applies to its links", async () => {
    await sharing(INSTANCE_EMBED)
    await prisma.user.update({
      where: { id: 'embeds-demo-mira' },
      data: {
        preferences: {
          embed: {
            mode: 'rich',
            design: 'custom',
            siteName: 'mira.example',
            author: '',
            title: '{{filename}}',
            description: '',
            color: '#ff0066',
          },
        },
      },
    })
    const html = await page(files.image, DISCORD)
    assert.equal(tag(html, 'og:site_name'), 'mira.example')
    assert.equal(tag(html, 'og:title'), 'photo.png')
    assert.equal(tag(html, 'og:description'), undefined)
    assert.equal(tag(html, 'theme-color'), '#ff0066')
    // WhatsApp shows nothing without a description, so it gets the tagline.
    assert.ok(tag(await page(files.image, WHATSAPP), 'og:description'))
  })

  await check(
    'turning personal embeds off returns every link to the instance',
    async () => {
      await sharing({ personalEmbeds: false })
      assert.equal((await ask(files.image, DISCORD)).status, 307)
      await sharing({ personalEmbeds: true })
      assert.equal((await ask(files.image, DISCORD)).status, 200)
    }
  )

  await check(
    'details the instance hides stay out of every embed',
    async () => {
      await sharing({
        showFilename: false,
        showSize: false,
        showUploader: false,
      })
      await prisma.user.update({
        where: { id: 'embeds-demo-mira' },
        data: { preferences: {} },
      })
      const html = await page(files.image, X)
      assert.equal(tag(html, 'og:title'), 'Shared file')
      assert.equal(tag(html, 'og:description'), undefined)
      assert.doesNotMatch(
        html.replace(/\/mira1\/photo\.png/g, ''),
        /photo|Mira/
      )
      await sharing({ showFilename: true, showSize: true, showUploader: true })
    }
  )

  console.log(results.map((name) => `ok  ${name}`).join('\n'))
  console.log(`\n${results.length} embed checks passed against ${origin}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

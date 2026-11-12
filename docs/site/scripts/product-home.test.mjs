import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { productPresentation, withProductHome } from './product-home.mjs'
import { landingImages } from './landing-assets.mjs'

for (const fail of [false, true]) {
  test(`product root overlay restores archived content and images after ${fail ? 'failure' : 'success'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'flare-product-home-'))
    const site = join(root, 'site')
    const target = join(root, 'archive')
    const write = async (file, value) => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, value)
    }
    try {
      for (const file of productPresentation)
        await write(join(site, file), `current ${file}`)
      await write(join(target, 'index.md'), 'Original archived homepage')
      await write(
        join(target, '.vitepress/theme/components/Home.vue'),
        'Original archived component'
      )
      await write(
        join(target, 'public/landing/library-desktop.webp'),
        'Original archived screenshot bytes'
      )
      for (const [source] of landingImages) {
        await mkdir(dirname(join(root, source)), { recursive: true })
        await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#010610' },
        })
          .png()
          .toFile(join(root, source))
      }
      const operation = withProductHome(
        { site, target, repo: root },
        async () => {
          assert.equal(
            await readFile(join(target, 'index.md'), 'utf8'),
            'current index.md'
          )
          assert.equal(
            (
              await sharp(
                join(target, 'public/landing/library-desktop.webp')
              ).metadata()
            ).width,
            2
          )
          if (fail) throw new Error('Build failed')
          return 'built'
        }
      )
      if (fail) await assert.rejects(operation, /Build failed/)
      else assert.equal(await operation, 'built')
      assert.equal(
        await readFile(join(target, 'index.md'), 'utf8'),
        'Original archived homepage'
      )
      assert.equal(
        await readFile(
          join(target, '.vitepress/theme/components/Home.vue'),
          'utf8'
        ),
        'Original archived component'
      )
      assert.equal(
        await readFile(
          join(target, 'public/landing/library-desktop.webp'),
          'utf8'
        ),
        'Original archived screenshot bytes'
      )
      for (const file of [
        ...productPresentation.filter(
          (file) =>
            !['index.md', '.vitepress/theme/components/Home.vue'].includes(file)
        ),
        'public/landing/library-mobile.webp',
      ])
        await assert.rejects(readFile(join(target, file)), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

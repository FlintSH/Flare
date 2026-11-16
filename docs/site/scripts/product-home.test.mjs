import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { productPresentation, withProductHome } from './product-home.mjs'
import { landingAssets } from './landing-assets.mjs'

for (const fail of [false, true]) {
  test(`product root overlay restores archived content and recordings after ${fail ? 'failure' : 'success'}`, async () => {
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
        join(target, 'public/landing/desktop-dark.mp4'),
        'Original archived recording bytes'
      )
      for (const name of landingAssets)
        await write(
          join(root, '.github/assets/landing', name),
          `current ${name}`
        )
      const operation = withProductHome(
        { site, target, repo: root },
        async () => {
          assert.equal(
            await readFile(join(target, 'index.md'), 'utf8'),
            'current index.md'
          )
          for (const name of landingAssets)
            assert.equal(
              await readFile(join(target, 'public/landing', name), 'utf8'),
              `current ${name}`
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
        await readFile(join(target, 'public/landing/desktop-dark.mp4'), 'utf8'),
        'Original archived recording bytes'
      )
      for (const file of [
        ...productPresentation.filter(
          (file) =>
            !['index.md', '.vitepress/theme/components/Home.vue'].includes(file)
        ),
        'public/landing/mobile-light.mp4',
      ])
        await assert.rejects(readFile(join(target, file)), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

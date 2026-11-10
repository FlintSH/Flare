import { GET } from '@/app/api/ocr/[version]/[asset]/route'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  OCR_ASSETS,
  OCR_ASSET_VERSION,
  OCR_WORKER_POLICY,
  ocrAssetBase,
} from '@/lib/ocr/assets'

const require = createRequire(import.meta.url)

const get = (version: string, asset: string) =>
  GET(new Request(`http://localhost/api/ocr/${version}/${asset}`), {
    params: Promise.resolve({ version, asset }),
  })

describe('the files of text recognition in the browser', () => {
  it('names the installed versions, so an upgrade changes the address', () => {
    const tesseract = require('tesseract.js/package.json') as {
      version: string
      dependencies: Record<string, string>
    }
    const core = require(
      require.resolve('tesseract.js-core/package.json', {
        paths: [require.resolve('tesseract.js/package.json')],
      })
    ) as { version: string }
    expect(OCR_ASSET_VERSION).toBe(
      `tesseract-${tesseract.version}-core-${core.version}-eng-4.0.0`
    )
    expect(ocrAssetBase('https://flare.example')).toBe(
      `https://flare.example/api/ocr/${OCR_ASSET_VERSION}`
    )
  })

  it('serves each file from this origin with a policy that keeps the worker here', async () => {
    for (const [name, asset] of Object.entries(OCR_ASSETS)) {
      const response = await get(OCR_ASSET_VERSION, name)
      expect(response.status, name).toBe(200)
      expect(response.headers.get('content-type')).toBe(asset.type)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control')).toContain('immutable')
      expect(response.headers.get('content-security-policy')).toBe(
        OCR_WORKER_POLICY
      )
      expect(response.headers.has('content-encoding')).toBe(false)
      const body = Buffer.from(await response.arrayBuffer())
      expect(body.length).toBeGreaterThan(1000)
      // The language data is the gzip file itself, which the worker unpacks.
      if (name.endsWith('.gz'))
        expect(gunzipSync(body).length).toBeGreaterThan(body.length)
    }
    // No other origin: no scheme, no wildcard, no `unsafe-eval` of text.
    expect(OCR_WORKER_POLICY).not.toMatch(
      /https?:|\*|'unsafe-eval'|blob:|data:/
    )
    expect(OCR_WORKER_POLICY).toContain("'wasm-unsafe-eval'")
  })

  it('answers nothing for another version or another file', async () => {
    expect((await get('tesseract-0.0.0', 'worker.min.js')).status).toBe(404)
    for (const name of [
      'package.json',
      '..%2Fpackage.json',
      'eng.traineddata',
      'tesseract-core.wasm',
    ])
      expect((await get(OCR_ASSET_VERSION, name)).status, name).toBe(404)
  })
})

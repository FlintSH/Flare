import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { readOcrAsset } from '@/lib/ocr/asset-files'
import {
  OCR_ASSETS,
  OCR_ASSET_VERSION,
  OCR_WORKER_POLICY,
  isOcrAsset,
} from '@/lib/ocr/assets'

type Context = { params: Promise<{ version: string; asset: string }> }

const api = routes('/api/ocr/[version]/[asset]', {
  failure: { message: 'Text recognition is not available on this server.' },
  logger: loggers.ocr,
})

/**
 * The program and the language data of text recognition, from Flare's own
 * origin (docs/e2ee-spec.md, section 9.6.2). The browser of an owner or of a
 * visitor reads an encrypted image with them, so the image and its text
 * never leave that browser. The files are public and the same for everyone.
 */
export const GET = api(async (_request, { params }: Context) => {
  const { version, asset } = await params
  if (version !== OCR_ASSET_VERSION || !isOcrAsset(asset))
    throw new HttpError(404, 'Not found')
  const body = await readOcrAsset(asset)
  return new Response(Uint8Array.from(body), {
    headers: {
      'Content-Type': OCR_ASSETS[asset].type,
      'Content-Length': String(body.length),
      // The version is in the address.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      // The policy of the worker that this script starts.
      'Content-Security-Policy': OCR_WORKER_POLICY,
    },
  })
})

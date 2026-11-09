import type { Prisma } from '@prisma/client'
import type { Readable } from 'node:stream'
import { fromBufferPromise } from 'yauzl'

import { archiveSourceRef, sourceStorage } from '@/lib/archives/browse'
import { getArchiveIndex } from '@/lib/archives/index-cache'
import { detectArchiveFormat } from '@/lib/archives/shared'
import { readUpTo } from '@/lib/archives/stream-slice'
import { getConfig } from '@/lib/config'
import { fileKind, isTextKind } from '@/lib/files/file-kind'
import { ocrQueue } from '@/lib/ocr'
import { mbToBytes } from '@/lib/utils'

import type { ContentSource } from './contract'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_XML_MAX_BYTES,
  MAX_INDEXED_CHARACTERS,
  MAX_INDEXED_ENTRIES,
  OCR_MAX_BYTES,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  TEXT_READ_BYTES,
} from './limits'
import { recognizedText } from './text'

export interface ExtractableFile {
  id: string
  name: string
  mimeType: string
  /** Megabytes, as files record it. */
  size: number
  path: string
  isPaste: boolean
  storageTarget: Prisma.JsonValue
  ocrText: string | null
}

export type Extraction =
  | {
      status: 'INDEXED'
      source: ContentSource
      content: string | null
      entries: string[] | null
    }
  /** Read without trouble, but there was no text. */
  | { status: 'EMPTY'; source: ContentSource; reason: string }
  /** Flare could read it, but a setting or limit says not to. */
  | { status: 'SKIPPED'; source: ContentSource; reason: string }
  /** No extractor for this kind of file. */
  | { status: 'UNSUPPORTED'; reason: string | null }

/**
 * Reading failed. The message is shown to the owner, so it never carries a
 * storage path, provider error or parser detail.
 */
export class ExtractionFailure extends Error {
  constructor(
    message: string,
    /** Whether trying again later could help. */
    readonly retry = true
  ) {
    super(message)
    this.name = 'ExtractionFailure'
  }
}

// Images tesseract reads. Others (HEIC, AVIF, SVG...) would only fail.
const OCR_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff',
  'image/x-portable-bitmap',
])

const OFFICE_TYPES: Record<string, 'docx' | 'pptx' | 'xlsx' | 'odf'> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odf',
  'application/vnd.oasis.opendocument.spreadsheet': 'odf',
  'application/vnd.oasis.opendocument.presentation': 'odf',
}
const OFFICE_EXTENSIONS: Record<string, 'docx' | 'pptx' | 'xlsx' | 'odf'> = {
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  odt: 'odf',
  ods: 'odf',
  odp: 'odf',
}

// Text formats that aren't stored under text/*.
const TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'application/sql',
  'application/x-sh',
  'application/toml',
  'application/x-subrip',
  'application/x-ndjson',
  'image/svg+xml',
])

function extension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** What extracts a file, decided from its stored type and name only. */
export function extractorFor(
  file: Pick<ExtractableFile, 'name' | 'mimeType' | 'isPaste'>
) {
  const mime = file.mimeType.toLowerCase()
  if (mime === 'image/svg+xml') return 'markup' as const
  if (mime.startsWith('image/'))
    return OCR_TYPES.has(mime) ? ('ocr' as const) : null
  if (mime === 'application/pdf') return 'pdf' as const
  const office = OFFICE_TYPES[mime] ?? OFFICE_EXTENSIONS[extension(file.name)]
  if (office) return office
  if (detectArchiveFormat(file.name, mime)) return 'archive' as const
  if (/html/.test(mime)) return 'markup' as const
  if (
    file.isPaste ||
    TEXT_TYPES.has(mime) ||
    isTextKind(fileKind({ name: file.name, mimeType: mime }).kind)
  )
    return 'text' as const
  return null
}

/** Collapse whitespace, drop control characters, keep the first part. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_INDEXED_CHARACTERS)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1].toLowerCase() === 'x'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    }
  )
}

// Paragraphs, cells, rows, breaks and tabs separate words; runs don't.
const SEPARATING_TAGS = new Set(
  'w:p w:tab w:br w:cr a:p a:br text:p text:h text:tab text:line-break text:s si c row p div br li tr td th h1 h2 h3 h4 h5 h6 title text tspan desc'.split(
    ' '
  )
)

/**
 * The words of HTML, SVG or document XML, without markup. One pass that only
 * moves forward: these files come from uploaders, and backtracking patterns
 * would let a crafted file hold the server for minutes.
 */
export function markupText(markup: string): string {
  let text = ''
  let at = 0
  while (at < markup.length) {
    const open = markup.indexOf('<', at)
    if (open < 0) {
      text += markup.slice(at)
      break
    }
    text += markup.slice(at, open)
    if (markup.startsWith('<!--', open)) {
      const close = markup.indexOf('-->', open + 4)
      if (close < 0) break
      text += ' '
      at = close + 3
      continue
    }
    const close = markup.indexOf('>', open + 1)
    if (close < 0) break
    const tag = markup.slice(open + 1, Math.min(close, open + 40))
    const name = (/^\/?([\w:-]*)/.exec(tag)?.[1] ?? '').toLowerCase()
    at = close + 1
    if ((name === 'script' || name === 'style') && tag[0] !== '/') {
      // Skip to the matching end tag; without one, the rest is code.
      const endTag = new RegExp(`</${name}`, 'ig')
      endTag.lastIndex = at
      const end = endTag.exec(markup)?.index ?? -1
      if (end < 0) break
      const endClose = markup.indexOf('>', end)
      if (endClose < 0) break
      text += ' '
      at = endClose + 1
      continue
    }
    if (SEPARATING_TAGS.has(name)) text += ' '
  }
  return decodeEntities(text)
}

/** Decode the start of a text file, or null when it is really binary. */
export function decodeText(bytes: Buffer): string | null {
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder('utf-16le').decode(bytes)
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder('utf-16be').decode(bytes)
  else text = new TextDecoder('utf-8').decode(bytes)
  if (!text) return ''
  let suspicious = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 0 || code === 0xfffd) suspicious++
  }
  // A cut-off last character is fine; NULs and invalid bytes throughout aren't.
  return suspicious > Math.max(2, text.length / 100) ? null : text
}

async function openFile(
  file: ExtractableFile,
  limit?: number
): Promise<Readable> {
  try {
    const storage = await sourceStorage(file)
    return await storage.getFileStream(
      file.path,
      limit ? { start: 0, end: limit - 1 } : undefined
    )
  } catch {
    throw new ExtractionFailure('Flare couldn’t open this file in storage.')
  }
}

async function readFile(file: ExtractableFile, limit: number): Promise<Buffer> {
  const stream = await openFile(file, limit)
  try {
    return await readUpTo(stream, limit)
  } catch {
    throw new ExtractionFailure('Flare couldn’t read this file from storage.')
  }
}

function found(source: ContentSource, text: string, what: string): Extraction {
  const content = cleanText(text)
  return content
    ? { status: 'INDEXED', source, content, entries: null }
    : { status: 'EMPTY', source, reason: what }
}

const NO_IMAGE_TEXT = 'No text was found in this image.'

async function extractImageText(file: ExtractableFile): Promise<Extraction> {
  // Recognized before, on upload or on request: never read it again.
  if (file.ocrText !== null)
    return found('ocr', recognizedText(file.ocrText), NO_IMAGE_TEXT)
  const { enabled } = (await getConfig()).settings.general.ocr
  if (!enabled)
    return {
      status: 'SKIPPED',
      source: 'ocr',
      reason: 'Automatic text recognition is turned off on this instance.',
    }
  if (mbToBytes(file.size) > OCR_MAX_BYTES)
    return {
      status: 'SKIPPED',
      source: 'ocr',
      reason: 'This image is too large for automatic text recognition.',
    }
  const result = await ocrQueue.recognize({
    fileId: file.id,
    filePath: file.path,
  })
  if (!result.success)
    throw new ExtractionFailure('Flare couldn’t read text from this image.')
  return found('ocr', recognizedText(result.text ?? ''), NO_IMAGE_TEXT)
}

async function extractPdfText(
  file: ExtractableFile,
  signal: AbortSignal
): Promise<Extraction> {
  if (mbToBytes(file.size) > PDF_MAX_BYTES)
    return {
      status: 'SKIPPED',
      source: 'pdf',
      reason: 'This PDF is too large to read for search.',
    }
  const bytes = await readFile(file, PDF_MAX_BYTES + 1)
  const { getDocumentProxy } = await import('unpdf')
  let document: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    document = await getDocumentProxy(new Uint8Array(bytes), {
      stopAtErrors: false,
    })
  } catch (error) {
    const encrypted =
      error instanceof Error && error.name === 'PasswordException'
    throw new ExtractionFailure(
      encrypted
        ? 'This PDF is encrypted, so Flare can’t read its text.'
        : 'Flare couldn’t read this PDF. It may be damaged.',
      false
    )
  }
  // Stop parsing when the worker gives up on this file.
  const stop = () => void document.loadingTask.destroy()
  signal.addEventListener('abort', stop, { once: true })
  try {
    const pages: string[] = []
    let length = 0
    const count = Math.min(document.numPages, PDF_MAX_PAGES)
    for (let number = 1; number <= count; number++) {
      signal.throwIfAborted()
      const page = await document.getPage(number)
      const { items } = await page.getTextContent()
      const text = items
        .map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''
        )
        .join('')
      pages.push(text)
      length += text.length
      page.cleanup()
      if (length >= MAX_INDEXED_CHARACTERS) break
    }
    return found(
      'pdf',
      pages.join('\n'),
      'This PDF has no selectable text. Scanned pages are not recognized.'
    )
  } catch {
    throw new ExtractionFailure(
      'Flare couldn’t read this PDF. It may be damaged.',
      false
    )
  } finally {
    signal.removeEventListener('abort', stop)
    void document.loadingTask.destroy()
  }
}

const DOCUMENT_PARTS: Record<'docx' | 'pptx' | 'xlsx' | 'odf', RegExp> = {
  docx: /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/,
  pptx: /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/,
  xlsx: /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
  odf: /^content\.xml$/,
}

function partOrder(path: string) {
  // slide10 after slide9; the main document before headers.
  const number = Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0)
  return [
    /document|content|sharedStrings/.test(path) ? 0 : 1,
    path.replace(/\d+\.xml$/, ''),
    number,
  ] as const
}

async function extractDocumentText(
  file: ExtractableFile,
  kind: 'docx' | 'pptx' | 'xlsx' | 'odf',
  signal: AbortSignal
): Promise<Extraction> {
  if (mbToBytes(file.size) > DOCUMENT_MAX_BYTES)
    return {
      status: 'SKIPPED',
      source: 'document',
      reason: 'This document is too large to read for search.',
    }
  const bytes = await readFile(file, DOCUMENT_MAX_BYTES + 1)
  const damaged = new ExtractionFailure(
    'Flare couldn’t read this document. It may be damaged or password protected.',
    false
  )
  let zip: Awaited<ReturnType<typeof fromBufferPromise>>
  try {
    zip = await fromBufferPromise(bytes, {
      lazyEntries: true,
      validateEntrySizes: true,
    })
  } catch {
    throw damaged
  }
  try {
    const parts: { path: string; xml: string }[] = []
    let total = 0
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted()
      if (!DOCUMENT_PARTS[kind].test(entry.fileName)) continue
      // Encrypted members can't be read; their declared sizes can lie.
      if (entry.generalPurposeBitFlag & 0x1) throw damaged
      total += entry.uncompressedSize
      if (total > DOCUMENT_XML_MAX_BYTES) break
      const stream = await zip.openReadStreamPromise(entry)
      const xml = (await readUpTo(stream, DOCUMENT_XML_MAX_BYTES)).toString(
        'utf8'
      )
      parts.push({ path: entry.fileName, xml })
    }
    if (!parts.length) throw damaged
    parts.sort((a, b) => {
      const [x, y] = [partOrder(a.path), partOrder(b.path)]
      return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2]
    })
    return found(
      'document',
      parts.map((part) => markupText(part.xml)).join(' '),
      'This document has no text.'
    )
  } catch (error) {
    throw error instanceof ExtractionFailure ? error : damaged
  } finally {
    zip.close()
  }
}

async function extractArchiveEntries(
  file: ExtractableFile,
  signal: AbortSignal
): Promise<Extraction> {
  let ref
  try {
    ref = await archiveSourceRef(file)
  } catch {
    throw new ExtractionFailure('Flare couldn’t open this archive in storage.')
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  signal.addEventListener('abort', stop, { once: true })
  try {
    const { index } = await getArchiveIndex(ref, {
      signal: controller.signal,
      wait: 'complete',
      requester: 'system:search-index',
    })
    const entries = (index?.entries ?? [])
      .slice(0, MAX_INDEXED_ENTRIES)
      .map((entry) => entry.path.replace(/[\r\n]+/g, ' '))
      .filter(Boolean)
    if (!entries.length)
      return {
        status: 'EMPTY',
        source: 'archive',
        reason: 'This archive is empty.',
      }
    let length = 0
    const kept = entries.filter(
      (entry) => (length += entry.length + 1) <= MAX_INDEXED_CHARACTERS
    )
    return {
      status: 'INDEXED',
      source: 'archive',
      content: null,
      entries: kept,
    }
  } catch {
    throw new ExtractionFailure(
      'Flare couldn’t list this archive. It may be damaged, encrypted or too large.',
      false
    )
  } finally {
    signal.removeEventListener('abort', stop)
    controller.abort()
  }
}

async function extractPlainText(
  file: ExtractableFile,
  markup: boolean
): Promise<Extraction> {
  const bytes = await readFile(file, TEXT_READ_BYTES)
  const text = decodeText(bytes)
  if (text === null)
    return {
      status: 'UNSUPPORTED',
      reason: 'This file looks like binary data rather than text.',
    }
  return found('text', markup ? markupText(text) : text, 'This file is empty.')
}

/**
 * Read what can be searched in a file. Throws {@link ExtractionFailure}.
 * Aborting `signal` stops PDF parsing, document reading and archive listing;
 * text recognition finishes in its own worker.
 */
export async function extractSearchableText(
  file: ExtractableFile,
  signal: AbortSignal = new AbortController().signal
): Promise<Extraction> {
  const extractor = extractorFor(file)
  switch (extractor) {
    case 'ocr':
      return extractImageText(file)
    case 'pdf':
      return extractPdfText(file, signal)
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'odf':
      return extractDocumentText(file, extractor, signal)
    case 'archive':
      return extractArchiveEntries(file, signal)
    case 'markup':
      return extractPlainText(file, true)
    case 'text':
      return extractPlainText(file, false)
    case null:
      return {
        status: 'UNSUPPORTED',
        reason: file.mimeType.startsWith('image/')
          ? 'Flare can’t recognize text in this image format.'
          : null,
      }
  }
}

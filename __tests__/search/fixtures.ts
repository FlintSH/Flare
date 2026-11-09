import archiver from 'archiver'
import { PassThrough, Readable } from 'node:stream'

/** A one-page PDF whose text is real, selectable text. */
export function pdfWithText(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`)
  const stream = [
    'BT /F1 14 Tf 72 720 Td 18 TL',
    ...lines.map((line) => `(${escape(line)}) '`),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/** A ZIP of the given members, as archive uploads and Office files are. */
export async function zipOf(members: Record<string, string | Buffer>) {
  const archive = archiver('zip', { zlib: { level: 6 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    output.on('end', resolve)
    archive.on('error', reject)
  })
  archive.pipe(output)
  for (const [name, data] of Object.entries(members))
    archive.append(data, { name })
  await archive.finalize()
  await done
  return Buffer.concat(chunks)
}

/** A Word document with the paragraphs, split into runs like Word does. */
export function docxOf(paragraphs: string[]) {
  const body = paragraphs
    .map((text) => {
      const middle = Math.floor(text.length / 2)
      return `<w:p><w:r><w:t>${text.slice(0, middle)}</w:t></w:r><w:r><w:t xml:space="preserve">${text.slice(middle)}</w:t></w:r></w:p>`
    })
    .join('')
  return zipOf({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
  })
}

export function xlsxOf(cells: string[]) {
  return zipOf({
    '[Content_Types].xml': '<Types/>',
    'xl/sharedStrings.xml': `<sst>${cells.map((cell) => `<si><t>${cell}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>',
  })
}

/** Storage that keeps objects in memory, with ranged reads like S3. */
export function memoryStorage() {
  const objects = new Map<string, Buffer>()
  return {
    objects,
    provider: {
      kind: 'local' as const,
      target: { provider: 'local' as const },
      async getFileStream(
        path: string,
        range?: { start?: number; end?: number }
      ) {
        const bytes = objects.get(path)
        if (!bytes) throw new Error(`ENOENT: /srv/private/${path}`)
        const start = range?.start ?? 0
        const end = range?.end === undefined ? bytes.length : range.end + 1
        return Readable.from([bytes.subarray(start, end)])
      },
      async getFileSize(path: string) {
        const bytes = objects.get(path)
        if (!bytes) throw new Error(`ENOENT: /srv/private/${path}`)
        return bytes.length
      },
    },
  }
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  cleanText,
  decodeText,
  extractorFor,
  markupText,
} from '@/lib/search/extract'
import { contentQuery, snippet } from '@/lib/search/query'
import {
  compactText,
  findTermRanges,
  foldText,
  parseSearch,
  recognizedText,
  segmentText,
  tokenize,
} from '@/lib/search/text'

describe('search text', () => {
  it('folds exactly like the database function the migration defines', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261109000000_file_search_index/migration.sql'
      ),
      'utf8'
    )
    const [, from, to] =
      /translate\(lower\(value\), '([^']+)', '([^']+)'\)/.exec(sql) ?? []
    const source = [...from]
    const target = [...to]
    expect(source).toHaveLength(target.length)
    source.forEach((character, index) =>
      expect(foldText(character)).toBe(target[index])
    )
    // Nothing outside the table changes except by lower case.
    for (let code = 0xc0; code <= 0x1eff; code++) {
      const character = String.fromCodePoint(code)
      if (!source.includes(character) && character.toLowerCase().length === 1)
        expect(foldText(character)).toBe(character.toLowerCase())
    }
    expect(foldText('Résumé ŁÓDŹ İstanbul')).toBe('resume łodz istanbul')
    expect(foldText('ﬁle').length).toBe('ﬁle'.length)
  })

  it('reads words, phrases, exclusions and places from a query', () => {
    expect(
      parseSearch(
        'Invoice "total due" -draft tag:Receipts in:taxes type:.PDF 10:32 foo:bar'
      ).terms
    ).toEqual([
      { value: 'invoice', field: 'any', phrase: false, negated: false },
      { value: 'total due', field: 'any', phrase: true, negated: false },
      { value: 'draft', field: 'any', phrase: false, negated: true },
      { value: 'receipts', field: 'tag', phrase: false, negated: false },
      { value: 'taxes', field: 'folder', phrase: false, negated: false },
      { value: 'pdf', field: 'type', phrase: false, negated: false },
      { value: '10:32', field: 'any', phrase: false, negated: false },
      { value: 'foo:bar', field: 'any', phrase: false, negated: false },
    ])
    expect(parseSearch('  - "" ').terms).toEqual([])
    expect(parseSearch('a '.repeat(40)).terms).toHaveLength(12)
    expect(parseSearch('-draft').positive).toEqual([])
  })

  it('compacts names and tokenizes contents the same way everywhere', () => {
    expect(compactText('final_FINAL (2).docx')).toBe(
      'final_FINAL(2)docx'.replace(/[_()]/g, '')
    )
    expect(tokenize('IMG_2024-03-01 Ünïcode 東京 émoji🙂')).toEqual([
      'img',
      '2024',
      '03',
      '01',
      'unicode',
      '東京',
      'emoji',
    ])
    expect(tokenize('x'.repeat(100))[0]).toHaveLength(64)
  })

  it('drops recognized text without a single real word', () => {
    expect(recognizedText(' a » ')).toBe('')
    expect(recognizedText('Gate B22')).toBe('Gate B22')
  })

  it('builds safe prefix queries for the content index', () => {
    const [invoices, phrase, odd] = parseSearch(
      `invoices "gate b22" it's`
    ).terms
    expect(contentQuery(invoices)).toBe(`'invoice':*`)
    expect(contentQuery(phrase, 'C')).toBe(`'gate':C <-> 'b22':*C`)
    // Quotes never reach the query text.
    expect(contentQuery(odd)).toBe(`'it' <-> 's':*`)
    expect(contentQuery(parseSearch('!!!').terms[0])).toBeNull()
  })

  it('marks matches at word starts and cuts a snippet around the first', () => {
    const text =
      'Lorem ipsum dolor sit amet. '.repeat(10) +
      'ACME Corp Invoice 2024-117. Total due: 420.00 EUR. Reinvoiced later.'
    const terms = parseSearch('invoices total').terms
    expect(
      findTermRanges('Reinvoiced invoice', terms, 'words').map(
        (range) => range.start
      )
    ).toEqual([11])
    const segments = snippet(text, terms)
    expect(segments[0]).toEqual({ text: '…' })
    expect(
      segments.filter((segment) => segment.match).map((s) => s.text)
    ).toEqual(['Invoice', 'Total'])
    expect(
      segments.map((segment) => segment.text).join('').length
    ).toBeLessThan(240)
    expect(segmentText('abc', [{ start: 1, end: 2 }])).toEqual([
      { text: 'a' },
      { text: 'b', match: true },
      { text: 'c' },
    ])
  })
})

describe('extraction helpers', () => {
  it('chooses an extractor from the stored type and name', () => {
    const kind = (name: string, mimeType: string, isPaste = false) =>
      extractorFor({ name, mimeType, isPaste })
    expect(kind('a.png', 'image/png')).toBe('ocr')
    expect(kind('a.heic', 'image/heic')).toBeNull()
    expect(kind('a.svg', 'image/svg+xml')).toBe('markup')
    expect(kind('a.pdf', 'application/pdf')).toBe('pdf')
    expect(kind('a.docx', 'application/octet-stream')).toBe('docx')
    expect(
      kind('a.ods', 'application/vnd.oasis.opendocument.spreadsheet')
    ).toBe('odf')
    expect(kind('a.tar.gz', 'application/gzip')).toBe('archive')
    expect(kind('a.json', 'application/json')).toBe('text')
    expect(kind('paste', 'application/octet-stream', true)).toBe('text')
    expect(kind('a.mp4', 'video/mp4')).toBeNull()
    expect(kind('a.bin', 'application/octet-stream')).toBeNull()
  })

  it('reads text from markup and refuses binary data', () => {
    expect(
      markupText(
        '<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r></w:p><w:p><w:t>R&amp;D &#233;t&#xE9;</w:t></w:p><script>x()</script>'
      ).trim()
    ).toBe('Hello  R&D été')
    expect(decodeText(Buffer.from('plain ✓'))).toBe('plain ✓')
    expect(decodeText(Buffer.from([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toBe('hi')
    expect(decodeText(Buffer.from([0, 0, 0, 1, 2, 0, 0, 0]))).toBeNull()
    expect(cleanText(' a\u0000b\n\n c ')).toBe('a b c')
  })
})

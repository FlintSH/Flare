import { describe, expect, it } from 'vitest'

import { codeGrammar } from '@/components/file/viewer/components/code-grammar'

import {
  LANGUAGES,
  fileIcon,
  fileKind,
  fileTypeGroup,
  fileTypeLabel,
  isTextKind,
  languageFromFilename,
} from '@/lib/files/file-kind'

describe('fileKind', () => {
  it('reads media and PDF from the stored type', () => {
    expect(fileKind({ name: 'a.png', mimeType: 'image/png' })).toEqual({
      kind: 'image',
    })
    expect(fileKind({ mimeType: 'application/pdf' })).toEqual({ kind: 'pdf' })
    expect(fileKind({ mimeType: 'video/webm' })).toEqual({ kind: 'video' })
    expect(fileKind({ mimeType: 'audio/mpeg' })).toEqual({ kind: 'audio' })
  })

  // Browsers play many more types than the viewer used to list.
  it('treats every video and audio type as media', () => {
    expect(fileKind({ mimeType: 'video/x-m4v' }).kind).toBe('video')
    expect(fileKind({ mimeType: 'audio/flac' }).kind).toBe('audio')
    expect(fileKind({ mimeType: 'audio/mp4' }).kind).toBe('audio')
  })

  // Operating systems map .ts to MPEG transport streams, as they map .tsx to
  // Tiled tilesets.
  it('opens TypeScript stored as an MPEG transport stream as code', () => {
    for (const name of ['index.ts', 'vite.config.mts', 'eslint.config.CTS'])
      for (const mimeType of ['video/mp2t', 'video/vnd.dlna.mpeg-tts'])
        expect(fileKind({ name, mimeType }), `${name} ${mimeType}`).toEqual({
          kind: 'code',
          language: 'typescript',
        })
    expect(
      fileKind({ name: 'main.tsx', mimeType: 'application/x-tiled-tsx' })
    ).toEqual({ kind: 'code', language: 'tsx' })
    expect(fileKind({ name: 'match.m2ts', mimeType: 'video/mp2t' }).kind).toBe(
      'video'
    )
    expect(fileKind({ name: 'clip.ts', mimeType: 'video/mp4' }).kind).toBe(
      'video'
    )
    expect(fileIcon({ name: 'index.ts', mimeType: 'video/mp2t' })).toBe('code')
  })

  it('lets a media type win over an archive name', () => {
    expect(fileKind({ name: 'photo.zip', mimeType: 'image/png' }).kind).toBe(
      'image'
    )
  })

  it('finds archives by name or type', () => {
    expect(
      fileKind({ name: 'site.tar.gz', mimeType: 'application/octet-stream' })
    ).toEqual({ kind: 'archive', archiveFormat: 'tar.gz' })
    expect(fileKind({ mimeType: 'application/x-zip-compressed' })).toEqual({
      kind: 'archive',
      archiveFormat: 'zip',
    })
    expect(
      fileKind({ name: 'backup.RAR', mimeType: 'application/octet-stream' })
    ).toEqual({ kind: 'unsupported-archive' })
    expect(fileKind({ mimeType: 'application/x-7z-compressed' })).toEqual({
      kind: 'unsupported-archive',
    })
  })

  it('finds CSV by type or by a .csv name', () => {
    expect(fileKind({ mimeType: 'text/csv' }).kind).toBe('csv')
    expect(fileKind({ mimeType: 'application/csv' }).kind).toBe('csv')
    // Windows stores CSV as an Excel type.
    expect(
      fileKind({ name: 'Report.CSV', mimeType: 'application/vnd.ms-excel' })
        .kind
    ).toBe('csv')
    expect(fileKind({ name: 'data.csv', mimeType: 'text/plain' }).kind).toBe(
      'csv'
    )
    expect(fileKind({ mimeType: 'application/vnd.ms-excel' }).kind).toBe(
      'other'
    )
  })

  it('highlights code by its type', () => {
    expect(fileKind({ name: 'notes.txt', mimeType: 'text/x-python' })).toEqual({
      kind: 'code',
      language: 'python',
    })
    expect(fileKind({ mimeType: 'application/json' })).toEqual({
      kind: 'code',
      language: 'json',
    })
    expect(fileKind({ mimeType: 'application/x-php' })).toEqual({
      kind: 'code',
      language: 'php',
    })
    // Code Flare has no grammar for still opens as text.
    expect(fileKind({ mimeType: 'text/x-ruby' })).toEqual({
      kind: 'code',
      language: 'text',
    })
  })

  it('highlights other text by its extension', () => {
    expect(
      fileKind({ name: 'csv_to_json.py', mimeType: 'text/plain' })
    ).toEqual({ kind: 'text', language: 'python' })
    expect(fileKind({ name: 'server.log', mimeType: 'text/x-log' })).toEqual({
      kind: 'text',
      language: 'text',
    })
    expect(fileKind({ name: 'Program.cs', mimeType: 'text/x-csharp' })).toEqual(
      { kind: 'text', language: 'text' }
    )
  })

  it('previews no binary format as text', () => {
    for (const mimeType of [
      'application/wasm',
      'application/x-protobuf',
      'application/x-python-code',
      'application/octet-stream',
    ])
      expect(fileKind({ name: 'a.py', mimeType }).kind, mimeType).toBe('other')
  })
})

describe('languageFromFilename', () => {
  it('names the grammar for a paste from its extension', () => {
    expect(languageFromFilename('csv_to_json.py')).toBe('python')
    expect(languageFromFilename('notes.MD')).toBe('markdown')
    expect(languageFromFilename('component.tsx')).toBe('tsx')
    expect(languageFromFilename('config.yml')).toBe('yaml')
  })

  it('leaves prose, logs and unknown extensions as plain text', () => {
    expect(languageFromFilename('server-2026-10-30.log')).toBe('text')
    expect(languageFromFilename('README')).toBe('text')
    expect(languageFromFilename('archive.tar.unknown')).toBe('text')
  })

  it('reads the last extension', () => {
    expect(languageFromFilename('report.final.py')).toBe('python')
  })

  // The share page passes the result to a client component, so anything but
  // a string (such as Object's constructor) would stop the page rendering.
  it('treats names and types named like Object members as plain', () => {
    for (const name of [
      'notes.constructor',
      'notes.__proto__',
      'notes.toString',
      'notes.hasOwnProperty',
      'notes.valueOf',
    ])
      expect(languageFromFilename(name), name).toBe('text')
    expect(fileKind({ mimeType: 'constructor' })).toEqual({ kind: 'other' })
    expect(fileTypeLabel('constructor')).toBe('CONSTRUCTOR')
  })
})

describe('codeGrammar', () => {
  it('has a grammar for every language but plain text', () => {
    for (const language of LANGUAGES)
      if (language === 'text') expect(codeGrammar(language)).toEqual([])
      else expect(codeGrammar(language), language).not.toEqual([])
  })
})

describe('isTextKind', () => {
  it('offers text to copy for CSV, code and text only', () => {
    expect(isTextKind('csv')).toBe(true)
    expect(isTextKind('code')).toBe(true)
    expect(isTextKind('text')).toBe(true)
    expect(isTextKind('pdf')).toBe(false)
    expect(isTextKind('other')).toBe(false)
  })
})

describe('fileIcon', () => {
  it('follows the kind', () => {
    expect(fileIcon({ mimeType: 'image/png' })).toBe('image')
    expect(fileIcon({ mimeType: 'video/mp4' })).toBe('video')
    expect(fileIcon({ mimeType: 'audio/ogg' })).toBe('audio')
    expect(fileIcon({ mimeType: 'application/pdf' })).toBe('text')
    expect(fileIcon({ mimeType: 'text/plain' })).toBe('text')
    expect(fileIcon({ mimeType: 'application/json' })).toBe('code')
    expect(fileIcon({ mimeType: 'text/x-sh' })).toBe('code')
    expect(fileIcon({ mimeType: 'text/csv' })).toBe('table')
    expect(fileIcon({ mimeType: 'application/zip' })).toBe('archive')
    expect(fileIcon({ mimeType: 'application/vnd.rar' })).toBe('archive')
  })

  it('uses the real name for CSV files and archives', () => {
    expect(
      fileIcon({ name: 'data.csv', mimeType: 'application/octet-stream' })
    ).toBe('table')
    expect(
      fileIcon({ name: 'site.zip', mimeType: 'application/octet-stream' })
    ).toBe('archive')
  })

  // The substring "java" used to give these the code icon.
  it('gives binaries named like code no code icon', () => {
    expect(fileIcon({ mimeType: 'application/java-archive' })).toBe('file')
    expect(fileIcon({ mimeType: 'application/vnd.google-earth.kmz' })).toBe(
      'file'
    )
  })

  it('hints at what a file without a preview holds', () => {
    expect(
      fileIcon({
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    ).toBe('table')
    expect(fileIcon({ mimeType: 'application/x-bzip2' })).toBe('archive')
    expect(fileIcon({ mimeType: 'application/msword' })).toBe('text')
    expect(
      fileIcon({
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe('text')
    expect(fileIcon({ mimeType: 'application/octet-stream' })).toBe('file')
  })
})

describe('the File type filter', () => {
  it('groups types by kind', () => {
    expect(fileTypeGroup('image/svg+xml')).toBe('Images')
    expect(fileTypeGroup('video/quicktime')).toBe('Videos')
    expect(fileTypeGroup('audio/flac')).toBe('Audio')
    for (const type of [
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/csv',
      'application/json',
      'application/x-sh',
      'application/vnd.oasis.opendocument.text',
    ])
      expect(fileTypeGroup(type), type).toBe('Documents')
    for (const type of [
      'application/zip',
      'application/x-7z-compressed',
      'application/octet-stream',
      'application/vnd.ms-excel',
    ])
      expect(fileTypeGroup(type), type).toBe('Other files')
  })

  it.each([
    ['text/markdown', 'Markdown'],
    ['text/x-markdown', 'Markdown'],
    ['application/typescript', 'TypeScript'],
    ['application/json', 'JSON'],
    ['application/x-zip-compressed', 'ZIP archive'],
    ['video/mp4', 'MP4 video'],
    ['audio/mpeg', 'MP3 audio'],
  ])('gives %s the same readable label wherever it is shown', (type, label) => {
    expect(fileTypeLabel(type)).toBe(label)
  })

  it('names common types and capitalizes the rest', () => {
    expect(fileTypeLabel('text/plain')).toBe('Plain text')
    expect(
      fileTypeLabel(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('Word document')
    expect(fileTypeLabel('image/webp')).toBe('WEBP')
  })
})

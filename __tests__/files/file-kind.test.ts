import { describe, expect, it } from 'vitest'

import { loadCodeGrammar } from '@/components/file/viewer/components/code-grammar'

import {
  LANGUAGES,
  fileIcon,
  fileKind,
  fileTypeDescription,
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
    ])
      expect(fileKind({ name: 'a.py', mimeType }).kind, mimeType).toBe('other')
    // A generic type says nothing, so an unknown name stays a download.
    for (const name of ['firmware.bin', 'module.pyc', 'setup', 'photo.raw'])
      expect(
        fileKind({ name, mimeType: 'application/octet-stream' }).kind,
        name
      ).toBe('other')
  })

  // A browser sends no type for an extension the uploading system doesn't
  // know, such as .md on Windows, and the upload is stored as generic bytes.
  it('opens text and code stored under a generic type by its name', () => {
    for (const mimeType of ['application/octet-stream', 'binary/octet-stream'])
      expect(fileKind({ name: 'README.md', mimeType }), mimeType).toEqual({
        kind: 'code',
        language: 'markdown',
      })
    expect(
      fileKind({ name: 'main.rs', mimeType: 'application/octet-stream' })
    ).toEqual({ kind: 'code', language: 'rust' })
    for (const name of ['server.log', 'deploy.sh', '.env', 'Dockerfile'])
      expect(
        fileKind({ name, mimeType: 'application/octet-stream' }),
        name
      ).toEqual({ kind: 'text', language: 'text' })
    // A name alone never decides for a type that says what the bytes are.
    expect(
      fileKind({ name: 'notes.md', mimeType: 'application/zip' }).kind
    ).toBe('archive')
    expect(
      fileKind({ name: 'notes.md', mimeType: 'application/x-msdownload' }).kind
    ).toBe('other')
  })

  // The delimiter is named for the viewer: a guess would take the commas
  // inside a tab-separated file's cells for it.
  it('shows tab-separated files as tables and names their delimiter', () => {
    const tabs = { kind: 'csv', delimiter: '\t' }
    expect(
      fileKind({ name: 'cities.tsv', mimeType: 'text/tab-separated-values' })
    ).toEqual(tabs)
    expect(
      fileKind({ name: 'cities.TSV', mimeType: 'application/octet-stream' })
    ).toEqual(tabs)
    expect(
      fileKind({ name: 'export', mimeType: 'text/tab-separated-values' })
    ).toEqual(tabs)
    // A CSV's delimiter is detected, so semicolon files keep working.
    expect(fileKind({ name: 'cities.csv', mimeType: 'text/csv' })).toEqual({
      kind: 'csv',
    })
    expect(fileIcon({ name: 'cities.tsv', mimeType: 'text/plain' })).toBe(
      'table'
    )
  })
})

describe('fileTypeDescription', () => {
  const describes = (name: string, mimeType: string) =>
    fileTypeDescription({ name, mimeType })

  it('names media by its format', () => {
    expect(describes('a.png', 'image/png')).toBe('PNG image')
    expect(describes('a.jpg', 'image/jpeg')).toBe('JPEG image')
    expect(describes('a.svg', 'image/svg+xml')).toBe('SVG image')
    expect(describes('a.webp', 'image/webp')).toBe('WebP image')
    expect(describes('a.mp4', 'video/mp4')).toBe('MP4 video')
    expect(describes('a.mov', 'video/quicktime')).toBe('MOV video')
    expect(describes('a.mp3', 'audio/mpeg')).toBe('MP3 audio')
    expect(describes('a.m4a', 'audio/mp4')).toBe('M4A audio')
    expect(describes('a.flac', 'audio/flac')).toBe('FLAC audio')
  })

  it('falls back to the extension, then the kind, for an unusual subtype', () => {
    expect(describes('clip.mkv', 'video/x-some-long-vendor-type')).toBe(
      'MKV video'
    )
    expect(describes('clip', 'video/x-some-long-vendor-type')).toBe('Video')
  })

  it('names documents, tables, text and code', () => {
    expect(describes('a.pdf', 'application/pdf')).toBe('PDF document')
    expect(describes('a.csv', 'text/csv')).toBe('CSV spreadsheet')
    expect(describes('a.tsv', 'text/tab-separated-values')).toBe(
      'TSV spreadsheet'
    )
    expect(describes('index.ts', 'video/mp2t')).toBe('TypeScript')
    expect(describes('script.py', 'text/plain')).toBe('Python')
    expect(describes('README.md', 'application/octet-stream')).toBe('Markdown')
    expect(describes('notes.txt', 'text/plain')).toBe('Plain text')
    expect(describes('README', 'text/plain')).toBe('Plain text')
    expect(describes('server.log', 'text/x-log')).toBe('Log file')
    expect(describes('deploy.sh', 'text/x-sh')).toBe('SH file')
    // A number is not a format: a rotated log is still plain text.
    expect(describes('app.log.1', 'text/plain')).toBe('Plain text')
    expect(describes('notes.2026', 'text/plain')).toBe('Plain text')
  })

  it('names archives by their format', () => {
    expect(describes('a.zip', 'application/zip')).toBe('ZIP archive')
    expect(describes('a.tgz', 'application/octet-stream')).toBe(
      'TAR.GZ archive'
    )
    expect(describes('a.rar', 'application/vnd.rar')).toBe('RAR archive')
    expect(describes('a.7z', 'application/x-7z-compressed')).toBe('7z archive')
  })

  it('names files without a preview by a known type or their extension', () => {
    expect(
      describes(
        'Report.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('Word document')
    expect(describes('firmware.bin', 'application/octet-stream')).toBe(
      'BIN file'
    )
    expect(describes('data', 'application/octet-stream')).toBe('File')
    expect(describes('backup.001', 'application/octet-stream')).toBe('File')
    expect(describes('disk.7z2', 'application/octet-stream')).toBe('7Z2 file')
    // Never a member of Object, and never an extension that isn't one.
    expect(describes('notes.constructor', 'constructor')).toBe('File')
    expect(describes('a.b c', 'application/octet-stream')).toBe('File')
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

describe('loadCodeGrammar', () => {
  it('has a grammar for every language but plain text', async () => {
    for (const language of LANGUAGES)
      if (language === 'text')
        expect(await loadCodeGrammar(language)).toEqual([])
      else expect(await loadCodeGrammar(language), language).not.toEqual([])
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

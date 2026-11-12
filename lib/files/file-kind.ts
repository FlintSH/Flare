/**
 * What a stored file is, decided one way for the library card, the moderation
 * list, the File type filter and the share page: which viewer previews it, how
 * its text is highlighted, its icon and its filter group. Browsers often store
 * CSV files, archives, and text or code under a generic type, so those are
 * also recognized by the real filename. Browser-safe.
 */
import { type ArchiveFormat, detectArchiveFormat } from '@/lib/archives/shared'

export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'csv'
  | 'code'
  | 'text'
  | 'archive'
  | 'unsupported-archive'
  | 'other'

/** The grammars the share page highlights with; `text` gets no colouring. */
export const LANGUAGES = [
  'html',
  'css',
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'json',
  'python',
  'markdown',
  'yaml',
  'java',
  'sql',
  'xml',
  'wasm',
  'c',
  'cpp',
  'rust',
  'php',
  'go',
  'sass',
  'scss',
  'less',
  'text',
] as const
export type Language = (typeof LANGUAGES)[number]

export type FileKindInfo =
  | { kind: 'code' | 'text'; language: Language }
  | { kind: 'archive'; archiveFormat: ArchiveFormat }
  | { kind: Exclude<FileKind, 'code' | 'text' | 'archive'> }

export interface FileTypeInput {
  /** The real filename; without it only the stored type counts. */
  name?: string
  mimeType: string
}

// Maps rather than objects, so a stored type or an extension such as
// "constructor" can't reach Object.prototype.
const byLanguage = (groups: Partial<Record<Language, string[]>>) =>
  new Map(
    Object.entries(groups).flatMap(([language, keys]) =>
      keys.map((key) => [key, language as Language] as const)
    )
  )

/**
 * Source code and markup types, with the grammar for each. Types under `text`
 * are code Flare shows without colouring.
 */
const CODE_TYPES = byLanguage({
  html: [
    'text/html',
    'application/html',
    'text/x-vue',
    'text/vue',
    'text/x-svelte',
    'text/svelte',
  ],
  css: ['text/css', 'application/css'],
  javascript: [
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'text/ecmascript',
    'application/ecmascript',
    'text/babel',
    'text/x-ejs',
    'text/x-nunjucks',
  ],
  jsx: ['text/jsx', 'application/jsx', 'text/x-jsx'],
  typescript: [
    'application/typescript',
    'text/typescript',
    'text/x-typescript',
    'application/x-typescript',
  ],
  tsx: ['text/tsx', 'application/tsx', 'text/x-tsx', 'application/x-tiled-tsx'],
  json: [
    'application/json',
    'text/json',
    'application/x-json',
    'application/manifest+json',
    'application/ld+json',
  ],
  python: [
    'text/x-python',
    'text/x-python3',
    'application/x-python',
    'text/x-python-script',
  ],
  php: [
    'application/x-httpd-php',
    'application/x-php',
    'text/x-php',
    'application/php',
    'text/x-blade',
    'text/blade',
  ],
  c: ['text/x-c', 'text/x-csrc', 'text/x-chdr'],
  cpp: ['text/x-c++', 'text/x-c++src', 'text/x-c++hdr'],
  java: ['text/x-java', 'text/x-java-source'],
  go: ['text/x-go', 'text/x-golang'],
  rust: ['text/x-rust', 'text/rust'],
  xml: ['text/xml', 'application/xml'],
  yaml: ['text/x-yaml', 'application/x-yaml', 'text/yaml'],
  sql: ['text/x-sql', 'application/sql', 'text/x-mysql', 'text/x-pgsql'],
  markdown: ['text/markdown', 'text/x-markdown', 'text/md', 'text/x-md'],
  wasm: ['text/x-wasm'],
  scss: ['text/x-scss', 'text/scss'],
  sass: ['text/x-sass', 'text/sass'],
  less: ['text/x-less', 'text/less'],
  text: [
    'text/x-ruby',
    'application/x-ruby',
    'text/ruby',
    'text/x-sh',
    'text/x-shellscript',
    'application/x-sh',
    'text/x-kotlin',
    'text/kotlin',
    'text/x-swift',
    'text/swift',
    'text/x-scala',
    'text/scala',
    'text/x-perl',
    'application/x-perl',
    'text/x-lua',
    'application/x-lua',
    'text/x-toml',
    'application/toml',
    'text/x-ini',
    'text/ini',
    'text/x-properties',
    'text/x-java-properties',
    'text/x-rst',
    'text/x-latex',
    'application/x-latex',
    'application/x-tex',
    'text/x-haskell',
    'text/x-literate-haskell',
    'text/x-erlang',
    'text/x-elixir',
    'text/x-clojure',
    'text/x-fsharp',
    'text/x-r',
    'text/r',
    'text/x-matlab',
    'text/x-octave',
    'text/x-dart',
    'application/dart',
    'text/x-groovy',
    'text/groovy',
    'text/x-julia',
    'application/graphql',
    'text/x-graphql',
    'text/x-protobuf',
    'text/x-dockerfile',
    'application/vnd.docker.dockerfile',
    'text/x-git-config',
    'text/x-git',
    'text/x-handlebars',
    'text/x-mustache',
    'text/x-twig',
    'text/twig',
    'text/x-jinja',
    'text/jinja',
    'text/x-velocity',
    'text/velocity',
    'text/x-asm',
    'text/x-nasm',
    'text/x-masm',
    'text/x-gas',
  ],
})

/**
 * Pastes and other plain text are stored as text/plain, so their extension
 * names the grammar.
 */
const EXTENSION_LANGUAGES = byLanguage({
  html: ['html', 'htm'],
  css: ['css'],
  javascript: ['js', 'mjs', 'cjs'],
  jsx: ['jsx'],
  typescript: ['ts', 'mts', 'cts'],
  tsx: ['tsx'],
  json: ['json'],
  python: ['py'],
  markdown: ['md', 'markdown'],
  yaml: ['yaml', 'yml'],
  java: ['java'],
  sql: ['sql'],
  xml: ['xml', 'svg'],
  wasm: ['wat'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'hpp'],
  rust: ['rs'],
  php: ['php'],
  go: ['go'],
  sass: ['sass'],
  scss: ['scss'],
  less: ['less'],
})

/** A name's last extension in lower case, or '' without one. */
function extensionOf(name: string) {
  return name.includes('.') ? (name.split('.').pop()?.toLowerCase() ?? '') : ''
}

/** The grammar for a plain-text file, such as a paste, from its extension. */
export function languageFromFilename(name: string): Language {
  return EXTENSION_LANGUAGES.get(extensionOf(name)) || 'text'
}

/**
 * Text Flare shows without colouring when its type is generic. A browser
 * sends no type for an extension the uploading system doesn't know, and the
 * upload is stored as `application/octet-stream`.
 */
const PLAIN_TEXT_EXTENSIONS = new Set([
  ...['txt', 'text', 'log', 'nfo', 'rst', 'adoc', 'org', 'tex', 'srt', 'vtt'],
  ...['ini', 'cfg', 'conf', 'toml', 'env', 'properties', 'editorconfig'],
  ...['gitignore', 'gitattributes', 'dockerignore', 'npmrc', 'lock'],
  ...['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'],
  ...['rb', 'kt', 'kts', 'swift', 'scala', 'pl', 'lua', 'r', 'dart', 'ex'],
  ...['exs', 'erl', 'hs', 'clj', 'cs', 'fs', 'groovy', 'gradle', 'jl', 'zig'],
  ...['tf', 'proto', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'diff'],
  ...['patch', 'jsonl', 'ndjson', 'asm', 'cmake', 'mk'],
])

/** Text files commonly shared without an extension. */
const PLAIN_TEXT_NAMES = new Set([
  ...['dockerfile', 'makefile', 'license', 'readme', 'changelog', 'authors'],
  ...['notice', 'gemfile', 'procfile', 'caddyfile', 'jenkinsfile'],
])

const GENERIC_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
])

/** Text or code stored under a generic type, told from its name alone. */
function textFromFilename(name: string): FileKindInfo | null {
  const language = languageFromFilename(name)
  if (language !== 'text') return { kind: 'code', language }
  const extension = extensionOf(name)
  return (extension ? PLAIN_TEXT_EXTENSIONS : PLAIN_TEXT_NAMES).has(
    extension || name.toLowerCase()
  )
    ? { kind: 'text', language: 'text' }
    : null
}

// Systems type TypeScript sources by their extension as MPEG transport
// streams, which no browser's video player opens.
const MPEG_TS_TYPES = new Set(['video/mp2t', 'video/vnd.dlna.mpeg-tts'])

export function fileKind({ name = '', mimeType }: FileTypeInput): FileKindInfo {
  // A media type wins over the name: uploads check those bytes against it.
  if (mimeType.startsWith('image/')) return { kind: 'image' }
  if (mimeType === 'application/pdf') return { kind: 'pdf' }
  if (MPEG_TS_TYPES.has(mimeType) && /\.[cm]?ts$/i.test(name))
    return { kind: 'code', language: 'typescript' }
  if (mimeType.startsWith('video/')) return { kind: 'video' }
  if (mimeType.startsWith('audio/')) return { kind: 'audio' }
  const archiveFormat = detectArchiveFormat(name, mimeType)
  if (archiveFormat) return { kind: 'archive', archiveFormat }
  if (/\.(rar|7z)$/i.test(name) || /rar|7z-compressed/i.test(mimeType))
    return { kind: 'unsupported-archive' }
  if (
    mimeType.includes('csv') ||
    mimeType === 'text/tab-separated-values' ||
    /\.[ct]sv$/i.test(name)
  )
    return { kind: 'csv' }
  const language = CODE_TYPES.get(mimeType)
  if (language) return { kind: 'code', language }
  if (mimeType.startsWith('text/'))
    return { kind: 'text', language: languageFromFilename(name) }
  return (
    (GENERIC_TYPES.has(mimeType) && textFromFilename(name)) || { kind: 'other' }
  )
}

/** Whether the share page offers the file's contents as text to copy. */
export function isTextKind(kind: FileKind) {
  return kind === 'csv' || kind === 'code' || kind === 'text'
}

export type FileIconKey =
  'image' | 'video' | 'audio' | 'text' | 'code' | 'table' | 'archive' | 'file'

const KIND_ICONS: Record<FileKind, FileIconKey> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'text',
  csv: 'table',
  code: 'code',
  text: 'text',
  archive: 'archive',
  'unsupported-archive': 'archive',
  other: 'file',
}

export function fileIcon(file: FileTypeInput): FileIconKey {
  const { kind } = fileKind(file)
  if (kind !== 'other') return KIND_ICONS[kind]
  // Files without a preview still show what they hold.
  const type = file.mimeType
  if (/spreadsheet|excel|numbers/.test(type)) return 'table'
  if (/zip|tar|rar|7z|gzip/.test(type)) return 'archive'
  if (/json|xml|msword/.test(type)) return 'text'
  return 'file'
}

export type FileTypeGroup =
  'Images' | 'Videos' | 'Audio' | 'Documents' | 'Other files'

const KIND_GROUPS: Record<FileKind, FileTypeGroup> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  pdf: 'Documents',
  csv: 'Documents',
  code: 'Documents',
  text: 'Documents',
  archive: 'Other files',
  'unsupported-archive': 'Other files',
  other: 'Other files',
}

/** The File type filter's heading for a stored type. */
export function fileTypeGroup(mimeType: string): FileTypeGroup {
  const { kind } = fileKind({ mimeType })
  if (kind === 'other' && /pdf|document/.test(mimeType)) return 'Documents'
  return KIND_GROUPS[kind]
}

const TYPE_LABELS = new Map(
  Object.entries({
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'Excel spreadsheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PowerPoint presentation',
    'application/octet-stream': 'Other file',
    'text/plain': 'Plain text',
    'image/svg+xml': 'SVG',
  })
)

/** The File type filter's name for a stored type. */
export function fileTypeLabel(mimeType: string) {
  return (
    TYPE_LABELS.get(mimeType) ||
    (mimeType.split('/')[1] || mimeType).toUpperCase()
  )
}

const LANGUAGE_NAMES: Record<Exclude<Language, 'text'>, string> = {
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  jsx: 'JSX',
  typescript: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  python: 'Python',
  markdown: 'Markdown',
  yaml: 'YAML',
  java: 'Java',
  sql: 'SQL',
  xml: 'XML',
  wasm: 'WebAssembly text',
  c: 'C',
  cpp: 'C++',
  rust: 'Rust',
  php: 'PHP',
  go: 'Go',
  sass: 'Sass',
  scss: 'SCSS',
  less: 'Less',
}

/** Format names for stored media subtypes that don't read as one. */
const MEDIA_FORMATS = new Map(
  Object.entries({
    jpeg: 'JPEG',
    'svg+xml': 'SVG',
    webp: 'WebP',
    'x-icon': 'ICO',
    'vnd.microsoft.icon': 'ICO',
    quicktime: 'MOV',
    'x-matroska': 'MKV',
    'x-msvideo': 'AVI',
    'x-m4v': 'M4V',
    mpeg: 'MPEG',
    'x-wav': 'WAV',
    'x-flac': 'FLAC',
    'x-m4a': 'M4A',
    webm: 'WebM',
  })
)

const DOCUMENT_TYPES = new Map(
  Object.entries({
    'application/msword': 'Word document',
    'application/vnd.ms-excel': 'Excel spreadsheet',
    'application/vnd.ms-powerpoint': 'PowerPoint presentation',
    'application/vnd.oasis.opendocument.text': 'OpenDocument text',
    'application/vnd.oasis.opendocument.spreadsheet':
      'OpenDocument spreadsheet',
    'application/vnd.oasis.opendocument.presentation':
      'OpenDocument presentation',
    'application/rtf': 'Rich text document',
    'application/epub+zip': 'EPUB book',
  })
)

/** An extension short and plain enough to name a format, in capitals. */
function formatFromName(name: string) {
  const extension = extensionOf(name)
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : ''
}

/** "PNG image" from `image/png`; the name's extension when the type is vague. */
function mediaDescription(file: FileTypeInput, noun: string) {
  const subtype = file.mimeType.split('/')[1]?.split(';')[0] ?? ''
  // MP3 is stored as audio/mpeg, and M4A as audio/mp4.
  const audio = noun === 'audio'
  const format =
    (audio && subtype === 'mpeg' && 'MP3') ||
    (audio && subtype === 'mp4' && 'M4A') ||
    MEDIA_FORMATS.get(subtype) ||
    (/^[a-z0-9]{2,5}$/.test(subtype) && subtype.toUpperCase()) ||
    formatFromName(file.name ?? '')
  return format ? `${format} ${noun}` : noun[0].toUpperCase() + noun.slice(1)
}

/**
 * What a file is in a few words a recipient can read, such as "PNG image",
 * "TypeScript" or "ZIP archive", for the share page.
 */
export function fileTypeDescription(file: FileTypeInput): string {
  const name = file.name ?? ''
  const info = fileKind(file)
  switch (info.kind) {
    case 'image':
    case 'video':
    case 'audio':
      return mediaDescription(file, info.kind)
    case 'pdf':
      return 'PDF document'
    case 'csv':
      return /\.tsv$/i.test(name) ||
        file.mimeType === 'text/tab-separated-values'
        ? 'TSV spreadsheet'
        : 'CSV spreadsheet'
    case 'code':
    case 'text': {
      if (info.language !== 'text') return LANGUAGE_NAMES[info.language]
      const format = formatFromName(name)
      return !format || format === 'TXT' || format === 'TEXT'
        ? 'Plain text'
        : format === 'LOG'
          ? 'Log file'
          : `${format} file`
    }
    case 'archive':
      return `${info.archiveFormat.toUpperCase()} archive`
    case 'unsupported-archive':
      return `${/rar/i.test(`${extensionOf(name)}${file.mimeType}`) ? 'RAR' : '7z'} archive`
    default: {
      const known =
        DOCUMENT_TYPES.get(file.mimeType) ?? TYPE_LABELS.get(file.mimeType)
      if (known && known !== 'Other file') return known
      const format = formatFromName(name)
      return format ? `${format} file` : 'File'
    }
  }
}

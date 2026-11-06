/**
 * What a stored file is, decided one way for the library card, the moderation
 * list, the File type filter and the share page: which viewer previews it, how
 * its text is highlighted, its icon and its filter group. Browsers often store
 * CSV files and archives under a generic type, so those are also recognized by
 * the real filename. Browser-safe.
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

/** The grammar for a plain-text file, such as a paste, from its extension. */
export function languageFromFilename(name: string): Language {
  if (!name.includes('.')) return 'text'
  const extension = name.split('.').pop()?.toLowerCase()
  return (extension && EXTENSION_LANGUAGES.get(extension)) || 'text'
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
  if (mimeType.includes('csv') || name.toLowerCase().endsWith('.csv'))
    return { kind: 'csv' }
  const language = CODE_TYPES.get(mimeType)
  if (language) return { kind: 'code', language }
  if (mimeType.startsWith('text/'))
    return { kind: 'text', language: languageFromFilename(name) }
  return { kind: 'other' }
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

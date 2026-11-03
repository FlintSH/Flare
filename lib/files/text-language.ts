/**
 * Pastes and other text files are stored as text/plain, so their extension
 * names the grammar the share page highlights them with. Kept apart from the
 * CodeMirror grammars so the server can use it without loading them. A Map
 * rather than an object, so a name such as "notes.constructor" can't reach
 * Object.prototype and hand the share page a function.
 */
const LANGUAGES_BY_EXTENSION = new Map<string, string>(
  Object.entries({
    html: 'html',
    htm: 'html',
    css: 'css',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    py: 'python',
    md: 'markdown',
    markdown: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    java: 'java',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
    wat: 'wasm',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    rs: 'rust',
    php: 'php',
    go: 'go',
    sass: 'sass',
    scss: 'scss',
    less: 'less',
  })
)

/** The language for a plain-text file, such as a paste, from its extension. */
export function languageFromFilename(name: string): string {
  if (!name.includes('.')) return 'text'
  const extension = name.split('.').pop()?.toLowerCase()
  return (extension && LANGUAGES_BY_EXTENSION.get(extension)) || 'text'
}

import type { Extension } from '@uiw/react-codemirror'

import type { Language } from '@/lib/files/file-kind'

/**
 * Each grammar is downloaded when a file in its language is shown, so a page
 * carries the one it needs instead of all of them.
 */
const GRAMMARS: Record<Exclude<Language, 'text'>, () => Promise<Extension>> = {
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  javascript: async () =>
    (await import('@codemirror/lang-javascript')).javascript(),
  jsx: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () =>
    (await import('@codemirror/lang-javascript')).javascript({
      typescript: true,
    }),
  tsx: async () =>
    (await import('@codemirror/lang-javascript')).javascript({
      jsx: true,
      typescript: true,
    }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  // GitHub-flavoured, so task boxes such as [x] aren't read as links.
  markdown: async () => {
    const { markdown, markdownLanguage } =
      await import('@codemirror/lang-markdown')
    return markdown({ base: markdownLanguage })
  },
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  wasm: async () => (await import('@codemirror/lang-wast')).wast(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  php: async () => (await import('@codemirror/lang-php')).php(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  sass: async () => (await import('@codemirror/lang-sass')).sass(),
  scss: async () => (await import('@codemirror/lang-sass')).sass(),
  less: async () => (await import('@codemirror/lang-less')).less(),
}

/** Plain text gets no grammar, so prose and logs aren't coloured as code. */
export const NO_GRAMMAR: Extension = []

/** CodeMirror's grammar for a language. */
export async function loadCodeGrammar(language: Language): Promise<Extension> {
  return language === 'text' ? NO_GRAMMAR : GRAMMARS[language]()
}

import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { wast } from '@codemirror/lang-wast'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@uiw/react-codemirror'

import type { Language } from '@/lib/files/file-kind'

const GRAMMARS: Record<Exclude<Language, 'text'>, () => Extension> = {
  html: () => html(),
  css: () => css(),
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  python: () => python(),
  // GitHub-flavoured, so task boxes such as [x] aren't read as links.
  markdown: () => markdown({ base: markdownLanguage }),
  yaml: () => yaml(),
  java: () => java(),
  sql: () => sql(),
  xml: () => xml(),
  wasm: () => wast(),
  c: () => cpp(),
  cpp: () => cpp(),
  rust: () => rust(),
  php: () => php(),
  go: () => go(),
  sass: () => sass(),
  scss: () => sass(),
  less: () => less(),
}

/** CodeMirror's grammar for a language. Plain text gets none, so prose and
 * logs aren't coloured as code. */
export function codeGrammar(language: Language): Extension {
  return language === 'text' ? [] : GRAMMARS[language]()
}

import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { wast } from '@codemirror/lang-wast'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

export function getLanguageExtension(language: string) {
  switch (language) {
    case 'html':
      return html()
    case 'css':
      return css()
    case 'javascript':
      return javascript()
    case 'json':
      return json()
    case 'jsx':
      return javascript({ jsx: true })
    case 'typescript':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'python':
      return python()
    case 'markdown':
      return markdown()
    case 'yaml':
      return yaml()
    case 'java':
      return java()
    case 'sql':
      return sql()
    case 'xml':
      return xml()
    case 'wasm':
      return wast()
    case 'c':
    case 'cpp':
      return cpp()
    case 'rust':
      return rust()
    case 'php':
      return php()
    case 'go':
      return go()
    case 'sass':
      return sass()
    case 'scss':
      return sass()
    case 'less':
      return less()
    default:
      return javascript()
  }
}

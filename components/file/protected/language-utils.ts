// Dynamic imports for CodeMirror language extensions to reduce bundle size
// Only load the language extension when it's actually needed

export async function getLanguageExtension(language: string) {
  switch (language) {
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript()
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({
        jsx: true,
      })
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
      })
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({
        jsx: true,
        typescript: true,
      })
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'java':
      return (await import('@codemirror/lang-java')).java()
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml()
    case 'wasm':
      return (await import('@codemirror/lang-wast')).wast()
    case 'c':
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp()
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'php':
      return (await import('@codemirror/lang-php')).php()
    case 'go':
      return (await import('@codemirror/lang-go')).go()
    case 'sass':
      return (await import('@codemirror/lang-sass')).sass()
    case 'scss':
      return (await import('@codemirror/lang-sass')).sass()
    case 'less':
      return (await import('@codemirror/lang-less')).less()
    default:
      return (await import('@codemirror/lang-javascript')).javascript() // Default to javascript for unknown languages
  }
}

/**
 * Guesses the language of pasted text, so a paste is highlighted and named
 * without the person picking a language. It reads the start of the text only
 * and answers plain text whenever the signs are weak or split, because prose
 * coloured as code reads worse than code left plain. Browser-safe.
 *
 * Every pattern runs on one line of at most `MAX_LINE` characters, and none
 * has a repetition that can match the same text more than one way, so a
 * hostile paste can't make matching slow.
 */
import { type Language, languageExtension } from './file-kind'

/** The most text read: the start of a paste says what it is. */
const MAX_CHARS = 8_000
const MAX_LINES = 300
/** Long lines, such as minified code, are judged by their start. */
const MAX_LINE = 400
/** Above this, JSON is judged by its start instead of being parsed. */
const MAX_PARSE = 1_000_000

/**
 * Score keys: a language, or the part of a family's score only one member
 * earns, which picks the member once the family has won.
 */
type Key =
  | Exclude<Language, 'jsx' | 'tsx' | 'typescript' | 'cpp' | 'scss' | 'less'>
  | 'tsOnly'
  | 'jsxOnly'
  | 'cOnly'
  | 'cppOnly'
  | 'scssOnly'
  | 'lessOnly'
  | 'sassOnly'

/** Commands that open a line of a shell script. */
const COMMAND =
  '(?:apt|apt-get|yum|dnf|brew|pacman|apk|npm|npx|pnpm|yarn|pip3?|cargo|docker|kubectl|git|curl|wget|cd|ls|mkdir|rm|cp|mv|chmod|chown|systemctl|journalctl|tar|grep|sed|awk|ssh|scp|rsync|source|echo|unset|alias|exit|ln|touch)'

type Rule = readonly [pattern: RegExp, weights: Partial<Record<Key, number>>]

/** How many lines one rule counts, so one repeated shape can't decide alone. */
const RULE_CAP = 6

// Shapes of a line, with what each says. Keywords count only where code puts
// them, such as at the start of a line, so a sentence that uses the word
// "import" or "select" says nothing.
const RULES: readonly Rule[] = [
  // Python
  [
    /^\s*(?:async\s+)?def \w+\s*\(.*\)\s*(?:->\s*[\w.[\], |]+)?:\s*(?:#.*)?$/,
    { python: 4 },
  ],
  [/^\s*class \w+(?:\([\w., =]*\))?:\s*$/, { python: 4 }],
  [/^\s*from \.*[\w.]* import [\w*(]/, { python: 4 }],
  [/^\s*import [\w.]+(?: as \w+)?(?:, [\w.]+(?: as \w+)?)*\s*$/, { python: 2 }],
  [
    /^\s*(?:elif .+|else|try|finally|except\b.*|with .+ as \w+|for [\w, ]+ in .+|while .+|if .+):\s*(?:#.*)?$/,
    { python: 2 },
  ],
  [/\bself\.\w/, { python: 1 }],
  [/\b(?:None|True|False)\b/, { python: 0.5 }],
  [/\bf"[^"]*\{|\bf'[^']*\{/, { python: 1.5 }],
  [/__(?:name|init|main)__/, { python: 3 }],
  [/^\s*print\(/, { python: 1 }],
  [/^\s*@[\w.]+(?:\(.*\))?\s*$/, { python: 0.5, java: 0.5 }],

  // JavaScript and TypeScript
  [
    /^\s*import\s+(?:type\s+)?(?:[\w*{][^;]*\s+from\s+)?['"][^'"]+['"];?\s*$/,
    { javascript: 4 },
  ],
  [/^\s*\}\s*from\s+['"][^'"]+['"];?\s*$/, { javascript: 3 }],
  [
    /^\s*export\s+(?:default|const|let|function|class|async|\{|\*)/,
    { javascript: 3 },
  ],
  [/\b(?:const|var) [\w{[][\w\s,{}[\]:]*=/, { javascript: 1.5 }],
  [/\blet [\w{[][\w\s,{}[\]:]*=/, { javascript: 0.5, rust: 0.5 }],
  [/=>/, { javascript: 1, php: 0.5 }],
  [/\bfunction\s*\*?\s*\w*\s*\(/, { javascript: 2, php: 1 }],
  [
    /\b(?:console\.\w+|document\.|window\.|require\(|module\.exports|process\.env|JSON\.\w+|Promise\b|\.then\(|await )/,
    { javascript: 1.5 },
  ],
  [/[!=]==/, { javascript: 1, php: 0.5 }],
  [
    /^\s*(?:export\s+)?(?:interface|type) [A-Z]\w*(?:<[^>]*>)?\s*(?:=|\{|extends)/,
    { javascript: 2, tsOnly: 4 },
  ],
  [/^\s*import type /, { tsOnly: 4 }],
  [
    /[\w)?]:\s*(?:string|number|boolean|void|any|unknown|never|undefined)\b/,
    { tsOnly: 2 },
  ],
  [
    /:\s*(?:Record|Promise|Array|Partial|ReadonlyArray|Map|Set)</,
    { tsOnly: 2 },
  ],
  [
    /\bas (?:const|string|number|unknown|any)\b|\breadonly \w|\b(?:private|public|protected) (?:readonly )?\w+[?!]?:|\benum [A-Z]\w* \{/,
    { tsOnly: 2 },
  ],
  [/\)\s*:\s*[\w<>[\]|, ]+\s*(?:\{|=>)\s*$/, { tsOnly: 2 }],
  [/^\s*<\/?[A-Za-z][\w.]*(?:\s|>|\/>|$)/, { jsxOnly: 1 }],
  [/\breturn\s*\(?\s*<[A-Za-z>]/, { jsxOnly: 3 }],
  [/\bclassName=|^\s*<>|<\/>/, { jsxOnly: 2 }],
  [/ [a-z]\w*=\{/, { jsxOnly: 1 }],
  [
    /\buse(?:State|Effect|Memo|Ref|Callback|Context|Reducer)\(/,
    { javascript: 1 },
  ],
  [/^\s*\$\((?:document|window|['"])/, { javascript: 2 }],
  [/^\s*constructor\s*\(/, { javascript: 3 }],
  [/\bthis\.\w/, { javascript: 1, java: 0.5 }],

  // Java
  [
    /^\s*(?:(?:abstract|final|static) )*(?:class|interface|enum|record) [A-Z]\w*(?:<[^>]*>)?(?: (?:extends|implements) [^{]*)?\s*\{\s*$/,
    { java: 1, javascript: 1 },
  ],
  [
    /^\s*(?:public|private|protected) (?:abstract |final |static )*(?:class|interface|enum|record) /,
    { java: 3 },
  ],
  [/^\s*package [\w.]+;\s*$/, { java: 5 }],
  [/^\s*import (?:static )?[\w.]+(?:\.\*)?;\s*$/, { java: 3 }],
  [/\bSystem\.(?:out|err)\.print|\bString\[\] \w+|@Override\b/, { java: 4 }],
  [
    /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>[\],]+\s+\w+\s*\(/,
    { java: 2 },
  ],

  // C and C++
  [/^\s*#\s*include\s*[<"]/, { c: 2 }],
  [
    /^\s*#\s*include\s*<(?:stdio|stdlib|string|math|unistd|stdint|stdbool|errno|fcntl|signal|time|ctype|assert|limits|stddef|pthread)\.h>/,
    { cOnly: 3 },
  ],
  [/^\s*#\s*(?:define|ifndef|ifdef|endif|pragma|undef)\b/, { c: 1.5 }],
  [
    /\b(?:printf|fprintf|sprintf|scanf|malloc|calloc|free|strlen|strcpy|memcpy|memset)\s*\(/,
    { cOnly: 1.5 },
  ],
  [/\bint main\s*\(/, { c: 2 }],
  [
    /^\s*(?:typedef |struct \w+\s*\{|static (?:void|int|char|const)\b)/,
    { c: 1 },
  ],
  [
    /^\s*#\s*include\s*<(?:iostream|vector|string|map|unordered_map|memory|algorithm|functional|utility|sstream|fstream|thread|mutex|optional|array)>/,
    { cppOnly: 4 },
  ],
  [/^(?!\s*(?:pub\s+)?use\s).*\bstd::/, { cppOnly: 3 }],
  [
    /\btemplate\s*<|\bnamespace \w+\s*\{|\busing namespace\b|\bnullptr\b|\b(?:cout|cin|endl)\b/,
    { cppOnly: 3 },
  ],

  // Go
  [/^package \w+\s*$/, { go: 5 }],
  [/^func (?:\(\w+ \*?\w+\) )?\w+\(/, { go: 4 }],
  [/^import (?:\(|"[\w./-]+")/, { go: 4 }],
  [/:=/, { go: 1.5 }],
  [/\bfmt\.\w+\(|\berr != nil\b|^\s*defer |\bgo func\b|\bchan \w/, { go: 3 }],
  [/^type \w+ (?:struct|interface) \{/, { go: 4 }],
  [/`\w+:"[^"]*"/, { go: 3 }],

  // Rust
  [
    /^\s*(?:pub(?:\([\w ]+\))? )?(?:const |async |unsafe )*fn \w+\s*(?:<[^>]*>)?\(/,
    { rust: 4 },
  ],
  [/\blet mut \w+|&mut \w|&'?\w*\s*str\b/, { rust: 3 }],
  [/^\s*impl\b|^\s*(?:pub )?(?:struct|enum|trait|mod) \w+/, { rust: 2 }],
  [/^\s*(?:pub )?use (?:std|crate|super|self|\w+)::/, { rust: 3 }],
  [
    /\b(?:println|eprintln|format|vec|panic|assert_eq|write|writeln)!\(|^\s*#!?\[\w+/,
    { rust: 3 },
  ],
  [
    /\.unwrap\(\)|\bSome\(|\bOk\(|\bErr\(|-> (?:Result|Option|Self|&?str|u\d+|i\d+|usize)\b|\bmatch \w[\w.]* \{/,
    { rust: 1.5 },
  ],

  // PHP (a paste that opens with <?php is decided earlier)
  [/\$this->|^\s*namespace [\w\\]+;|^\s*use [A-Z]\w*\\[\w\\]+;/, { php: 4 }],
  [/\$\w+\s*=[^=>]/, { php: 1 }],

  // SQL, in any case. A lowercase select needs code punctuation, so a
  // sentence such as "select a file from the list" doesn't count.
  [/^\s*SELECT\b.*\bFROM\b/, { sql: 4 }],
  [/^\s*select\s+(?:\*|[\w.]+\s*,|\w+\()/, { sql: 3 }],
  [/^\s*select\s+(?:\*|[\w.]+\s*,|\w+\().*\bfrom [\w."]+/, { sql: 1.5 }],
  [
    /^\s*(?:from|where|(?:left |inner )?join|order by|group by) [\w."]/,
    { sql: 1.5 },
  ],
  [
    /^\s*(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|DATABASE|SCHEMA|EXTENSION|TYPE|FUNCTION|TRIGGER|SEQUENCE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[\w."`]+\s*(?:\(|;|$|AS\b|ON\b|ADD\b|RENAME\b|DROP\b|ALTER\b)/i,
    { sql: 5 },
  ],
  [
    /^\s*(?:INSERT\s+INTO\s+[\w."`]+\s*(?:\(|VALUES\b|SELECT\b|$)|DELETE\s+FROM\s+[\w."`]+\s*(?:WHERE\b|;|$)|UPDATE\s+[\w."`]+\s+SET\s)/i,
    { sql: 5 },
  ],
  [
    /^\s*(?:SELECT|FROM|WHERE|GROUP BY|ORDER BY|(?:LEFT |RIGHT |INNER |OUTER )?JOIN|HAVING|LIMIT|VALUES|RETURNING|UNION)\b/,
    { sql: 1.5 },
  ],
  [
    /\b(?:PRIMARY KEY|FOREIGN KEY|REFERENCES|NOT NULL|VARCHAR|BIGINT|TIMESTAMPTZ?|SERIAL|BEGIN;|COMMIT;)/i,
    { sql: 2 },
  ],
  [/^\s*--\s/, { sql: 0.5 }],

  // YAML. A key line that ends a statement belongs to another language.
  [/^\s*[\w.-]+:\s*$/, { yaml: 1 }],
  [/^\s*[\w.-]+: [^\s;{(][^;{]*$/, { yaml: 1 }],
  [/^\s*- [\w.-]+: /, { yaml: 2 }],
  [/^\s*- ["'\w$./]/, { yaml: 0.5, markdown: 0.5 }],
  [/^---\s*$/, { yaml: 1 }],

  // TOML and INI. TOML values are typed; INI values are bare text, and a
  // `.env` file is a list of NAME=value lines.
  [/^\s*\[\[[\w.-]+\]\]\s*$/, { toml: 5 }],
  [/^\s*\[[\w. "-]+\]\s*$/, { toml: 2, ini: 2 }],
  [
    /^\s*[\w.-]+ = (?:"[^"]*"|'[^']*'|\[.*\]|\{.*\}|\[)\s*(?:#.*)?$/,
    { toml: 2 },
  ],
  [/^\s*[\w.-]+\s*=\s*(?:-?\d[\d_.]*|true|false)\s*$/, { toml: 0.5, ini: 0.5 }],
  [/^\t?[\w.-]+\s*=\s*[^\s"'[{(\d-][^=;(){}[\]]*$/, { ini: 2 }],
  [/^[A-Za-z][\w.-]*=(?:"[^"]*"|'[^']*'|\S*)$/, { ini: 2 }],
  [/^\s*;/, { ini: 1 }],

  // Shell
  [/^\s*\$ \S/, { shell: 4 }],
  [/^\s*sudo \S/, { shell: 4 }],
  [new RegExp(`^\\s*${COMMAND}(?: |$)`), { shell: 2 }],
  // A command with options
  [new RegExp(`^\\s*(?:sudo )?${COMMAND} .*\\s--?[a-zA-Z]`), { shell: 1.5 }],
  [/^\s*export [A-Za-z_]\w*=/, { shell: 3 }],
  // Any command given an option, a path or a redirect
  [
    /^\s*(?!(?:return|if|while|for|const|let|var|else|case|yield|await|throw|print)\b)[a-z][\w.-]*(?: [^\s=(){};]+)* (?:-{1,2}[a-zA-Z][\w-]*|>>?|\||[~.]?\/[\w./-]*)(?: |$)/,
    { shell: 2 },
  ],
  [
    /^\s*(?:if|elif) \[\[? .*\]\]?;?\s*(?:then)?\s*$|^\s*(?:fi|done|esac|then|do)\s*;?\s*$/,
    { shell: 4 },
  ],
  [/^\s*(?:for \w+ in .+|while .+); do\s*$/, { shell: 4 }],
  [
    /^\s*set -[euxo]|2>&1|>\s*\/dev\/null|\$\([a-z][\w-]*[\s)]|"\$\{?\w+\}?"/,
    { shell: 1.5 },
  ],
  [
    /\|\s*(?:grep|sed|awk|xargs|sort|uniq|head|tail|wc|tee|jq|bash|sh|sudo)\b/,
    { shell: 2 },
  ],
  [/^\s*[\w-]+\(\)\s*\{\s*$/, { shell: 2 }],

  // CSS and the languages built on it
  // A one-line rule
  [/^\s*[.#:@a-z][^{};=]*\{[^{}]*:[^{}]*;?\s*\}\s*$/, { css: 3 }],
  [
    /^\s*(?:[.#:*[@&>][^{};=]*|(?!(?:class|interface|enum|struct|impl|trait|mod|namespace|else|try|do|finally|switch|object|type|union|extern|module|package|export|const|let|var|static|pub|public|private|protected|abstract|final|async|default|return|loop|unsafe|match|select|func|fn|if|for|while|function)\b)[a-z][^{};=()]*)\{\s*$/,
    { css: 1 },
  ],
  [
    /^\s*(?:color|background(?:-[\w-]+)?|margin(?:-\w+)?|padding(?:-\w+)?|border(?:-[\w-]+)?|font(?:-\w+)?|display|position|width|height|max-width|min-width|max-height|min-height|top|left|right|bottom|flex(?:-\w+)?|grid(?:-[\w-]+)?|align-items|justify-content|gap|z-index|opacity|transition|transform|box-shadow|text-\w+|line-height|cursor|overflow|content|outline)\s*:\s*[^;]+;\s*$/,
    { css: 2 },
  ],
  [/^\s*-?[a-z]+-[a-z-]+\s*:\s*[^;]+;\s*$|^\s*--[\w-]+\s*:/, { css: 1.5 }],
  [
    /!important\b|^\s*@(?:media|font-face|keyframes|supports|import|charset)\b/,
    { css: 2 },
  ],
  [/^\s*&/, { css: 1 }],
  [/^\s*\$[\w-]+\s*:.*;\s*$/, { scssOnly: 3 }],
  [
    /^\s*@(?:mixin|include|extend|use|forward|each|function|return|if|else)\b/,
    { scssOnly: 3 },
  ],
  [/#\{/, { scssOnly: 2 }],
  [/^\s*@[\w-]+\s*:[^;]*;\s*$/, { lessOnly: 3 }],
  [
    /^\s*\.[\w-]+\([^)]*\);\s*$|^\s*\.[\w-]+\([^)]*\)\s*(?:when\b[^{]*)?\{\s*$|@\{\w+\}/,
    { lessOnly: 3 },
  ],
  [/^=[\w-]+\s*(?:\(.*\))?\s*$/, { sassOnly: 4 }],
  [/^\s*\+[\w-]+\s*(?:\(.*\))?\s*$/, { sassOnly: 3 }],
  [/^\s*\$[\w-]+\s*:\s*[^;{]+$/, { sassOnly: 2 }],

  // Markdown (headings are counted in `score`)
  [/\[[^\]]+\]\([^)\s]+\)/, { markdown: 2 }],
  [/^\s*(?:[-*+]|\d{1,3}\.) (?:\[[ xX]\] )?\S/, { markdown: 1 }],
  [/\*\*[^*]+\*\*|__[^_]+__/, { markdown: 1 }],
  [/`[^`]+`/, { markdown: 0.5 }],
  [/^ {0,3}> /, { markdown: 1 }],
  [/^\|.*\|\s*$/, { markdown: 1 }],
  [/^\|?\s*:?-{3,}:?\s*\|/, { markdown: 3 }],

  // WebAssembly text
  [/^\s*\(module\b/, { wasm: 8 }],
  [/^\s*\(func\b/, { wasm: 4 }],
  [
    /\((?:func|param|result|local|export|import|memory|i32\.|i64\.|f32\.|f64\.)/,
    { wasm: 2 },
  ],
  [/^\s*(?:local|global|i32|i64|f32|f64|memory|table)\.[a-z]/, { wasm: 2 }],

  // JSON that doesn't parse, such as JSON with comments
  [/^\s*"[^"]*"\s*:\s*/, { json: 1 }],
]

/** A line that opens or closes a Markdown code block. */
const FENCE = /^ {0,3}(?:```|~~~)/

/** Lines that start like a log entry: a timestamp or a level. */
const LOG_LINE =
  /^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\[?\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2}|\d{1,3}(?:\.\d{1,3}){3} - |\d{10,13}\s|\[?(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|SEVERE)\]?[\s:]|(?:time|ts|level)=|npm (?:ERR!|WARN))/

/** A frame of a JavaScript, Java or C# stack trace. */
const STACK_FRAME = /^\s+at \S/
const TRACE_START =
  /^(?:Traceback \(most recent call last\):|\s+File ".*", line \d+|Exception in thread |Caused by: |goroutine \d+ \[|thread '.*' panicked at )/

/** A sentence: words and ordinary punctuation, no code symbols. */
const PROSE = /^[A-Za-z"'(][^{};=<>|$`\\[\]]*$/
const KEY_VALUE = /^[\w.-]+: /
/** A word of a sentence, with the punctuation around it. */
const WORD = /^[("'“]?[A-Za-z][A-Za-z'’-]*[.,!?;:)"”]*$/

/** Whether a line reads as a sentence: mostly plain words, not commands. */
function isProse(line: string) {
  if (!PROSE.test(line) || KEY_VALUE.test(line)) return false
  const words = line.trim().split(/\s+/)
  if (words.length < 6) return false
  return words.filter((word) => WORD.test(word)).length >= words.length * 0.75
}

/** The program on a `#!` line, and the one `env` runs. */
const SHEBANG = /^#!\s*(?:\S*\/)?([\w.-]+)(?:\s+(?:-\S+\s+)*([\w.-]+))?/

/** What a known interpreter on a `#!` line runs; others are plain text. */
function shebangLanguage(line: string): Language | null {
  const match = SHEBANG.exec(line)
  if (!match) return null
  const program = (match[1] === 'env' ? match[2] : match[1]) ?? ''
  if (/^(?:ba|z|da|k|a)?sh$/.test(program)) return 'shell'
  if (/^python[\d.]*$/.test(program)) return 'python'
  if (/^(?:node|nodejs|deno|bun)$/.test(program)) return 'javascript'
  if (/^php[\d.]*$/.test(program)) return 'php'
  return 'text'
}

/** Whether the text is a JSON object or array. */
function isJson(text: string, head: string) {
  if (!/^[[{]/.test(head)) return false
  if (text.length > MAX_PARSE)
    // Too long to parse on every keystroke: trust a JSON-shaped start.
    return /^(?:\{\s*(?:"|\})|\[\s*(?:[[{"\d\]-]|true|false|null))/.test(head)
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The tags HTML has; markup made of others is XML. */
const HTML_TAGS = new Set(
  (
    'html head body title meta link script style div span p a ul ol li img ' +
    'br hr h1 h2 h3 h4 h5 h6 section article main nav header footer aside ' +
    'form input button label select option textarea table thead tbody tr ' +
    'td th strong em b i code pre blockquote figure figcaption video audio ' +
    'source canvas iframe template slot noscript small sup sub details summary'
  ).split(' ')
)

/** HTML, XML or JSX for text that opens with a tag, or null if unsure. */
function markupLanguage(head: string): Language | null {
  const start = head.slice(0, 256).toLowerCase()
  if (/^<!doctype html|^<html[\s>]/.test(start)) return 'html'
  if (/^<\?xml|^<svg[\s>]|^<!doctype (?!html)/.test(start)) return 'xml'
  if (!start.startsWith('<')) return null
  let html = 0
  let other = 0
  for (const [, name] of head.matchAll(/<\/?([A-Za-z][\w:.-]*)/g))
    if (HTML_TAGS.has(name.toLowerCase())) html++
    else other++
  if (html + other < 2) return null
  if (/\bclassName=|\s[a-z]\w*=\{/.test(head)) return 'jsx'
  return html >= other * 2 ? 'html' : 'xml'
}

const UNIFIED_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/
const DIFF_LINE =
  /^(?:[ +\-@\\]|diff |index |new file|deleted file|similarity|rename |old mode|new mode|Binary files|From |Subject:|Date:)/

/** Whether the lines are a unified diff or a patch. */
function isDiff(lines: readonly string[]) {
  let hunk = false
  let header = false
  let shaped = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (UNIFIED_HUNK.test(line)) hunk = true
    if (
      line.startsWith('diff --git ') ||
      (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ '))
    )
      header = true
    if (DIFF_LINE.test(line)) shaped++
  }
  return (hunk || header) && shaped >= lines.length * 0.7
}

/** Whether the lines are a log, a stack trace or ordinary writing. */
function isPlainText(lines: readonly string[]) {
  let logs = 0
  let frames = 0
  let prose = 0
  for (const line of lines) {
    if (TRACE_START.test(line)) return true
    if (LOG_LINE.test(line)) logs++
    else if (STACK_FRAME.test(line)) frames++
    else if (isProse(line)) prose++
  }
  const count = lines.length
  return (
    logs >= count * 0.4 ||
    frames >= Math.max(2, count * 0.25) ||
    logs + frames >= count * 0.6 ||
    // Mostly sentences, unless Markdown structures them.
    prose >= count * 0.6
  )
}

const HEADING = /^ {0,3}#{1,6} \S/

/**
 * Adds up each rule's matching lines. Lines inside Markdown code blocks are
 * left out, since the code there doesn't make the paste that language. A
 * heading has blank lines around it, which tells it from a `# comment` above
 * a line of code.
 */
function score(raw: readonly string[]) {
  const scores = new Map<Key, number>()
  const add = (key: Key, value: number) =>
    scores.set(key, (scores.get(key) ?? 0) + value)
  const counts = new Array<number>(RULES.length).fill(0)
  let fenced = false
  let fences = 0
  let headings = 0
  // A document that opens with a title is almost always Markdown.
  const opening = raw.findIndex((line) => line.trim())
  const title =
    /^#{1,2} \S/.test(raw[opening] ?? '') && !raw[opening + 1]?.trim()
  raw.forEach((line, at) => {
    if (!line.trim()) return
    if (FENCE.test(line)) {
      fenced = !fenced
      fences++
      return
    }
    if (fenced) return
    if (HEADING.test(line) && !raw[at - 1]?.trim() && !raw[at + 1]?.trim())
      headings++
    RULES.forEach(([pattern, weights], index) => {
      if (counts[index] >= RULE_CAP || !pattern.test(line)) return
      counts[index]++
      for (const [key, value] of Object.entries(weights)) add(key as Key, value)
    })
  })
  add(
    'markdown',
    3 * Math.min(fences, 4) + 3 * Math.min(headings, 4) + (title ? 2 : 0)
  )
  return scores
}

/** The text's lines within the reading limits. */
function linesOf(text: string) {
  return text
    .slice(0, MAX_CHARS)
    .split('\n', MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE).trimEnd())
}

/**
 * The language pasted text most likely is, or `text` for prose, logs, stack
 * traces and anything without clear signs.
 */
export function detectLanguage(text: string): Language {
  // Only the start is read, however long the paste.
  const head = text.trimStart().slice(0, MAX_CHARS).trimEnd()
  if (!head) return 'text'
  if (isJson(text, head)) return 'json'
  if (head.startsWith('#!'))
    return shebangLanguage(head.split('\n', 1)[0]) ?? 'text'
  if (
    head.startsWith('<?php') ||
    (head.startsWith('<') && head.includes('<?php'))
  )
    return 'php'
  if (/^<!doctype html/i.test(head)) return 'html'

  const raw = linesOf(head)
  const lines = raw.filter((line) => line.trim())
  if (lines.length < 2 && head.replace(/\s/g, '').length < 20) return 'text'

  const markup = markupLanguage(head)
  if (markup) return markup
  if (isDiff(lines)) return 'diff'

  const scores = score(raw)
  const get = (key: Key) => scores.get(key) ?? 0
  if (isPlainText(lines) && get('markdown') < 4) return 'text'

  // Families compete as one, then the strongest member is picked.
  const js = get('javascript') + get('tsOnly') + get('jsxOnly')
  const cFamily = get('c') + Math.max(get('cOnly'), get('cppOnly'))
  const css =
    get('css') + Math.max(get('scssOnly'), get('lessOnly'), get('sassOnly'))
  // JSON that didn't parse, as with comments or trailing commas.
  scores.set('json', get('json') + (/^[[{]/.test(head) ? 3 : 0))
  const candidates: [Language, number][] = [
    ['javascript', js],
    ['c', cFamily],
    ['css', css],
    ...(
      [
        'python',
        'java',
        'go',
        'rust',
        'php',
        'sql',
        'yaml',
        'toml',
        'ini',
        'shell',
        'markdown',
        'wasm',
        'json',
      ] as const
    ).map((key): [Language, number] => [key, get(key)]),
  ]
  candidates.sort((a, b) => b[1] - a[1])
  const [[winner, best], [, runnerUp]] = candidates

  // One line needs one strong sign; longer text needs several.
  const minimum = lines.length <= 2 ? 3.5 : lines.length <= 8 ? 5 : 6
  if (best < minimum || best < runnerUp * 1.3 || best - runnerUp < 2)
    return 'text'

  switch (winner) {
    case 'javascript': {
      const typed = get('tsOnly') >= 4
      const jsx = get('jsxOnly') >= 4
      return typed ? (jsx ? 'tsx' : 'typescript') : jsx ? 'jsx' : 'javascript'
    }
    case 'c':
      return get('cppOnly') >= 3 ? 'cpp' : 'c'
    case 'css': {
      const braces = lines.some((line) => /[{;]\s*$/.test(line))
      if (!braces && get('sassOnly') >= 4) return 'sass'
      if (get('scssOnly') >= 3 && get('scssOnly') >= get('lessOnly'))
        return 'scss'
      if (get('lessOnly') >= 3) return 'less'
      return 'css'
    }
    default:
      return winner
  }
}

/** Lowercase ASCII words joined by hyphens, at most 48 characters. */
function slug(title: string) {
  return (
    title
      .normalize('NFKD')
      // The accents NFKD splits off, so é becomes e rather than a break.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&[#\w]+;/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 48)
      .replace(/^-+|-+$/g, '')
  )
}

/** A Markdown document's first level 1 or 2 heading, outside code blocks. */
function markdownTitle(text: string) {
  let fenced = false
  for (const line of text.slice(0, MAX_CHARS).split('\n', MAX_LINES)) {
    if (FENCE.test(line)) fenced = !fenced
    const heading = !fenced && /^ {0,3}#{1,2}[ \t]+(.+)$/.exec(line)
    if (heading) return heading[1].replace(/[ \t]#+\s*$/, '')
  }
  return ''
}

/** An HTML document's `<title>`. */
function htmlTitle(text: string) {
  return (
    /<title[^>]*>([^<]*)<\/title>/i.exec(text.slice(0, MAX_CHARS))?.[1] ?? ''
  )
}

/**
 * The name a paste without a typed name is saved under: a document's own
 * title where it has one, so `# Release notes` saves as `release-notes.md`,
 * and otherwise `paste` with the language's extension.
 */
export function suggestPasteName(text: string, language: Language): string {
  const extension = languageExtension(language)
  const title =
    language === 'markdown'
      ? markdownTitle(text)
      : language === 'html'
        ? htmlTitle(text)
        : ''
  return `${slug(title) || 'paste'}.${extension}`
}

/**
 * An administrator's custom CSS and head HTML, as every page receives them.
 * Browser-safe.
 */

// Rules whose blocks hold rules, so their style rules are rewritten too.
// Any other at-rule, such as @font-face or @keyframes, holds descriptors or
// keyframes, where `!important` is invalid or ignored: it is kept as written.
const GROUP_RULES = new Set([
  'container',
  'document',
  '-moz-document',
  'layer',
  'media',
  'scope',
  'starting-style',
  'supports',
])
// Deeper nesting than any real stylesheet is kept as written.
const MAX_DEPTH = 32
const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const AT_RULE = /@([\w-]+)/y

function isSpace(char: string | undefined) {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  )
}

function isComment(css: string, i: number) {
  return css[i] === '/' && css[i + 1] === '*'
}

/** Where an unquoted `url(` that starts at `i` ends, or -1 for any other `(`. */
function unquotedUrlEnd(css: string, i: number) {
  if (!/(?:^|[^\w-])url$/i.test(css.slice(Math.max(0, i - 4), i))) return -1
  let j = i + 1
  while (isSpace(css[j])) j++
  if (css[j] === '"' || css[j] === "'") return -1
  for (; j < css.length; j++) {
    if (css[j] === '\\') j++
    else if (css[j] === ')') return j + 1
  }
  return css.length
}

/**
 * Where the token or bracketed group that starts at `i` ends: a comment, a
 * string, an escape, a `url()`, or a `()`, `[]` or `{}` group with everything
 * inside it. `closed` is false when the input ends first.
 */
function scan(css: string, i: number): { end: number; closed: boolean } {
  const closers: string[] = []
  do {
    const char = css[i]
    const urlEnd = char === '(' ? unquotedUrlEnd(css, i) : -1
    if (isComment(css, i)) {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 2
    } else if (char === '"' || char === "'") {
      let j = i + 1
      // An unescaped line break ends a string, as it does for the browser.
      while (j < css.length && css[j] !== char && css[j] !== '\n')
        j += css[j] === '\\' ? 2 : 1
      i = css[j] === char ? j + 1 : j
    } else if (char === '\\') {
      i += 2
    } else if (urlEnd !== -1) {
      i = urlEnd
    } else if (OPENERS[char]) {
      closers.push(OPENERS[char])
      i++
    } else {
      if (char === closers.at(-1)) closers.pop()
      i++
    }
  } while (closers.length > 0 && i < css.length)
  return { end: Math.min(i, css.length), closed: closers.length === 0 }
}

/** The first index from `i` that isn't white space or part of a comment. */
function significant(css: string, i: number, end: number) {
  while (i < end && (isSpace(css[i]) || isComment(css, i)))
    i = isComment(css, i) ? scan(css, i).end : i + 1
  return i
}

/** A declaration made `!important`, unless it already is or isn't one. */
function important(declaration: string) {
  let valueEnd = 0
  let colon = false
  for (let i = 0; i < declaration.length;) {
    const { end } = scan(declaration, i)
    if (!isSpace(declaration[i]) && !isComment(declaration, i)) {
      colon ||= declaration[i] === ':'
      valueEnd = end
    }
    i = end
  }
  const value = declaration.slice(0, valueEnd)
  if (!colon || /!\s*important$/i.test(value)) return declaration
  return `${value} !important${declaration.slice(valueEnd)}`
}

/**
 * Rewrites the items between `start` and `end`: style rules and at-rules, or
 * with `declarations`, the contents of a style rule.
 */
function rewrite(
  css: string,
  start: number,
  end: number,
  declarations: boolean,
  depth: number
): string {
  let out = ''
  let i = start
  while (i < end) {
    const first = significant(css, i, end)
    let j = first
    while (j < end && css[j] !== ';' && css[j] !== '{') j = scan(css, j).end
    const head = css.slice(i, Math.min(j, end))
    AT_RULE.lastIndex = first
    const atRule = AT_RULE.exec(css)?.[1]
    // A custom property may hold a `{}` block; it is still a declaration.
    const customProperty = declarations && /^--[^:]*:/.test(css.slice(first, j))
    if (j < end && css[j] === '{' && !customProperty) {
      const block = scan(css, j)
      const inner = block.closed ? block.end - 1 : block.end
      const nested =
        atRule === undefined || GROUP_RULES.has(atRule.toLowerCase())
      out +=
        nested && depth < MAX_DEPTH
          ? `${head}{${rewrite(css, j + 1, inner, declarations || atRule === undefined, depth + 1)}${block.closed ? '}' : ''}`
          : css.slice(i, block.end)
      i = block.end
      continue
    }
    if (customProperty) while (j < end && css[j] !== ';') j = scan(css, j).end
    const item = css.slice(i, Math.min(j, end))
    out += declarations && atRule === undefined ? important(item) : item
    if (j < end) out += ';'
    i = j + 1
  }
  return out
}

/**
 * Custom CSS as pages receive it. Every declaration of its style rules,
 * including those inside @media, @supports, @container and @layer blocks, is
 * made `!important`, so it wins over Flare's own styles whatever their
 * specificity. Everything else arrives as written: strings, comments,
 * `url()` values, @import and @font-face rules, and keyframes.
 */
export function customStylesheet(css: string): string {
  return rewrite(css, 0, css.length, false, 0)
}

/** The elements a page head may hold. */
const HEAD_TAGS = [
  'base',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title',
] as const

export type HeadTag = (typeof HEAD_TAGS)[number]

export interface HeadElement {
  tag: HeadTag
  /** Its attributes, named as React names them. */
  props: Record<string, string | true>
  /** What the element holds, as written; the text of a title. */
  content?: string
}

const VOID_TAGS = new Set(['base', 'link', 'meta'])
// Elements taken whole, up to their end tag, because what they hold isn't
// markup or isn't the page's own: a script in an SVG or an iframe is not one
// for the head. Those that aren't head elements are left out whole.
const WHOLE_TAGS = new Set([
  'iframe',
  'math',
  'noembed',
  'noframes',
  'noscript',
  'script',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'xmp',
])
// HTML attribute names React spells differently.
const REACT_NAMES: Record<string, string> = {
  charset: 'charSet',
  class: 'className',
  crossorigin: 'crossOrigin',
  fetchpriority: 'fetchPriority',
  hreflang: 'hrefLang',
  'http-equiv': 'httpEquiv',
  imagesizes: 'imageSizes',
  imagesrcset: 'imageSrcSet',
  itemid: 'itemID',
  itemprop: 'itemProp',
  itemref: 'itemRef',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  nomodule: 'noModule',
  referrerpolicy: 'referrerPolicy',
  tabindex: 'tabIndex',
}
// React treats these as true or false; in HTML, being present means true.
const BOOLEAN_PROPS = new Set([
  'async',
  'defer',
  'disabled',
  'hidden',
  'itemScope',
  'noModule',
])
const CHARACTERS: Record<string, string> = {
  amp: '&',
  AMP: '&',
  apos: "'",
  gt: '>',
  GT: '>',
  lt: '<',
  LT: '<',
  nbsp: '\u00a0',
  quot: '"',
  QUOT: '"',
}

function decode(text: string) {
  return text.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (reference, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return CHARACTERS[name] ?? reference
      const code = decimal ? Number(decimal) : parseInt(hex!, 16)
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '\ufffd'
    }
  )
}

/** The attributes of the tag whose name ends at `i`, and where the tag ends. */
function readAttributes(html: string, i: number) {
  const attributes = new Map<string, string>()
  while (i < html.length) {
    while (isSpace(html[i]) || html[i] === '/') i++
    if (i >= html.length || html[i] === '>') break
    let j = i + 1
    while (j < html.length && !/[\s/>=]/.test(html[j])) j++
    const name = html.slice(i, j).toLowerCase()
    i = j
    while (isSpace(html[i])) i++
    let value = ''
    if (html[i] === '=') {
      i++
      while (isSpace(html[i])) i++
      const quote = html[i]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1)
        value = html.slice(i + 1, close === -1 ? html.length : close)
        i = close === -1 ? html.length : close + 1
      } else {
        j = i
        while (j < html.length && !/[\s>]/.test(html[j])) j++
        value = html.slice(i, j)
        i = j
      }
    }
    // As in browsers, the first of two same-named attributes counts.
    if (!attributes.has(name)) attributes.set(name, decode(value))
  }
  return { attributes, end: Math.min(i + 1, html.length) }
}

function reactProps(attributes: Map<string, string>) {
  const props: Record<string, string | true> = {}
  for (const [name, value] of attributes) {
    // React renders none of these from text: event handlers need functions
    // and `style` an object, and the others are its own.
    if (/^on/.test(name) || ['children', 'key', 'ref', 'style'].includes(name))
      continue
    const prop = REACT_NAMES[name] ?? name
    props[prop] = BOOLEAN_PROPS.has(prop) || value
  }
  return props
}

/**
 * The head elements in custom head HTML, in order: base, link, meta,
 * noscript, script, style, template and title. Anything else, such as text
 * or a `div`, would end the head, so it is left out; head elements inside it
 * are kept.
 */
export function headElements(html: string): HeadElement[] {
  const elements: HeadElement[] = []
  let i = 0
  while (i < html.length) {
    const open = html.indexOf('<', i)
    if (open === -1) break
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    const tag = /^<([a-z][^\s/>]*)/i.exec(html.slice(open, open + 100))
    if (!tag) {
      // An end tag, a doctype, or a `<` in text.
      const end = /[/!?]/.test(html[open + 1] ?? '')
        ? html.indexOf('>', open)
        : open
      i = end === -1 ? html.length : end + 1
      continue
    }
    const name = tag[1].toLowerCase()
    if (name === 'plaintext') break
    const { attributes, end } = readAttributes(html, open + tag[0].length)
    i = end
    let content: string | undefined
    if (WHOLE_TAGS.has(name)) {
      const endTag = new RegExp(`</${name}(?=[\\s/>]|$)`, 'gi')
      endTag.lastIndex = i
      const close = endTag.exec(html)?.index ?? html.length
      content = html.slice(i, close)
      i = html.indexOf('>', close) + 1 || html.length
    }
    if (!(HEAD_TAGS as readonly string[]).includes(name)) continue
    elements.push({
      tag: name as HeadTag,
      props: reactProps(attributes),
      ...(VOID_TAGS.has(name)
        ? {}
        : {
            content: name === 'title' ? decode(content ?? '') : (content ?? ''),
          }),
    })
  }
  return elements
}

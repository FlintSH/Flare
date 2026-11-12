/**
 * The text of an embed is written as templates: plain text with
 * `{{placeholder}}` fields that each file fills in. Browser-safe, so the
 * settings preview renders exactly what a crawler is sent.
 */
export const EMBED_PLACEHOLDERS = [
  { key: 'filename', label: 'File name' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Type' },
  { key: 'uploader', label: 'Uploader' },
  { key: 'date', label: 'Upload date' },
  { key: 'views', label: 'Views' },
  { key: 'instanceName', label: 'Instance name' },
] as const

export type EmbedPlaceholder = (typeof EMBED_PLACEHOLDERS)[number]['key']
export type EmbedValues = Record<EmbedPlaceholder, string>

const KEYS: readonly string[] = EMBED_PLACEHOLDERS.map(({ key }) => key)
const FIELD = /\{\{([^{}]+)\}\}/g

export const EMBED_PLACEHOLDER_MESSAGE = `Use only ${EMBED_PLACEHOLDERS.map(
  ({ key }) => `{{${key}}}`
).join(', ')} placeholders`

/** Whether every `{{field}}` names a placeholder and no brace is left over. */
export function isEmbedTemplate(value: string): boolean {
  const rest = value.replace(FIELD, (_match, field: string) =>
    KEYS.includes(field.trim()) ? '' : '{'
  )
  return !/[{}]/.test(rest)
}

// Punctuation that joins fields, which is left dangling when one is empty.
const JOINERS = '\\-–—·•|,;'
const EMPTY_BRACKETS = new RegExp(`[(\\[][\\s${JOINERS}]*[)\\]]`, 'g')
const REPEATED_JOINERS = new RegExp(
  `(\\s*)([${JOINERS}])(?:\\s*[${JOINERS}])+(\\s*)`,
  'g'
)
const OUTER_JOINERS = new RegExp(`^[\\s${JOINERS}]+|[\\s${JOINERS}]+$`, 'g')

// Stands in for a filled field while the text around it is tidied, so the
// tidying never reads a value: a filename keeps its own dashes and brackets.
const FILLED = '\uE000'

function renderLine(line: string, values: EmbedValues, limit: number) {
  const filled: string[] = []
  let empty = 0
  const text = line.replaceAll(FILLED, '').replace(FIELD, (_match, field) => {
    const value = values[String(field).trim() as EmbedPlaceholder] ?? ''
    if (!value) {
      empty++
      return ''
    }
    // No more of a value than the whole line may show, plus one character so
    // a longer one still ends in the ellipsis: names have no length limit of
    // their own, and a line can repeat one many times.
    filled.push(value.slice(0, limit + 1))
    return FILLED
  })
  // Nothing this line was written to show is available.
  if (empty && !filled.length) return ''
  const tidied = empty
    ? text
        .replace(EMPTY_BRACKETS, '')
        .replace(REPEATED_JOINERS, '$1$2$3')
        .replace(OUTER_JOINERS, '')
        .replace(/[ \t]{2,}/g, ' ')
    : text.trim()
  let next = 0
  return tidied.replaceAll(FILLED, () => filled[next++] ?? '')
}

/** `text`, ending in an ellipsis at `limit` characters when it is longer. */
export function cutToLimit(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

/**
 * Fill a template in, at most `limit` characters long. A field can be empty,
 * for example a filename the instance hides: a line whose fields are all
 * empty is left out, and otherwise the brackets and separators around an
 * empty field go with it.
 */
export function renderTemplate(
  template: string,
  values: EmbedValues,
  limit: number
): string {
  return cutToLimit(
    template
      .split(/\r?\n/)
      .map((line) => renderLine(line, values, limit))
      .filter(Boolean)
      .join('\n'),
    limit
  )
}

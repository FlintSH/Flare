import { customAlphabet } from 'nanoid'

import { NAME_WORDS } from './name-words'

/** The longest pattern a profile or an upload can carry. */
export const NAME_TEMPLATE_MAX_LENGTH = 100

// Leaves room for an extension and a collision suffix in a 255-byte filename.
const NAME_MAX_LENGTH = 200

const randomLettersAndDigits = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
)

/** What a pattern's placeholders read. Tests and previews supply their own. */
export interface NameSources {
  /** The original filename without its extension, already safe for a URL. */
  name: string
  now: Date
  chars: (length: number) => string
  words: (count: number) => string[]
}

export function liveNameSources(): Omit<NameSources, 'name'> {
  return {
    now: new Date(),
    chars: (length) => randomLettersAndDigits(length),
    words: (count) =>
      Array.from(
        crypto.getRandomValues(new Uint8Array(count)),
        (byte) => NAME_WORDS[byte]
      ),
  }
}

/** Fixed values, so a preview doesn't change with every keystroke. */
export const sampleNameSources: Omit<NameSources, 'name'> = {
  now: new Date('2026-03-14T09:26:53Z'),
  chars: (length) => 'x7Kp2aQ9mT4vB8nR3wZ6cY1hJ5dF0gLs'.slice(0, length),
  words: (count) =>
    ['amber', 'otter', 'lantern', 'maple', 'comet', 'willow'].slice(0, count),
}

interface Placeholder {
  /** The number a colon may add, such as the 8 in `{random:8}`. */
  count?: { min: number; max: number; unset: number; means: string }
  render: (sources: NameSources, count: number) => string
}

const pad = (value: number) => String(value).padStart(2, '0')

// Dates and times are UTC: the server doesn't know the uploader's time zone.
const PLACEHOLDERS: Record<string, Placeholder> = {
  name: { render: ({ name }) => name },
  random: {
    count: { min: 1, max: 32, unset: 6, means: 'a length' },
    render: ({ chars }, length) => chars(length),
  },
  words: {
    count: { min: 1, max: 6, unset: 3, means: 'a number of words' },
    render: ({ words }, count) => words(count).join('-'),
  },
  date: {
    render: ({ now }) =>
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
  },
  time: {
    render: ({ now }) =>
      `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
  },
  year: { render: ({ now }) => String(now.getUTCFullYear()) },
  month: { render: ({ now }) => pad(now.getUTCMonth() + 1) },
  day: { render: ({ now }) => pad(now.getUTCDate()) },
  hour: { render: ({ now }) => pad(now.getUTCHours()) },
  minute: { render: ({ now }) => pad(now.getUTCMinutes()) },
  second: { render: ({ now }) => pad(now.getUTCSeconds()) },
  timestamp: {
    render: ({ now }) => String(Math.floor(now.getTime() / 1000)),
  },
}

/** Every placeholder as it is typed, in the order the handbook lists them. */
export const NAME_PLACEHOLDERS = Object.keys(PLACEHOLDERS).map(
  (key) => `{${key}}`
)

type Part = string | { placeholder: Placeholder; count: number }

// A placeholder, a run of allowed characters, or one character that is neither.
const PIECE = /\{([^{}]*)\}|([A-Za-z0-9_-]+)|([\s\S])/gu

function readPlaceholder(written: string): Part | { problem: string } {
  const [key, option, ...extra] = written.split(':')
  const placeholder = Object.hasOwn(PLACEHOLDERS, key)
    ? PLACEHOLDERS[key]
    : undefined
  if (!placeholder)
    return {
      problem: `{${written}} is not a placeholder. Use ${NAME_PLACEHOLDERS.join(', ')}.`,
    }
  const { count } = placeholder
  if (option === undefined)
    return { placeholder, count: count ? count.unset : 0 }
  if (!count) return { problem: `{${key}} takes no option.` }
  const value = /^[0-9]{1,3}$/.test(option) ? Number(option) : NaN
  if (extra.length || !(value >= count.min && value <= count.max))
    return {
      problem: `{${key}} takes ${count.means} from ${count.min} to ${count.max}, such as {${key}:${count.unset}}.`,
    }
  return { placeholder, count: value }
}

/** A character a pattern can't hold, named without printing an invisible one. */
function unwelcome(character: string) {
  if (character === ' ') return 'the space'
  return /[\p{C}\p{Z}]/u.test(character)
    ? 'the invisible character'
    : `“${character}”`
}

function read(template: string): Part[] | { problem: string } {
  if (!template) return { problem: 'Enter a name pattern.' }
  if (template.length > NAME_TEMPLATE_MAX_LENGTH)
    return {
      problem: `Name patterns can be at most ${NAME_TEMPLATE_MAX_LENGTH} characters.`,
    }
  const parts: Part[] = []
  for (const [, written, text, other] of template.matchAll(PIECE)) {
    if (text !== undefined) parts.push(text)
    else if (written !== undefined) {
      const part = readPlaceholder(written)
      if (typeof part === 'object' && 'problem' in part) return part
      parts.push(part)
    } else if (other === '{' || other === '}')
      return {
        problem: 'Write each placeholder between one { and one }.',
      }
    else
      return {
        problem: `Name patterns can use letters, digits, hyphens, underscores and placeholders. Remove ${unwelcome(other)}.`,
      }
  }
  return parts
}

/** Why a pattern can't be used, in words for the person who typed it. */
export function nameTemplateProblem(template: string): string | null {
  const parts = read(template)
  return Array.isArray(parts) ? null : parts.problem
}

/**
 * The name a pattern gives one upload, without an extension. Only letters,
 * digits, hyphens and underscores come out, whatever the pattern holds.
 */
export function renderNameTemplate(
  template: string,
  sources: NameSources
): string {
  const parts = read(template)
  if (!Array.isArray(parts)) throw new Error(parts.problem)
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : part.placeholder.render(sources, part.count)
    )
    .join('')
    .slice(0, NAME_MAX_LENGTH)
}

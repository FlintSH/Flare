import { z } from 'zod'

import { hexToHsl } from './theme'

// The classic appearance settings predate the studio. Their values are written
// into the inline <style> and next-themes <script> of every page, so only
// shapes that cannot change the surrounding CSS or HTML are accepted.

export const LEGACY_THEMES = ['dark', 'light', 'system'] as const
export type LegacyTheme = (typeof LEGACY_THEMES)[number]

/** Classic palettes have 19 tokens; leave room without allowing unbounded maps. */
export const MAX_LEGACY_COLORS = 64

const COLOR_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/
const HSL_TRIPLET =
  /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%?\s+(\d{1,3}(?:\.\d+)?)%?$/
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const LEGACY_COLOR_MESSAGE =
  'Classic colors must be HSL values such as 222.2 84% 4.9% or hex colors such as #1e293b.'

export function isLegacyColorKey(key: string): boolean {
  return COLOR_KEY.test(key)
}

/** The canonical `H S% L%` triplet for an HSL triplet or hex color, else null. */
export function legacyColorValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const hsl = HSL_TRIPLET.exec(trimmed)
  if (hsl) {
    const [hue, saturation, lightness] = hsl.slice(1).map(Number)
    if (hue > 360 || saturation > 100 || lightness > 100) return null
    return `${hsl[1]} ${hsl[2]}% ${hsl[3]}%`
  }
  if (!HEX_COLOR.test(trimmed)) return null
  const digits = trimmed.slice(1)
  return hexToHsl(
    '#' +
      (digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits)
  )
}

/** Keep only safe, normalized entries. Never throws, so old saved values cannot break reads. */
export function legacyColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const colors: Record<string, string> = {}
  for (const [key, color] of Object.entries(value)) {
    if (Object.keys(colors).length >= MAX_LEGACY_COLORS) break
    const normalized = legacyColorValue(color)
    if (isLegacyColorKey(key) && normalized) colors[key] = normalized
  }
  return colors
}

export function legacyTheme(value: unknown): LegacyTheme {
  return LEGACY_THEMES.includes(value as LegacyTheme)
    ? (value as LegacyTheme)
    : 'dark'
}

/** Strict validation for submitted classic appearance changes. */
export const legacyAppearanceUpdateSchema = z.object({
  theme: z
    .enum(LEGACY_THEMES, {
      error: 'Choose dark, light, or system for the classic theme.',
    })
    .optional(),
  customColors: z
    .record(z.string(), z.string())
    .superRefine((colors, context) => {
      const entries = Object.entries(colors)
      if (entries.length > MAX_LEGACY_COLORS)
        context.addIssue({
          code: 'custom',
          message: `Classic appearance supports at most ${MAX_LEGACY_COLORS} colors.`,
        })
      for (const [key, color] of entries) {
        if (!isLegacyColorKey(key))
          context.addIssue({
            code: 'custom',
            path: [key],
            message:
              'Classic color names start with a lowercase letter and use only letters and digits.',
          })
        else if (legacyColorValue(color) === null)
          context.addIssue({
            code: 'custom',
            path: [key],
            message: LEGACY_COLOR_MESSAGE,
          })
      }
    })
    .optional(),
})

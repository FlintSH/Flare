import { z } from 'zod'

import { hexToHsl } from './theme'

// The classic appearance settings predate the studio. Their values are written
// into the inline <style> and next-themes <script> of every page, so only
// shapes that cannot change the surrounding CSS or HTML are accepted.

export const LEGACY_THEMES = ['dark', 'light', 'system'] as const
export type LegacyTheme = (typeof LEGACY_THEMES)[number]

/** The original saved classic palette, retained to recognize untouched installations. */
export const ORIGINAL_CLASSIC_PALETTE = {
  background: '222.2 84% 4.9%',
  foreground: '210 40% 98%',
  card: '222.2 84% 4.9%',
  cardForeground: '210 40% 98%',
  popover: '222.2 84% 4.9%',
  popoverForeground: '210 40% 98%',
  primary: '210 40% 98%',
  primaryForeground: '222.2 47.4% 11.2%',
  secondary: '217.2 32.6% 17.5%',
  secondaryForeground: '210 40% 98%',
  muted: '217.2 32.6% 17.5%',
  mutedForeground: '215 20.2% 65.1%',
  accent: '217.2 32.6% 17.5%',
  accentForeground: '210 40% 98%',
  destructive: '0 62.8% 30.6%',
  destructiveForeground: '210 40% 98%',
  border: '217.2 32.6% 17.5%',
  input: '217.2 32.6% 17.5%',
  ring: '212.7 26.8% 83.9%',
}

/** The first higher-contrast defaults, recognized so installations that saved them move on too. */
const LIFTED_CLASSIC_PALETTE = {
  ...ORIGINAL_CLASSIC_PALETTE,
  card: '221.5 52% 9.8%',
  popover: '221.3 42.1% 14.9%',
  secondary: '216.8 30.1% 28.6%',
  muted: '220 33.9% 22.5%',
  mutedForeground: '216.4 23.4% 72.4%',
  accent: '216.8 30.1% 28.6%',
  border: '218 29.9% 26.9%',
  input: '216.6 26.1% 30.8%',
}

/**
 * The default dark palette: a deeper page so panels separate without getting
 * lighter, menus and dialogs one soft step above panels, and separate fills
 * for hover and selection. Lines, quiet fills and secondary text stay close
 * to the original slate.
 */
export const CLASSIC_PALETTE = {
  ...ORIGINAL_CLASSIC_PALETTE,
  background: '220 88.2% 3.3%',
  card: '219.1 74.2% 6.1%',
  popover: '220 65.9% 8%',
  secondary: '219 30.8% 25.5%',
  mutedForeground: '215.3 20.2% 67.1%',
  accent: '218.9 32.7% 22.2%',
  border: '218 30.6% 19.2%',
}

export const SUPERSEDED_CLASSIC_PALETTES = [
  ORIGINAL_CLASSIC_PALETTE,
  LIFTED_CLASSIC_PALETTE,
]

/** Upgrade only a complete untouched earlier default; never rewrite custom colors. */
export function defaultClassicColors(
  colors: Record<string, string>
): Record<string, string> {
  const size = Object.keys(colors).length
  const untouched = SUPERSEDED_CLASSIC_PALETTES.some((palette) => {
    const entries = Object.entries(palette)
    return (
      size === entries.length &&
      entries.every(([key, value]) => colors[key] === value)
    )
  })
  return untouched ? { ...CLASSIC_PALETTE } : colors
}

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

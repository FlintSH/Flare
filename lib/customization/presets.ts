import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from './schema'

export interface PalettePreset {
  /** Primary and focus colour in dark mode. */
  accent: string
  /** Primary and focus colour in light mode. */
  lightAccent: string
  /** Dark page, card and popover colour. */
  background: string
  /** Dark borders, inputs and secondary, muted and accent fills. */
  line: string
  /** Dark secondary text. */
  mutedForeground: string
}

// The dark neutrals keep the default palette's contrast steps (lines about
// 1.4:1 against the page, secondary text about 7:1) in each page's own hue,
// so a violet, teal or warm page doesn't get slate borders and fields.
export const PALETTE_PRESETS = {
  midnight: {
    accent: '#f8fafc',
    lightAccent: '#0f172a',
    background: '#020817',
    line: '#1e293b',
    mutedForeground: '#94a3b8',
  },
  orbit: {
    accent: '#a78bfa',
    lightAccent: '#7c3aed',
    background: '#100d20',
    line: '#312f45',
    mutedForeground: '#a3a1ba',
  },
  tide: {
    accent: '#5eead4',
    lightAccent: '#0f766e',
    background: '#061c20',
    line: '#254146',
    mutedForeground: '#96b1b7',
  },
  ember: {
    accent: '#fdba74',
    lightAccent: '#c2410c',
    background: '#1c1210',
    line: '#45322e',
    mutedForeground: '#b49f9b',
  },
} as const satisfies Record<string, PalettePreset>

/** The light and dark palettes a preset starts from. */
export function presetPalettes(preset: PalettePreset): {
  light: Palette
  dark: Palette
} {
  return {
    light: {
      ...LIGHT_PALETTE,
      primary: preset.lightAccent,
      ring: preset.lightAccent,
    },
    dark: {
      ...DARK_PALETTE,
      background: preset.background,
      card: preset.background,
      popover: preset.background,
      secondary: preset.line,
      muted: preset.line,
      mutedForeground: preset.mutedForeground,
      accent: preset.line,
      border: preset.line,
      input: preset.line,
      primary: preset.accent,
      ring: preset.accent,
    },
  }
}

import {
  type AppearanceDocument,
  DARK_PALETTE,
  LIGHT_PALETTE,
} from '@/lib/customization/schema'

export const SETUP_APPEARANCE_PRESETS = [
  {
    id: 'flare',
    name: 'Flare default',
    description: 'The original, familiar Flare.',
    accent: '#f8fafc',
    lightAccent: '#0f172a',
    background: '#020817',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'A little violet after dark.',
    accent: '#a78bfa',
    lightAccent: '#7c3aed',
    background: '#100d20',
  },
  {
    id: 'tide',
    name: 'Tide',
    description: 'Deep teal, fresh perspective.',
    accent: '#5eead4',
    lightAccent: '#0f766e',
    background: '#061c20',
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'A warm welcome for your files.',
    accent: '#fdba74',
    lightAccent: '#c2410c',
    background: '#1c1210',
  },
] as const

export type SetupAppearancePreset =
  | 'current'
  | (typeof SETUP_APPEARANCE_PRESETS)[number]['id']

export function createSetupAppearance(
  published: AppearanceDocument,
  input: { name: string; tagline: string; preset: SetupAppearancePreset }
): AppearanceDocument {
  const document = structuredClone(published)
  document.brand.name = input.name
  document.brand.tagline = input.tagline

  if (input.preset === 'current') return document
  if (input.preset === 'flare') {
    // Keeping Flare's default must never activate the studio palette.
    document.theme.enabled = false
    return document
  }

  const preset = SETUP_APPEARANCE_PRESETS.find(
    (item) => item.id === input.preset
  )!
  document.theme = {
    ...document.theme,
    enabled: true,
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
      primary: preset.accent,
      ring: preset.accent,
    },
  }
  return document
}

import { PALETTE_PRESETS, presetPalettes } from '@/lib/customization/presets'
import type { AppearanceDocument } from '@/lib/customization/schema'

export const SETUP_APPEARANCE_PRESETS = [
  {
    id: 'flare',
    name: 'Flare default',
    description: 'The original, familiar Flare.',
    ...PALETTE_PRESETS.midnight,
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'A little violet after dark.',
    ...PALETTE_PRESETS.orbit,
  },
  {
    id: 'tide',
    name: 'Tide',
    description: 'Deep teal, fresh perspective.',
    ...PALETTE_PRESETS.tide,
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'A warm welcome for your files.',
    ...PALETTE_PRESETS.ember,
  },
] as const

export type SetupAppearancePreset =
  'current' | (typeof SETUP_APPEARANCE_PRESETS)[number]['id']

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
    ...presetPalettes(preset),
  }
  return document
}

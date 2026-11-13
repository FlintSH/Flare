import { DEFAULT_EMBED_CARD } from '@/lib/embeds/defaults'

import type { AppearanceDocument, Palette } from './schema'

/**
 * Flare's own appearance, apart from the schemas that validate one, so a
 * page that only needs the default doesn't carry the validator.
 */

export const DARK_PALETTE: Palette = {
  background: '#010610',
  foreground: '#f8fafc',
  card: '#040c1b',
  cardForeground: '#f8fafc',
  popover: '#071022',
  popoverForeground: '#f8fafc',
  primary: '#f8fafc',
  primaryForeground: '#0f172a',
  secondary: '#2d3b55',
  secondaryForeground: '#f8fafc',
  muted: '#1e293b',
  mutedForeground: '#9aa8bc',
  accent: '#26334b',
  accentForeground: '#f8fafc',
  destructive: '#991b1b',
  destructiveForeground: '#f8fafc',
  border: '#222d40',
  input: '#1e293b',
  ring: '#cbd5e1',
}

/**
 * Earlier default dark palettes, written out in full so they stay frozen when
 * DARK_PALETTE changes. Add the outgoing palette here whenever the default
 * changes, or themes saved with it keep the old look.
 */
export const SUPERSEDED_DARK_PALETTES: readonly Palette[] = [
  // The first studio default, and Midnight until the contrast work.
  {
    background: '#020817',
    foreground: '#f8fafc',
    card: '#020817',
    cardForeground: '#f8fafc',
    popover: '#020817',
    popoverForeground: '#f8fafc',
    primary: '#f8fafc',
    primaryForeground: '#0f172a',
    secondary: '#1e293b',
    secondaryForeground: '#f8fafc',
    muted: '#1e293b',
    mutedForeground: '#94a3b8',
    accent: '#1e293b',
    accentForeground: '#f8fafc',
    destructive: '#991b1b',
    destructiveForeground: '#f8fafc',
    border: '#1e293b',
    input: '#1e293b',
    ring: '#cbd5e1',
  },
  // The lifted higher-contrast default that the deeper one replaced.
  {
    background: '#020817',
    foreground: '#f8fafc',
    card: '#0c1426',
    cardForeground: '#f8fafc',
    popover: '#162036',
    popoverForeground: '#f8fafc',
    primary: '#f8fafc',
    primaryForeground: '#0f172a',
    secondary: '#33445f',
    secondaryForeground: '#f8fafc',
    muted: '#26334d',
    mutedForeground: '#a8b5c9',
    accent: '#33445f',
    accentForeground: '#f8fafc',
    destructive: '#991b1b',
    destructiveForeground: '#f8fafc',
    border: '#303f59',
    input: '#3a4a63',
    ring: '#cbd5e1',
  },
]

/**
 * Move a saved dark palette that is an untouched earlier default onto the
 * current one. Midnight is the default with the focus ring set to the primary
 * colour, so that ring is recognized and kept. Any other change, even one
 * colour, means the palette was customized and it is returned as saved.
 */
export function defaultDarkPalette(palette: Palette): Palette {
  const keys = Object.keys(palette) as (keyof Palette)[]
  for (const earlier of SUPERSEDED_DARK_PALETTES) {
    const ring = palette.ring.toLowerCase()
    const untouched =
      (ring === earlier.ring || ring === earlier.primary) &&
      keys.every(
        (key) => key === 'ring' || palette[key].toLowerCase() === earlier[key]
      )
    if (untouched)
      return {
        ...DARK_PALETTE,
        ring: ring === earlier.ring ? DARK_PALETTE.ring : DARK_PALETTE.primary,
      }
  }
  return palette
}

export const LIGHT_PALETTE: Palette = {
  background: '#f8fafc',
  foreground: '#0f172a',
  card: '#ffffff',
  cardForeground: '#0f172a',
  popover: '#ffffff',
  popoverForeground: '#0f172a',
  primary: '#0f172a',
  primaryForeground: '#f8fafc',
  secondary: '#e2e8f0',
  secondaryForeground: '#0f172a',
  muted: '#f1f5f9',
  mutedForeground: '#475569',
  accent: '#e2e8f0',
  accentForeground: '#0f172a',
  destructive: '#dc2626',
  destructiveForeground: '#ffffff',
  border: '#cbd5e1',
  input: '#cbd5e1',
  ring: '#64748b',
}

export const DEFAULT_APPEARANCE: AppearanceDocument = {
  brand: {
    name: 'Flare',
    tagline: 'A free, modern, open source file upload platform',
    logoLight: '',
    logoDark: '',
    footerText: 'Flare is a free, open source, self-hostable file host.',
  },
  theme: {
    enabled: false,
    defaultMode: 'dark',
    light: LIGHT_PALETTE,
    dark: DARK_PALETTE,
    radius: 0.75,
    background: 'glow',
    font: 'inter',
  },
  sharing: {
    defaultStyle: 'framed',
    showUploader: true,
    showFilename: true,
    showSize: true,
    showExpiry: true,
    showFooter: null,
    imageFit: 'contain',
    embedMode: 'direct',
    personalEmbeds: true,
    siteNameTemplate: DEFAULT_EMBED_CARD.siteName,
    authorTemplate: DEFAULT_EMBED_CARD.author,
    titleTemplate: DEFAULT_EMBED_CARD.title,
    descriptionTemplate: DEFAULT_EMBED_CARD.description,
    embedColor: DEFAULT_EMBED_CARD.color,
  },
}

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

import type { AppearanceDocument, Palette } from './schema'

export function hexToHsl(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255
  )
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min
  const lightness = (max + min) / 2
  let hue = 0
  if (delta) {
    hue =
      max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  return `${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%`
}

export function paletteVariables(palette: Palette): Record<string, string> {
  return Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [
      `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      hexToHsl(value),
    ])
  )
}

export function themeStyles(document: AppearanceDocument): string {
  const { theme } = document
  const declarations = (palette: Palette) =>
    Object.entries(paletteVariables(palette))
      .map(([key, value]) => `${key}:${value}`)
      .join(';')
  // A personal light preference still needs readable tokens when the instance
  // keeps its original dark palette. Never replace that legacy dark palette.
  if (!theme.enabled) return `.light{${declarations(theme.light)}}`
  const font =
    theme.font === 'mono'
      ? 'ui-monospace,monospace'
      : theme.font === 'system'
        ? 'system-ui,sans-serif'
        : 'var(--font-inter)'
  return `:root,.light{${declarations(theme.light)};--radius:${theme.radius}rem;--flare-font:${font}}.dark{${declarations(theme.dark)}}body,.flare-text{font-family:var(--flare-font)}[data-flare-surface]{border-radius:var(--radius)}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}`
}

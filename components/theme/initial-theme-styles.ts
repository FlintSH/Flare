import { DEFAULT_CONFIG, type FlareConfig } from '@/lib/config'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { themeStyles } from '@/lib/customization/theme'

export function initialThemeStyles(
  config: FlareConfig,
  recovery = false
): string {
  // Older setup flows saved an empty palette. Always keep the original Flare
  // tokens available, including when only a few legacy colors were customized.
  const customColors = {
    ...DEFAULT_CONFIG.settings.appearance.customColors,
    ...(!recovery && config.settings.appearance.customColors),
  }
  const appearance = recovery
    ? {
        ...DEFAULT_APPEARANCE,
        theme: { ...DEFAULT_APPEARANCE.theme, enabled: true },
      }
    : config.settings.customization.published

  const cssVariables = Object.entries(customColors)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      return `--${cssKey}: ${value};`
    })
    .join('\n')

  return `:root {
    ${cssVariables}
    --radius: 0.75rem;
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  }${themeStyles(appearance)}`
}

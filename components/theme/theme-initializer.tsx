import { DEFAULT_CONFIG, getConfig } from '@/lib/config'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { themeStyles } from '@/lib/customization/theme'

export async function ThemeInitializer({
  recovery = false,
}: {
  recovery?: boolean
}) {
  const config = await getConfig()
  const customColors = recovery
    ? DEFAULT_CONFIG.settings.appearance.customColors
    : config.settings.appearance.customColors || {}
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

  return (
    <style
      id="theme-initializer"
      dangerouslySetInnerHTML={{
        __html: `:root {
          ${cssVariables}
          --radius: 0.75rem;
          --chart-1: 220 70% 50%;
          --chart-2: 160 60% 45%;
          --chart-3: 30 80% 55%;
          --chart-4: 280 65% 60%;
          --chart-5: 340 75% 55%;
        }${themeStyles(appearance)}`,
      }}
    />
  )
}

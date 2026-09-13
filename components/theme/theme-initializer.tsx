import { getConfig } from '@/lib/config'

import { initialThemeStyles } from './initial-theme-styles'

export async function ThemeInitializer({
  recovery = false,
}: {
  recovery?: boolean
}) {
  const config = await getConfig()
  return (
    <style
      id="theme-initializer"
      dangerouslySetInnerHTML={{ __html: initialThemeStyles(config, recovery) }}
    />
  )
}

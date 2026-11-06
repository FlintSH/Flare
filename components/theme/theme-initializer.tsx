import { getConfigOrDefaults } from '@/lib/config'

import { initialThemeStyles } from './initial-theme-styles'

export async function ThemeInitializer({
  recovery = false,
}: {
  recovery?: boolean
}) {
  const config = await getConfigOrDefaults()
  return (
    <style
      id="theme-initializer"
      dangerouslySetInnerHTML={{ __html: initialThemeStyles(config, recovery) }}
    />
  )
}

import { getConfig } from '@/lib/config'

function addImportantToCSS(css: string): string {
  // Skip if CSS is empty
  if (!css.trim()) return css

  // Magic regex to handle CSS rules
  return css.replace(
    /([^{};]+):([^{};]+)((?=;|})|$)/g,
    (match, prop, value) => {
      // Strip out any existing !important tags
      const cleanValue = value.replace(/\s*!important\s*/, '').trim()
      // Override anything else with !important
      return `${prop.trim()}: ${cleanValue} !important;`
    }
  )
}

export async function CustomHead() {
  const config = await getConfig()
  const { customCSS, customHead } = config.settings.advanced

  const processedCSS = addImportantToCSS(customCSS)

  return (
    <>
      {customHead && (
        // Put custom head stuff in a div, eventually we will want to change this as next does not like it - but it works.
        <div dangerouslySetInnerHTML={{ __html: customHead }} />
      )}

      {processedCSS && (
        <style
          id="custom-css"
          dangerouslySetInnerHTML={{ __html: processedCSS }}
          data-custom-css="true"
        />
      )}
    </>
  )
}

import { getConfig } from '@/lib/config'

function addImportantToCSS(css: string): string {
  if (!css.trim()) return css

  return css.replace(
    /([^{};]+):([^{};]+)((?=;|})|$)/g,
    (match, prop, value) => {
      const cleanValue = value.replace(/\s*!important\s*/, '').trim()
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
      {customHead && <div dangerouslySetInnerHTML={{ __html: customHead }} />}

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

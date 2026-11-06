import { createElement } from 'react'

import { getConfigOrDefaults } from '@/lib/config'
import {
  type HeadElement,
  customStylesheet,
  headElements,
} from '@/lib/customization/custom-code'

function headNode({ tag, props, content }: HeadElement, key: number) {
  if (content === undefined) return createElement(tag, { ...props, key })
  if (tag === 'title') return createElement(tag, { ...props, key }, content)
  return createElement(tag, {
    ...props,
    key,
    dangerouslySetInnerHTML: { __html: content },
  })
}

export async function CustomHead({ recovery = false }: { recovery?: boolean }) {
  if (recovery) return null
  const config = await getConfigOrDefaults()
  const { customCSS, customHead } = config.settings.advanced
  const css = customStylesheet(customCSS)

  return (
    <>
      {headElements(customHead).map(headNode)}
      {css && (
        <style
          id="custom-css"
          dangerouslySetInnerHTML={{ __html: css }}
          data-custom-css="true"
        />
      )}
    </>
  )
}

import { createElement } from 'react'

import { headers } from 'next/headers'

import { getConfigOrDefaults } from '@/lib/config'
import {
  type HeadElement,
  customStylesheet,
  headElements,
  withScriptNonce,
} from '@/lib/customization/custom-code'
import { NONCE_HEADER } from '@/lib/security/csp'

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
  const nonce = (await headers()).get(NONCE_HEADER)

  return (
    <>
      {headElements(customHead)
        .map((element) => withScriptNonce(element, nonce))
        .map(headNode)}
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

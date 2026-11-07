import { type ComponentProps, createElement } from 'react'

import postcss from 'postcss'
import { renderToStaticMarkup } from 'react-dom/server'
import tailwindcss from 'tailwindcss'
import { expect, it } from 'vitest'

import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'

import config from '../../tailwind.config'

function renderTrigger(
  value: string,
  text?: string,
  triggerProps: ComponentProps<typeof SelectTrigger> & {
    'data-placeholder'?: string
  } = {},
  placeholder = 'Setting'
) {
  return renderToStaticMarkup(
    createElement(
      Select,
      { value },
      createElement(
        SelectTrigger,
        { 'aria-label': 'Account setting', ...triggerProps },
        createElement(SelectValue, { placeholder }, text)
      )
    )
  )
}

function button(markup: string) {
  const tag = markup.match(/<button\b[^>]*>/)?.[0]
  expect(tag).toBeDefined()
  return tag!
}

it('marks only the empty Select prompt as a placeholder', () => {
  const empty = renderTrigger('')
  const selected = renderTrigger('appearance', 'Appearance')

  expect(button(empty)).toContain('data-placeholder=""')
  expect(empty).toContain('>Setting</span>')
  expect(button(selected)).not.toContain('data-placeholder')
  expect(selected).toContain('>Appearance</span>')
})

it('can present a current command destination without changing its empty value', () => {
  const command = renderTrigger(
    '',
    undefined,
    { 'data-placeholder': undefined },
    'Identity'
  )

  expect(button(command)).not.toContain('data-placeholder')
  expect(command).toContain('>Identity</span>')
})

it('applies the dedicated hint color and italic cue only in Radix placeholder state', async () => {
  const markup = renderTrigger('') + renderTrigger('appearance', 'Appearance')
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: markup }],
      plugins: [],
    }),
  ]).process('@tailwind utilities;', { from: undefined })

  const placeholder: Record<string, string> = {}
  result.root.walkRules((rule) => {
    rule.walkDecls((declaration) => {
      if (
        declaration.prop === 'font-style' ||
        declaration.value ===
          'var(--placeholder-text, hsl(var(--muted-foreground)))'
      ) {
        expect(rule.selector).toContain('[data-placeholder]')
        placeholder[declaration.prop] = declaration.value
      }
    })
  })

  expect(placeholder.color).toBe(
    'var(--placeholder-text, hsl(var(--muted-foreground)))'
  )
  expect(placeholder['font-style']).toBe('italic')
})

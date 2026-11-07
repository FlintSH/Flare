import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { expect, it } from 'vitest'

import config from '../../tailwind.config'

it('emits the shared hint role and italic cue on the real placeholder pseudo-element', async () => {
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [
        {
          raw: '<input class="placeholder:text-placeholder placeholder:italic">',
        },
      ],
      plugins: [],
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  const declarations: Record<string, string> = {}
  result.root.walkRules((rule) => {
    if (!rule.selector.endsWith('::placeholder')) return
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value
    })
  })
  expect(declarations.color).toBe(
    'var(--placeholder-text, hsl(var(--muted-foreground)))'
  )
  expect(declarations['font-style']).toBe('italic')
})

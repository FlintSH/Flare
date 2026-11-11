import { type ReactElement, type ReactNode, createElement } from 'react'

import RootLayout from '@/app/layout'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomHead } from '@/components/layout/custom-head'

import { customStylesheet, headElements } from '@/lib/customization/custom-code'

const { advanced, passThrough, nothing } = vi.hoisted(() => ({
  advanced: { customCSS: '', customHead: '' },
  passThrough: ({ children }: { children?: ReactNode }) => children,
  nothing: () => null,
}))

vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'inter-variable', className: 'inter' }),
}))
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  const read = async () => ({
    ...actual.DEFAULT_CONFIG,
    settings: { ...actual.DEFAULT_CONFIG.settings, advanced },
  })
  return { ...actual, getConfig: read, getConfigOrDefaults: read }
})
vi.mock('@/lib/customization/recovery', () => ({
  isAppearanceRecovery: async () => false,
}))
vi.mock('@/lib/setup/status', () => ({ pageSetupStatus: async () => true }))
vi.mock('@/lib/auth/page-session', () => ({
  getRequestSession: async () => null,
}))
vi.mock('@/components/setup/setup-checker', () => ({ SetupChecker: nothing }))
vi.mock('@/components/customization/appearance-provider', () => ({
  AppearanceProvider: passThrough,
}))
vi.mock('@/components/providers/auth-provider', () => ({
  AuthProvider: passThrough,
}))
vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: passThrough,
}))
vi.mock('@/components/theme/theme-provider', () => ({
  ThemeProvider: passThrough,
}))
vi.mock('@/components/theme/theme-initializer', () => ({
  ThemeInitializer: nothing,
}))
vi.mock('@/components/providers/input-modality', () => ({
  InputModality: nothing,
}))
vi.mock('@/components/ui/toaster', () => ({ Toaster: nothing }))

/** The stylesheet with Flare's additions taken out again. */
const unchanged = (css: string) =>
  customStylesheet(css).replaceAll(' !important', '')

beforeEach(() => {
  advanced.customCSS = ''
  advanced.customHead = ''
})

describe('custom CSS', () => {
  it('makes every declaration of a style rule important', () => {
    expect(customStylesheet('body { color: red; background: blue }')).toBe(
      'body { color: red !important; background: blue !important }'
    )
    expect(
      customStylesheet(
        '@media (max-width: 600px) { @supports (display: grid) { .a { --gap: 1rem; display: grid } } }'
      )
    ).toBe(
      '@media (max-width: 600px) { @supports (display: grid) { .a { --gap: 1rem !important; display: grid !important } } }'
    )
    expect(
      customStylesheet(
        '.card { color: red; &:hover { color: blue } @media (hover: hover) { color: green } }'
      )
    ).toBe(
      '.card { color: red !important; &:hover { color: blue !important } @media (hover: hover) { color: green !important } }'
    )
  })

  it('keeps values that hold semicolons or braces whole', () => {
    const data =
      '.logo { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat }'
    expect(customStylesheet(data)).toBe(
      '.logo { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat !important }'
    )
    expect(customStylesheet('.a::after { content: "a;b}" }')).toBe(
      '.a::after { content: "a;b}" !important }'
    )
    expect(customStylesheet('a[title="x;{y}"] { color: red }')).toBe(
      'a[title="x;{y}"] { color: red !important }'
    )
    for (const css of [
      '.a { background: url("data:image/svg+xml;utf8,<svg>;</svg>") }',
      '.a { background: url( https://example.com/a;b.png ) }',
      '/* one; two { three */ .a { color: red }',
    ])
      expect(unchanged(css)).toBe(css)
  })

  it('passes imports, fonts and keyframes through as written', () => {
    for (const css of [
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");',
      '@import url(https://fonts.googleapis.com/css2?family=Roboto:wght@400;700);',
      "@font-face { font-family: Brand; src: url(https://example.com/brand.woff2) format('woff2'); font-display: swap }",
      '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }',
      '@layer base, theme;',
    ])
      expect(customStylesheet(css)).toBe(css)
  })

  it('leaves important declarations and stray text alone', () => {
    for (const css of [
      'p { color: red !important; margin: 0 ! IMPORTANT }',
      'p { color: red /* note */ !important }',
      'color: red',
      '',
      '   ',
    ])
      expect(customStylesheet(css)).toBe(css)
    expect(customStylesheet('p { color: red')).toBe('p { color: red !important')
  })

  it('keeps very deep nesting as written', () => {
    const css = `${'@media all {'.repeat(40)} p { color: red } ${'}'.repeat(40)}`
    expect(customStylesheet(css)).toBe(css)
    expect(customStylesheet('('.repeat(20_000))).toBe('('.repeat(20_000))
  })
})

describe('custom head HTML', () => {
  it('keeps the head elements, in order, with React’s attribute names', () => {
    expect(
      headElements(
        `<!-- analytics -->
        <meta name="google-site-verification" content="abc" />
        <script async src="https://example.com/gtag.js?id=G-1&amp;l=dl"></script>
        <script>window.dataLayer = window.dataLayer || []; if (a < b) document.write("</div>")</script>
        <link rel="preload" as="style" href="/f.css" onload="this.rel='stylesheet'" crossorigin>
        <title>Files &amp; more</title>
        <meta charset=utf-8><meta http-equiv="x-ua-compatible" content="ie=edge" class=one style="color: red">`
      )
    ).toEqual([
      {
        tag: 'meta',
        props: { name: 'google-site-verification', content: 'abc' },
      },
      {
        tag: 'script',
        props: { async: true, src: 'https://example.com/gtag.js?id=G-1&l=dl' },
        content: '',
      },
      {
        tag: 'script',
        props: {},
        content:
          'window.dataLayer = window.dataLayer || []; if (a < b) document.write("</div>")',
      },
      {
        tag: 'link',
        props: { rel: 'preload', as: 'style', href: '/f.css', crossOrigin: '' },
      },
      { tag: 'title', props: {}, content: 'Files & more' },
      { tag: 'meta', props: { charSet: 'utf-8' } },
      {
        tag: 'meta',
        props: {
          httpEquiv: 'x-ua-compatible',
          content: 'ie=edge',
          className: 'one',
        },
      },
    ])
  })

  it('leaves out what would end the head, but not head elements inside it', () => {
    expect(
      headElements(
        '<div class="banner">Hello <meta name="theme-color" content="#000"></div> text <iframe><script>alert(1)</script></iframe><svg><title>Logo</title></svg><noscript><img src="/pixel.gif"></noscript>'
      )
    ).toEqual([
      { tag: 'meta', props: { name: 'theme-color', content: '#000' } },
      { tag: 'noscript', props: {}, content: '<img src="/pixel.gif">' },
    ])
  })
})

describe('custom code on the page', () => {
  it('puts head HTML into the head as its own elements, before the custom CSS', async () => {
    advanced.customHead =
      '<meta name="google-site-verification" content="abc"><script>window.ready = true</script>'
    advanced.customCSS = '.a { background: url(data:image/png;base64,AAAA) }'
    const html = renderToStaticMarkup(await CustomHead({}))
    expect(html).toBe(
      '<meta name="google-site-verification" content="abc"/><script>window.ready = true</script><style id="custom-css" data-custom-css="true">.a { background: url(data:image/png;base64,AAAA) !important }</style>'
    )
    expect(await CustomHead({ recovery: true })).toBeNull()
  })

  it('keeps Inter defined whatever the custom CSS sets, and body text on the studio’s Typeface once it sets a font', async () => {
    const render = async () => {
      const page = await RootLayout({ children: createElement('main') })
      const [, body] = page.props.children as ReactElement<{
        className: string
      }>[]
      expect(body.type).toBe('body')
      return { html: page.props.className, body: body.props.className }
    }
    expect(await render()).toEqual({
      html: 'inter-variable',
      body: 'font-sans min-h-screen flex flex-col',
    })
    advanced.customCSS = 'code { font-family: monospace }'
    expect(await render()).toEqual({
      html: 'inter-variable',
      body: 'min-h-screen flex flex-col',
    })
  })
})

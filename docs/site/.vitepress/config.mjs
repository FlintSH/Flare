import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitepress'
import { getBuildInfo } from '../scripts/build-info.mjs'

let buildInfo
try {
  buildInfo = JSON.parse(
    readFileSync(new URL('../public/build-info.json', import.meta.url), 'utf8')
  )
} catch {
  buildInfo = getBuildInfo()
}

const base = process.env.DOCS_BASE || '/'
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('DOCS_BASE must begin and end with /, for example /flare/.')
}
const group = (text, entries) => ({
  text,
  items: entries.map(([text, link]) => ({ text, link })),
})

export default defineConfig({
  title: 'Flare Docs',
  description:
    'Your files. Your server. Your rules. Learn to share, customize, automate, and self-host Flare.',
  lang: 'en-US',
  base,
  appearance: 'dark',
  lastUpdated: true,
  srcExclude: ['test-results/**', 'playwright-report/**'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }],
    ['meta', { name: 'theme-color', content: '#080d18' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'flare:version', content: buildInfo.version }],
    ...(buildInfo.commit
      ? [['meta', { name: 'flare:commit', content: buildInfo.commit }]]
      : []),
  ],
  markdown: {
    lineNumbers: false,
    theme: { light: 'github-light-high-contrast', dark: 'github-dark' },
  },
  // Do not inherit the application's PostCSS/Tailwind configuration.
  vite: { css: { postcss: { plugins: [] } } },
  themeConfig: {
    buildInfo,
    logo: '/icon.svg',
    siteTitle: 'Flare',
    nav: [
      { text: 'Explore', link: '/features' },
      { text: 'Use Flare', link: '/guide/' },
      { text: 'Self-host', link: '/hosting/' },
      { text: 'API', link: '/api/' },
    ],
    search: { provider: 'local', options: { detailedView: true } },
    outline: { level: [2, 3], label: 'On this page' },
    socialLinks: [
      {
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-4.3 1.3-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.2-1.5 6.2-6.8A5.3 5.3 0 0 0 19 5a4.9 4.9 0 0 0-.1-3.6s-1.2-.4-3.9 1.4a13.4 13.4 0 0 0-7 0C5.3 1 4.1 1.4 4.1 1.4A4.9 4.9 0 0 0 4 5a5.3 5.3 0 0 0-1.3 3.7c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.7V22"/></svg>',
        },
        ariaLabel: 'Flare on GitHub',
        link: 'https://github.com/FlintSH/Flare',
      },
    ],
    editLink: {
      pattern: 'https://github.com/FlintSH/Flare/edit/main/docs/site/:path',
      text: 'Improve this page',
    },
    sidebar: [
      group('Discover', [
        ['Welcome', '/'],
        ['Feature explorer', '/features'],
        ['Interactive demos', '/demos'],
        ['Frequently asked questions', '/faq'],
      ]),
      group('Use Flare', [
        ['Your first steps', '/guide/'],
        ['Upload files', '/guide/uploading'],
        ['Browse & search', '/guide/library'],
        ['Sharing & privacy', '/guide/sharing'],
        ['Folders', '/guide/folders'],
        ['Tags & OCR', '/guide/tags'],
        ['Pastes & code', '/guide/pastes'],
        ['Short links', '/guide/short-links'],
        ['Upload profiles', '/guide/upload-profiles'],
        ['Screenshot tools', '/guide/screenshot-tools'],
        ['Your account', '/guide/account'],
        ['Personal appearance', '/guide/appearance'],
      ]),
      group('Self-host', [
        ['Choose your deployment', '/hosting/'],
        ['Docker Compose', '/hosting/docker'],
        ['Railway', '/hosting/railway'],
        ['Domains & HTTPS', '/hosting/reverse-proxy'],
        ['Local & S3 storage', '/hosting/storage'],
        ['Configuration reference', '/hosting/configuration'],
        ['Backups & upgrades', '/hosting/maintenance'],
        ['Troubleshooting', '/hosting/troubleshooting'],
      ]),
      group('Administer', [
        ['Administration overview', '/admin/'],
        ['First-run setup', '/admin/setup'],
        ['Roles & permissions', '/admin/roles'],
        ['Manage accounts', '/admin/users'],
        ['Appearance studio', '/admin/appearance'],
        ['Account email', '/admin/email'],
        ['Single sign-on', '/admin/sso'],
      ]),
      group('Build integrations', [
        ['API overview', '/api/'],
        ['Authentication & scopes', '/api/authentication'],
        ['Files & chunked uploads', '/api/files'],
        ['Short-link API', '/api/short-links'],
        ['Webhooks', '/api/webhooks'],
        ['Recipes & examples', '/api/recipes'],
        ['Roles & session contracts', '/api/roles'],
        ['Endpoint inventory', '/api/endpoint-inventory'],
      ]),
      group('Project', [['Contribute to the docs', '/contributing']]),
    ],
  },
})

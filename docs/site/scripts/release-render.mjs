import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { readSource, repository } from './release-data.mjs'

const escapeAttribute = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

/** Render historical Markdown without evaluating Vue, scripts or event handlers. */
export function renderLegacyMarkdown(source, rewriteUrl = (url) => url) {
  const md = new MarkdownIt({ html: true, linkify: true })
  const slugs = new Map()
  md.core.ruler.push('release-heading-ids', (state) => {
    state.tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return
      const text = state.tokens[index + 1]?.content || ''
      const slug = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
        .replaceAll(' ', '-')
      const count = slugs.get(slug) || 0
      slugs.set(slug, count + 1)
      token.attrSet('id', `${slug}${count ? `-${count}` : ''}`)
    })
  })
  const html = sanitizeHtml(md.render(source), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'picture',
      'source',
      'details',
      'summary',
      'video',
    ],
    allowedAttributes: {
      '*': ['id'],
      a: ['href', 'title', 'name'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      source: ['src', 'type', 'media'],
      video: ['src', 'poster', 'controls', 'width'],
      code: ['class'],
      pre: ['tabindex'],
      div: ['align'],
      p: ['align'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      '*': (tagName, attributes) => {
        if (tagName === 'pre') attributes.tabindex = '0'
        for (const key of ['href', 'src', 'poster']) {
          if (attributes[key])
            attributes[key] = rewriteUrl(attributes[key], key !== 'href')
        }
        return { tagName, attribs: attributes }
      },
    },
  })
  // Keep a single Markdown HTML block: blank source lines inside <pre> would
  // otherwise make VitePress resume Markdown parsing halfway through the HTML.
  // Character references retain those line breaks in the rendered code blocks.
  // v-pre leaves all interpolation and directive-like text literal.
  return `<div v-pre class="release-original">${html.replaceAll('\r', '&#13;').replaceAll('\n', '&#10;')}</div>\n`
}

export async function prepareLegacy({ repo, site, release, base }) {
  const assets = new Map()
  const pages = new Map(release.pages.map((page) => [page.source, page.path]))
  for (const page of release.pages) {
    const content = readSource(repo, release.commit, page.source)
    function rewriteUrl(url, asset) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return url
      const parsed = url.match(/^([^?#]*)(.*)$/)
      let pathname
      try {
        pathname = decodeURIComponent(parsed[1])
      } catch {
        return url
      }
      const source = posix.normalize(
        pathname.startsWith('/')
          ? pathname.slice(1)
          : posix.join(posix.dirname(page.source), pathname)
      )
      if (source.startsWith('../'))
        return `https://github.com/${repository}/tree/${release.commit}`
      if (pages.has(source)) return `${base}${pages.get(source)}${parsed[2]}`
      if (
        asset &&
        /\.(?:png|jpe?g|webp|gif|avif|svg|ico|mp4|webm)$/i.test(source)
      ) {
        assets.set(source, `source-assets/${source}`)
        return `${base}source-assets/${source}${parsed[2]}`
      }
      return `https://github.com/${repository}/blob/${release.commit}/${source}${parsed[2]}`
    }
    const originalHtml = renderLegacyMarkdown(content, rewriteUrl)
    const heading = /<h1\b/i.test(originalHtml)
      ? ''
      : `<h1 v-pre>${escapeAttribute(page.source === 'README.md' ? `Flare ${release.tag}` : page.title)}</h1>\n\n`
    const output = resolve(site, page.path.replace(/\.html$/, '.md'))
    await mkdir(dirname(output), { recursive: true })
    await writeFile(
      output,
      `---\ntitle: ${JSON.stringify(page.title)}\noutline: false\n---\n\n` +
        heading +
        `<p class="release-legacy-note">Original documentation published with ${escapeAttribute(release.tag)} on ${release.publishedAt.slice(0, 10)}. This release predates the handbook. Commands and external services reflect that release.</p>\n\n` +
        originalHtml
    )
  }
  for (const [source, target] of assets) {
    const destination = resolve(site, 'public', target)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(
      destination,
      execFileSync('git', ['show', `${release.commit}:${source}`], {
        cwd: repo,
        maxBuffer: 32 * 1024 * 1024,
      })
    )
  }
}

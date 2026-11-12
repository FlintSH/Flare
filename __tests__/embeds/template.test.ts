import { describe, expect, it } from 'vitest'

import {
  type EmbedValues,
  isEmbedTemplate,
  renderTemplate,
} from '@/lib/embeds/template'

const values: EmbedValues = {
  filename: 'photo.png',
  size: '1.8 MB',
  type: 'PNG',
  uploader: 'Mira',
  date: 'Nov 12, 2026',
  views: '128',
  instanceName: 'Flare',
}
const render = (template: string, changed: Partial<EmbedValues> = {}) =>
  renderTemplate(template, { ...values, ...changed }, 500)

describe('embed templates', () => {
  it('accepts the listed placeholders and refuses anything else in braces', () => {
    for (const template of [
      '',
      'Plain text',
      '{{filename}} ({{size}})',
      '{{ type }} · {{date}} · {{views}} views',
      '{{uploader}} on {{instanceName}}',
    ])
      expect(isEmbedTemplate(template), template).toBe(true)
    for (const template of [
      '{{password}}',
      '{{user.email}}',
      '{{filename}',
      '{filename}',
      'a } b',
    ])
      expect(isEmbedTemplate(template), template).toBe(false)
  })

  it('fills each placeholder in', () => {
    expect(render('{{filename}} ({{size}})')).toBe('photo.png (1.8 MB)')
    expect(render('{{ type }} · {{date}} · {{views}} views')).toBe(
      'PNG · Nov 12, 2026 · 128 views'
    )
  })

  it('takes the punctuation around an empty field with it', () => {
    expect(render('{{filename}} ({{size}})', { size: '' })).toBe('photo.png')
    expect(render('{{type}} · {{size}} · {{views}} views', { size: '' })).toBe(
      'PNG · 128 views'
    )
    expect(render('{{uploader}} - {{date}}', { uploader: '' })).toBe(
      'Nov 12, 2026'
    )
    expect(render('{{filename}}, {{size}}, {{type}}', { size: '' })).toBe(
      'photo.png, PNG'
    )
  })

  it('leaves out a line with nothing left to show', () => {
    expect(render('Uploaded by {{uploader}}', { uploader: '' })).toBe('')
    expect(
      render('{{filename}}\nUploaded by {{uploader}}\n{{type}}', {
        uploader: '',
      })
    ).toBe('photo.png\nPNG')
  })

  it('never tidies inside a value, whatever punctuation it has', () => {
    const name = 'notes -- draft (v2) [final], , .txt'
    expect(
      render('{{filename}} ({{size}})', { filename: name, size: '' })
    ).toBe(name)
    expect(
      render('{{uploader}} · {{filename}}', { filename: name, uploader: '' })
    ).toBe(name)
    // A value made of separators is still a value, not something to trim.
    expect(
      render('{{filename}} - {{size}}', { filename: '---', size: '' })
    ).toBe('---')
  })

  it('stays fast when values are long and full of separators', () => {
    const template = Array.from({ length: 40 }, () => '{{filename}}').join(
      ' {{size}} '
    )
    const started = performance.now()
    const text = renderTemplate(
      template,
      { ...values, filename: `${'- '.repeat(120)}x`, size: '' },
      500
    )
    expect(performance.now() - started).toBeLessThan(50)
    expect(text).toHaveLength(500)
  })

  it('keeps text exactly as written when every field has a value', () => {
    expect(render('-- {{filename}} --')).toBe('-- photo.png --')
    expect(render('See https://example.com/{{filename}}')).toBe(
      'See https://example.com/photo.png'
    )
  })

  it('never builds more of a value than a line can show', () => {
    const started = performance.now()
    const text = renderTemplate(
      Array.from({ length: 40 }, () => '{{uploader}}').join(''),
      { ...values, uploader: 'n'.repeat(1_000_000) },
      100
    )
    expect(performance.now() - started).toBeLessThan(50)
    expect(text).toHaveLength(100)
  })

  it('cuts text that is longer than its limit', () => {
    const long = renderTemplate(
      '{{filename}}',
      {
        ...values,
        filename: 'a'.repeat(300),
      },
      20
    )
    expect(long).toHaveLength(20)
    expect(long.endsWith('…')).toBe(true)
  })
})

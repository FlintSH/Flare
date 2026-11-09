import { describe, expect, it } from 'vitest'

import { urlSafeFilename } from '@/lib/files/filename'
import {
  NAME_PLACEHOLDERS,
  NAME_TEMPLATE_MAX_LENGTH,
  liveNameSources,
  nameTemplateProblem,
  renderNameTemplate,
  sampleNameSources,
} from '@/lib/files/name-template'
import { NAME_WORDS } from '@/lib/files/name-words'

const sources = { ...sampleNameSources, name: 'team-photo' }
const render = (template: string) => renderNameTemplate(template, sources)

describe('name patterns', () => {
  it('fills every placeholder from the upload and its start time in UTC', () => {
    expect(render('{name}')).toBe('team-photo')
    expect(render('{random}')).toBe('x7Kp2a')
    expect(render('{random:10}')).toBe('x7Kp2aQ9mT')
    expect(render('{words}')).toBe('amber-otter-lantern')
    expect(render('{words:1}')).toBe('amber')
    expect(render('{date}')).toBe('2026-03-14')
    expect(render('{time}')).toBe('092653')
    expect(render('{year}{month}{day}-{hour}{minute}{second}')).toBe(
      '20260314-092653'
    )
    expect(render('{timestamp}')).toBe('1773480413')
    expect(NAME_PLACEHOLDERS).toEqual([
      '{name}',
      '{random}',
      '{words}',
      '{date}',
      '{time}',
      '{year}',
      '{month}',
      '{day}',
      '{hour}',
      '{minute}',
      '{second}',
      '{timestamp}',
    ])
  })

  it('keeps the letters, digits, hyphens and underscores written around placeholders', () => {
    expect(render('Shot_{date}-{random:4}')).toBe('Shot_2026-03-14-x7Kp')
    expect(render('latest')).toBe('latest')
    expect(render('{name}{name}')).toBe('team-phototeam-photo')
  })

  it('says what is wrong with a pattern it cannot use', () => {
    expect(nameTemplateProblem('{date}-{random}')).toBeNull()
    expect(nameTemplateProblem('')).toBe('Enter a name pattern.')
    expect(nameTemplateProblem('a'.repeat(NAME_TEMPLATE_MAX_LENGTH))).toBeNull()
    expect(nameTemplateProblem('a'.repeat(NAME_TEMPLATE_MAX_LENGTH + 1))).toBe(
      'Name patterns can be at most 100 characters.'
    )
    expect(nameTemplateProblem('{uuid}')).toBe(
      `{uuid} is not a placeholder. Use ${NAME_PLACEHOLDERS.join(', ')}.`
    )
    // Inherited object members are not placeholders.
    expect(nameTemplateProblem('{constructor}')).toMatch('is not a placeholder')
    expect(nameTemplateProblem('{Name}')).toMatch('is not a placeholder')
    expect(nameTemplateProblem('{}')).toMatch('is not a placeholder')
    expect(nameTemplateProblem('{date:2}')).toBe('{date} takes no option.')
    for (const written of [
      '{random:0}',
      '{random:33}',
      '{random:}',
      '{random:six}',
      '{random:1e1}',
      '{random:4:4}',
      '{random:0004}',
    ])
      expect(nameTemplateProblem(written)).toBe(
        '{random} takes a length from 1 to 32, such as {random:6}.'
      )
    expect(nameTemplateProblem('{words:7}')).toBe(
      '{words} takes a number of words from 1 to 6, such as {words:3}.'
    )
    for (const written of ['{name', 'name}', '{{name}}', '{na{me}'])
      expect(nameTemplateProblem(written)).toBe(
        'Write each placeholder between one { and one }.'
      )
    expect(nameTemplateProblem('{date}/{random}')).toBe(
      'Name patterns can use letters, digits, hyphens, underscores and placeholders. Remove “/”.'
    )
    expect(nameTemplateProblem('my shot')).toMatch('Remove the space.')
    for (const hidden of ['a\u0000b', 'a\tb', 'a\u202eb', 'a\u00a0b', 'a\nb'])
      expect(nameTemplateProblem(hidden)).toMatch(
        'Remove the invisible character.'
      )
    expect(nameTemplateProblem('shot.{random}')).toMatch('Remove “.”.')
    expect(nameTemplateProblem('..')).toMatch('Remove “.”.')
    expect(nameTemplateProblem('写真-{date}')).toMatch('Remove “写”.')
    expect(nameTemplateProblem('📸{date}')).toMatch('Remove “📸”.')
    expect(() => render('{uuid}')).toThrow('is not a placeholder')
  })

  it('reads a long pattern of broken placeholders in linear time', () => {
    const started = performance.now()
    for (let round = 0; round < 200; round++)
      nameTemplateProblem('{'.repeat(NAME_TEMPLATE_MAX_LENGTH))
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('draws real names from letters, digits and the word list', () => {
    const live = { ...liveNameSources(), name: 'x' }
    expect(renderNameTemplate('{random:32}', live)).toMatch(/^[A-Za-z0-9]{32}$/)
    const words = renderNameTemplate('{words:6}', live).split('-')
    expect(words).toHaveLength(6)
    for (const word of words) expect(NAME_WORDS).toContain(word)
    expect(renderNameTemplate('{random:32}', live)).not.toBe(
      renderNameTemplate('{random:32}', live)
    )
    expect(renderNameTemplate('{year}', live)).toBe(
      String(new Date().getUTCFullYear())
    )
  })

  it('has 256 distinct plain words, one for each value of a random byte', () => {
    expect(NAME_WORDS).toHaveLength(256)
    expect(new Set(NAME_WORDS).size).toBe(256)
    for (const word of NAME_WORDS) expect(word).toMatch(/^[a-z]{3,8}$/)
  })
})

describe('URL names from a pattern', () => {
  const named = (filename: string, template: string, randomize = false) =>
    urlSafeFilename(filename, { template, randomize }, sampleNameSources)

  it('adds the upload’s own extension after the pattern', () => {
    expect(named('Team Photo.PNG', 'shot-{date}-{random:4}')).toBe(
      'shot-2026-03-14-x7Kp.png'
    )
    expect(named('Team Photo.PNG', '{name}-{timestamp}')).toBe(
      'team-photo-1773480413.png'
    )
    expect(named('README', '{words:2}')).toBe('amber-otter')
    expect(named('archive.tar.gz', '{name}')).toBe('archive-tar.gz')
    expect(named('notes.h#ml', '{date}')).toBe('2026-03-14')
  })

  it('gives {name} random characters when the filename has nothing URL-safe', () => {
    expect(named('日本語.txt', '{date}-{name}')).toBe('2026-03-14-x7Kp2a.txt')
  })

  it('lets a pattern decide the name even when random names are also on', () => {
    expect(named('Team Photo.PNG', 'latest', true)).toBe('latest.png')
  })

  it('cuts a long name so the stored filename fits with its extension', () => {
    const long = named(`${'a'.repeat(250)}.png`, '{name}{name}')
    expect(long).toBe(`${'a'.repeat(200)}.png`)
  })

  it('keeps original and random naming as they were without a pattern', () => {
    expect(urlSafeFilename('My Report.PDF')).toBe('my-report.pdf')
    expect(urlSafeFilename('My Report.PDF', { template: null })).toBe(
      'my-report.pdf'
    )
    expect(urlSafeFilename('My Report.PDF', { randomize: true })).toMatch(
      /^[A-Za-z0-9_-]{6}\.pdf$/
    )
  })
})

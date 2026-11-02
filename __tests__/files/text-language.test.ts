import { describe, expect, it } from 'vitest'

import { getLanguageExtension } from '@/components/file/protected/language-utils'

import { languageFromFilename } from '@/lib/files/text-language'

describe('languageFromFilename', () => {
  it('names the grammar for a paste from its extension', () => {
    expect(languageFromFilename('csv_to_json.py')).toBe('python')
    expect(languageFromFilename('notes.MD')).toBe('markdown')
    expect(languageFromFilename('component.tsx')).toBe('tsx')
    expect(languageFromFilename('config.yml')).toBe('yaml')
  })

  it('leaves prose, logs and unknown extensions as plain text', () => {
    expect(languageFromFilename('server-2026-10-30.log')).toBe('text')
    expect(languageFromFilename('README')).toBe('text')
    expect(languageFromFilename('archive.tar.unknown')).toBe('text')
  })

  it('reads the last extension', () => {
    expect(languageFromFilename('report.final.py')).toBe('python')
  })

  // The share page passes the result to a client component, so anything but
  // a string (such as Object's constructor) would stop the page rendering.
  it('treats extensions named like Object members as plain text', () => {
    for (const name of [
      'notes.constructor',
      'notes.__proto__',
      'notes.toString',
      'notes.hasOwnProperty',
      'notes.valueOf',
    ])
      expect(languageFromFilename(name), name).toBe('text')
  })

  it('only names languages that have a grammar', () => {
    for (const name of [
      'a.html',
      'a.css',
      'a.js',
      'a.jsx',
      'a.ts',
      'a.json',
      'a.py',
      'a.md',
      'a.yaml',
      'a.java',
      'a.sql',
      'a.xml',
      'a.wat',
      'a.c',
      'a.cpp',
      'a.rs',
      'a.php',
      'a.go',
      'a.sass',
      'a.scss',
      'a.less',
    ]) {
      const language = languageFromFilename(name)
      expect(language, name).not.toBe('text')
      expect(getLanguageExtension(language), name).not.toEqual([])
    }
  })
})

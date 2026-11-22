import { describe, expect, it } from 'vitest'

import { LANGUAGES, languageFromFilename } from '@/lib/files/file-kind'
import {
  DEFAULT_PASTE_NAME,
  pasteLanguage,
  pasteName,
  renameForLanguage,
} from '@/lib/files/paste-name'

describe('a paste’s name', () => {
  it('is paste.txt when left empty or blank', () => {
    expect(pasteName('')).toBe(DEFAULT_PASTE_NAME)
    expect(pasteName('   ')).toBe('paste.txt')
    expect(pasteLanguage('')).toBe('text')
  })

  it('takes its language from the extension, as the share page does', () => {
    expect(pasteLanguage('deploy.ts')).toBe('typescript')
    expect(pasteLanguage('NOTES.MD')).toBe('markdown')
    expect(pasteLanguage('run.sh')).toBe('shell')
    expect(pasteLanguage('run.rb')).toBe('text')
  })

  it.each([
    ['', 'python', 'paste.py'],
    ['notes', 'python', 'notes.py'],
    ['notes.md', 'python', 'notes.py'],
    ['notes.txt', 'markdown', 'notes.md'],
    ['deploy.ts', 'text', 'deploy.txt'],
    ['report.final', 'go', 'report.final.go'],
    ['.md', 'json', 'paste.json'],
    ['  config.yaml ', 'json', 'config.json'],
  ] as const)('%j in %s becomes %j', (typed, language, expected) => {
    expect(renameForLanguage(typed, language)).toBe(expected)
  })

  it('names every language with an extension that reads back as it', () => {
    for (const language of LANGUAGES)
      expect(languageFromFilename(renameForLanguage('a', language))).toBe(
        language
      )
  })
})

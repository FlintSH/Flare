import { useLayoutEffect, useMemo, useRef } from 'react'

import CodeMirror, {
  EditorView,
  type Extension,
  Prec,
  keymap,
} from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'

import {
  NO_GRAMMAR,
  useCodeGrammar,
} from '@/components/file/viewer/components/code-grammar'
import { codeViewerTheme } from '@/components/file/viewer/components/code-theme'

import type { Language } from '@/lib/files/file-kind'

/** How tall the editor starts, and the most it grows before it scrolls. */
const EDITOR_SIZE = EditorView.theme({
  // CodeMirror's way to a minimum height: the gutter runs the full height.
  '.cm-content, .cm-gutter': { minHeight: '18rem' },
  '.cm-content': { caretColor: 'hsl(var(--foreground))' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--foreground))' },
  '.cm-placeholder': { color: 'hsl(var(--muted-foreground))' },
  '@media (max-width: 639px)': {
    '.cm-content, .cm-gutter': { minHeight: '14rem' },
  },
})

/**
 * The paste's text, in the share page's own code view so it looks as it
 * will to recipients. Tab indents; Escape then Tab leaves, as in every
 * CodeMirror editor.
 */
export function PasteEditor({
  value,
  onChange,
  language,
  onSubmit,
  disabled,
  describedBy,
}: {
  value: string
  onChange: (value: string) => void
  language: Language
  /** Ctrl/⌘+Enter. */
  onSubmit: () => void
  disabled?: boolean
  describedBy: string
}) {
  const submit = useRef(onSubmit)
  useLayoutEffect(() => {
    submit.current = onSubmit
  })
  const grammar = useCodeGrammar(language)
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const extensions = useMemo(
    (): Extension[] => [
      // Typing never waits for a grammar; colours arrive when it does.
      grammar ?? NO_GRAMMAR,
      codeViewerTheme(dark),
      EDITOR_SIZE,
      // Ahead of the default keymap, which inserts a blank line on Mod-Enter.
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              submit.current()
              return true
            },
          },
        ])
      ),
      EditorView.contentAttributes.of({
        'aria-label': 'Paste content',
        'aria-describedby': describedBy,
      }),
      ...(language === 'markdown' ? [EditorView.lineWrapping] : []),
    ],
    [grammar, dark, describedBy, language]
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      editable={!disabled}
      readOnly={disabled}
      theme="none"
      placeholder="Paste or type here"
      // People arrive to paste; a phone's keyboard waits for a tap.
      autoFocus={window.matchMedia('(pointer: fine)').matches}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
      className="font-mono text-[13px] sm:text-sm"
    />
  )
}

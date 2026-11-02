import {
  EditorView,
  type Extension,
  ViewPlugin,
  type ViewUpdate,
  oneDark,
  color as oneDarkColor,
  oneDarkHighlightStyle,
} from '@uiw/react-codemirror'

/** The height of one line, in pixels. */
const LINE_HEIGHT = 20
/** The space above the first line and below the last, in pixels. */
const EDGE = 12

/**
 * CodeMirror's frame in Flare's colours: no background of its own, a tinted
 * gutter with a hairline edge, secondary-text line numbers and an accent
 * selection. Lines keep clear of the card's edge. A file that fits shows
 * whole; a longer one shows the top of its next line under the bottom fade.
 */
function frame(dark: boolean) {
  // The gutter's tint over the card, which its fade blends toward.
  const gutterTint = `hsl(var(--muted) / ${dark ? 0.3 : 0.7})`
  return EditorView.theme(
    {
      '&': {
        color: 'hsl(var(--foreground))',
        backgroundColor: 'transparent',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: `${LINE_HEIGHT}px`,
        // Room for whole lines plus both paddings, so a file that fits doesn't
        // scroll by its padding alone.
        maxHeight: `calc(round(nearest, 60vh - ${2 * EDGE}px, ${LINE_HEIGHT}px) + ${2 * EDGE}px)`,
      },
      // Browsers without CSS round() use this height.
      '@supports not (height: round(nearest, 1px, 1px))': {
        '.cm-scroller': { maxHeight: '60vh' },
      },
      '.cm-content': { padding: `${EDGE}px 0` },
      '.cm-line': { padding: '0 1rem 0 0.75rem' },
      // Opaque, so code scrolled sideways doesn't show through the numbers.
      '.cm-gutters': {
        backgroundColor: 'hsl(var(--card))',
        // Light needs a stronger tint to show at all on the white card.
        backgroundImage: `linear-gradient(${gutterTint}, ${gutterTint})`,
        borderRight: '1px solid hsl(var(--border) / 0.6)',
        color: 'hsl(var(--muted-foreground))',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 0.75rem' },
      // Phones keep the gutter narrow so lines aren't shortened: no fold
      // column (folding is a pointer convenience) and tighter padding.
      // (CodeMirror shows every gutter with `display: flex !important`.)
      '@media (max-width: 639px)': {
        '.cm-gutters .cm-foldGutter': { display: 'none !important' },
        '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.375rem 0 0.5rem' },
        '.cm-line': { padding: '0 0.75rem 0 0.5rem' },
      },
      // Fold markers stay out of the way until the pointer is over the
      // gutter; a folded line always shows its marker.
      '.cm-foldGutter .cm-gutterElement': {
        padding: '0 0.375rem 0 0',
        cursor: 'pointer',
      },
      '.cm-foldGutter .cm-gutterElement:hover': {
        color: 'hsl(var(--foreground))',
      },
      '@media (hover: hover)': {
        '.cm-foldGutter .cm-gutterElement span[title="Fold line"]': {
          opacity: '0',
          transition: 'opacity 120ms',
        },
        '.cm-gutters:hover .cm-foldGutter .cm-gutterElement span[title="Fold line"]':
          { opacity: '1' },
      },
      '.cm-foldPlaceholder': {
        margin: '0 0.25rem',
        padding: '0 0.375rem',
        border: '1px solid hsl(var(--border))',
        borderRadius: '0.375rem',
        backgroundColor: 'hsl(var(--muted) / 0.5)',
        color: 'hsl(var(--muted-foreground))',
      },
      '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        { backgroundColor: 'hsl(var(--primary) / 0.2)' },
      '.cm-selectionMatch': { backgroundColor: 'hsl(var(--primary) / 0.12)' },
      '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: 'hsl(var(--primary) / 0.15)',
        outline: 'none',
      },
      '.cm-edgeFade': {
        position: 'absolute',
        top: '0',
        width: '1.5rem',
        pointerEvents: 'none',
        background: 'linear-gradient(to left, hsl(var(--card)), transparent)',
      },
      // As tall as the visible top of the next line, so whole lines above
      // it keep full strength.
      '.cm-bottomFade': {
        position: 'absolute',
        left: '0',
        height: `${EDGE}px`,
        pointerEvents: 'none',
        background: 'linear-gradient(to top, hsl(var(--card)), transparent)',
      },
      // The same fade over the line numbers, toward the gutter's own colour,
      // stopping short of its rule so the rule stays solid.
      '.cm-gutterFade': {
        position: 'absolute',
        left: '0',
        height: `${EDGE}px`,
        pointerEvents: 'none',
        background: `linear-gradient(to top, ${gutterTint}, transparent), linear-gradient(to top, hsl(var(--card)), transparent)`,
      },
    },
    { dark }
  )
}

/**
 * Fades the right edge while lines continue past it, and the bottom edge
 * while more lines follow, so scrolling is discoverable where scrollbars
 * stay hidden, as on phones (and in every browser, unlike scroll-driven
 * CSS).
 */
const edgeFade = ViewPlugin.fromClass(
  class {
    side = document.createElement('div')
    bottom = document.createElement('div')
    gutter = document.createElement('div')

    constructor(readonly view: EditorView) {
      this.side.className = 'cm-edgeFade'
      this.bottom.className = 'cm-bottomFade'
      this.gutter.className = 'cm-gutterFade'
      for (const fade of [this.side, this.bottom, this.gutter]) {
        fade.hidden = true
        fade.setAttribute('aria-hidden', 'true')
        view.dom.appendChild(fade)
      }
      view.scrollDOM.addEventListener('scroll', this.measure, { passive: true })
      this.measure()
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged) this.measure()
    }

    measure = () =>
      this.view.requestMeasure({
        key: this,
        read: ({ scrollDOM: scroller }) => ({
          sideHidden:
            scroller.scrollLeft + scroller.clientWidth >=
            scroller.scrollWidth - 1,
          bottomHidden:
            scroller.scrollTop + scroller.clientHeight >=
            scroller.scrollHeight - 1,
          // Keep clear of the scrollbars, and of the gutter so its rule
          // stays solid.
          right: scroller.offsetWidth - scroller.clientWidth,
          below: scroller.offsetHeight - scroller.clientHeight,
          gutter:
            scroller.querySelector<HTMLElement>('.cm-gutters')?.offsetWidth ??
            0,
        }),
        write: ({ sideHidden, bottomHidden, right, below, gutter }) => {
          this.side.hidden = sideHidden
          this.side.style.right = `${right}px`
          this.side.style.bottom = `${below}px`
          this.bottom.hidden = bottomHidden
          this.bottom.style.left = `${gutter}px`
          this.bottom.style.right = `${right}px`
          this.bottom.style.bottom = `${below}px`
          this.gutter.hidden = bottomHidden || gutter === 0
          this.gutter.style.width = `${Math.max(gutter - 1, 0)}px`
          this.gutter.style.bottom = `${below}px`
        },
      })

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.measure)
      this.side.remove()
      this.bottom.remove()
      this.gutter.remove()
    }
  }
)

// One Dark's highlighter tags tokens in both themes, so they always carry its
// classes; `syntax` recolours those classes. (`oneDark` is One Dark's editor
// theme followed by this highlighter.)
const highlighter = (oneDark as readonly Extension[])[1]

/**
 * Light-mode colours for One Dark's roles. They share one lightness and a
 * moderate chroma, reach at least 5:1 on the card and the muted fill, and
 * leave names and properties in the text colour so code stays calm.
 */
const LIGHT_SYNTAX: Record<string, string> = {
  [oneDarkColor.violet]: '#98397e', // keywords
  [oneDarkColor.coral]: 'inherit', // names, properties and headings
  [oneDarkColor.malibu]: '#2863ab', // functions
  [oneDarkColor.whiskey]: '#9e511e', // constants, atoms and booleans
  [oneDarkColor.chalky]: '#017272', // types, classes and numbers
  [oneDarkColor.cyan]: 'hsl(var(--muted-foreground))', // operators, URLs
  [oneDarkColor.sage]: '#2f7434', // strings and Markdown marks
  [oneDarkColor.invalid]: 'hsl(var(--danger))',
}

/**
 * In both themes One Dark's own greys give way to Flare's text colours: plain
 * text, definitions and punctuation use the foreground, and comments and
 * links the secondary text colour. Dark mode keeps One Dark's other colours.
 */
function syntax(dark: boolean) {
  const rules: Record<string, { color: string }> = {}
  for (const spec of oneDarkHighlightStyle.specs) {
    const tag = [spec.tag].flat()[0]
    const className = tag && oneDarkHighlightStyle.style([tag])
    // Names, keys and properties (One Dark's coral) stay in the text colour
    // in both themes, so they don't read as errors. Markdown headings take
    // the keyword colour instead, so they still stand apart from bold text.
    const heading =
      spec.fontWeight === 'bold' && spec.color === oneDarkColor.coral
    const color = heading
      ? dark
        ? oneDarkColor.violet
        : LIGHT_SYNTAX[oneDarkColor.violet]
      : spec.color === oneDarkColor.ivory || spec.color === oneDarkColor.coral
        ? 'inherit'
        : spec.color === oneDarkColor.stone
          ? 'hsl(var(--muted-foreground))'
          : dark
            ? undefined
            : LIGHT_SYNTAX[spec.color]
    if (className && color) rules[`.${className}`] = { color }
  }
  return EditorView.theme(rules)
}

const LIGHT = [highlighter, frame(false), syntax(false), edgeFade]
const DARK = [highlighter, frame(true), syntax(true), edgeFade]

/** Flare's look for the read-only text and code viewer. */
export function codeViewerTheme(dark: boolean): Extension {
  return dark ? DARK : LIGHT
}

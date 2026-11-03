/**
 * Ref callback for scrolling lists styled with `.scroll-fade`: marks the
 * element with `data-scroll-above` / `data-scroll-below` while there is more
 * to scroll that way, and the stylesheet fades that edge. Measured rather
 * than scroll-driven CSS, so it works in every browser and in screenshots.
 */
export function scrollFadeRef(element: HTMLElement | null) {
  if (!element) return
  const update = () => {
    const { scrollTop, scrollHeight, clientHeight } = element
    element.toggleAttribute('data-scroll-above', scrollTop > 1)
    element.toggleAttribute(
      'data-scroll-below',
      scrollTop + clientHeight < scrollHeight - 1
    )
  }
  update()
  element.addEventListener('scroll', update, { passive: true })
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
  resize?.observe(element)
  // Lists that fill in later (search results, loading) change height too.
  const content =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(update)
  content?.observe(element, { childList: true, subtree: true })
  return () => {
    element.removeEventListener('scroll', update)
    resize?.disconnect()
    content?.disconnect()
  }
}

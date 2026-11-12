import type { AppearanceDocument } from './schema'

/**
 * Whether share pages show the footer: the appearance's own choice, or the
 * instance's credits footer when the appearance inherits it. Shared folders,
 * file password pages and the not-found page follow share pages.
 */
export function showsShareFooter(
  appearance: AppearanceDocument,
  creditsFooter: boolean
): boolean {
  return appearance.sharing.showFooter ?? creditsFooter
}

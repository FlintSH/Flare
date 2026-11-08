import { describe, expect, it } from 'vitest'

import {
  canConfirmDraftTraversal,
  leavesDraftPage,
} from '@/lib/navigation/draft-leave'

const current = 'https://flare.example/dashboard/settings?section=appearance'

describe('local draft navigation boundaries', () => {
  it('warns for another dashboard page, including relative and base-path URLs', () => {
    expect(leavesDraftPage(current, '/dashboard')).toBe(true)
    expect(leavesDraftPage(current, 'roles')).toBe(true)
    expect(
      leavesDraftPage(
        'https://flare.example/flare/dashboard/settings',
        '/flare/dashboard/profile'
      )
    ).toBe(true)
  })

  it('keeps same-page sections and anchors inside their existing local editor', () => {
    for (const destination of [
      '?section=email',
      '#advanced-styles',
      '/dashboard/settings',
      '/dashboard/settings?section=general#ocr',
    ])
      expect(leavesDraftPage(current, destination)).toBe(false)
  })

  it('leaves document/external/invalid destinations to their original handler', () => {
    for (const destination of [
      'https://docs.example/guide',
      'mailto:help@example.test',
      'http://[invalid',
    ])
      expect(leavesDraftPage(current, destination)).toBe(false)
  })

  it('only guards a cancelable, unhandled, same-document traversal to another page', () => {
    const event = {
      cancelable: true,
      defaultPrevented: false,
      navigationType: 'traverse',
      destination: {
        sameDocument: true,
        url: 'https://flare.example/dashboard',
      },
    }
    expect(canConfirmDraftTraversal(event, current)).toBe(true)
    expect(
      canConfirmDraftTraversal({ ...event, cancelable: false }, current)
    ).toBe(false)
    expect(
      canConfirmDraftTraversal({ ...event, defaultPrevented: true }, current)
    ).toBe(false)
    for (const navigationType of ['push', 'replace', 'reload', undefined])
      expect(
        canConfirmDraftTraversal({ ...event, navigationType }, current)
      ).toBe(false)
    expect(
      canConfirmDraftTraversal(
        {
          ...event,
          destination: { ...event.destination, sameDocument: false },
        },
        current
      )
    ).toBe(false)
    expect(
      canConfirmDraftTraversal(
        {
          ...event,
          destination: { sameDocument: true, url: '?section=general' },
        },
        current
      )
    ).toBe(false)
    expect(
      canConfirmDraftTraversal({ ...event, destination: undefined }, current)
    ).toBe(false)
  })
})

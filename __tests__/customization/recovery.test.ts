import { describe, expect, it } from 'vitest'

import {
  RECOVERY_HEADER,
  recoveryRequestHeaders,
} from '@/lib/customization/recovery-request'

describe('appearance recovery request boundary', () => {
  it('strips caller-supplied markers for public, user and ordinary admin requests', () => {
    const headers = new Headers({ [RECOVERY_HEADER]: '1', Accept: 'text/html' })
    for (const [path, requested, admin] of [
      ['/someone/photo.png', true, true],
      ['/dashboard/customize', true, false],
      ['/dashboard/customize', false, true],
      ['/api/customization', true, true],
    ] as const) {
      const result = recoveryRequestHeaders(headers, path, requested, admin)
      expect(result.has(RECOVERY_HEADER)).toBe(false)
      expect(result.get('Accept')).toBe('text/html')
    }
  })

  it('enables recovery only for explicitly requested administrator recovery pages', () => {
    for (const path of ['/dashboard/customize', '/dashboard/settings']) {
      expect(
        recoveryRequestHeaders(new Headers(), path, true, true).get(
          RECOVERY_HEADER
        )
      ).toBe('1')
    }
  })
})

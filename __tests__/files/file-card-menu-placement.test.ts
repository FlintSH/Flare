import { describe, expect, it } from 'vitest'

import { fileCardMenuSide } from '@/components/dashboard/file-card/layout'

describe('shared file menu room', () => {
  it('keeps compact phones vertical at ordinary and enlarged text sizes', () => {
    for (const width of [320, 390, 639])
      for (const root of [16, 32])
        expect(fileCardMenuSide(width, root)).toBe('bottom')
  })
  it('uses tablet horizontal room only while the whole nominal menu fits', () => {
    expect(fileCardMenuSide(640, 16)).toBe('left')
    expect(fileCardMenuSide(820, 16)).toBe('left')
    expect(fileCardMenuSide(820, 32)).toBe('bottom')
    expect(fileCardMenuSide(820, 16)).toBe('left')
  })
  it('includes offset and collision clearance at the enlarged-text boundary', () => {
    // A448px menu plus20px clearance needs468px on either side of44px.
    expect(fileCardMenuSide(979, 32)).toBe('bottom')
    expect(fileCardMenuSide(980, 32)).toBe('left')
  })
  it('retains lateral menus on wide screens and a safe unmeasured initial view', () => {
    expect(fileCardMenuSide(1440, 16)).toBe('left')
    expect(fileCardMenuSide(1440, 32)).toBe('left')
    expect(fileCardMenuSide(0, 16)).toBe('bottom')
  })
})

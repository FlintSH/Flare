import { describe, expect, it } from 'vitest'

import {
  fileSheetHref,
  linkSheetHref,
  setSheetOrder,
  sheetNeighbor,
} from '@/lib/client/file-sheet'

const at = (pathname: string, search = '') => ({ pathname, search })

describe('sheet addresses', () => {
  it('opens a file sheet on the current page, keeping its query', () => {
    expect(fileSheetHref(at('/dashboard', '?folder=f1&search=cat'), 'x1')).toBe(
      '/dashboard?folder=f1&search=cat&file=x1'
    )
  })

  it('opens one sheet at a time', () => {
    expect(linkSheetHref(at('/dashboard/urls', '?file=x1'), 'l1')).toBe(
      '/dashboard/urls?link=l1'
    )
    expect(fileSheetHref(at('/dashboard/urls', '?link=l1'), 'x2')).toBe(
      '/dashboard/urls?file=x2'
    )
  })

  it('closes either sheet, leaving the rest of the address', () => {
    expect(fileSheetHref(at('/dashboard', '?search=cat&file=x1'), null)).toBe(
      '/dashboard?search=cat'
    )
    expect(fileSheetHref(at('/dashboard/urls', '?link=l1'), null)).toBe(
      '/dashboard/urls'
    )
  })
})

describe('sheetNeighbor', () => {
  it('steps through the library’s order and stops at its ends', () => {
    setSheetOrder(['a', 'b', 'c'])
    expect(sheetNeighbor('b', 1)).toBe('c')
    expect(sheetNeighbor('b', -1)).toBe('a')
    expect(sheetNeighbor('c', 1)).toBeNull()
    expect(sheetNeighbor('a', -1)).toBeNull()
  })

  it('has nothing beside a file the library isn’t showing', () => {
    setSheetOrder(['a'])
    expect(sheetNeighbor('z', 1)).toBeNull()
    setSheetOrder([])
    expect(sheetNeighbor('a', 1)).toBeNull()
  })
})

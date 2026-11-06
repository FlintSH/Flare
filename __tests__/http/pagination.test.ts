import { describe, expect, it } from 'vitest'

import { pageWindow } from '@/lib/http/pagination'

const sizes = { defaultLimit: 25, maxLimit: 100 }
/** As a route reads `?page=…&limit=…`; a missing value is null. */
const asked = (page: string | null, limit: string | null) => ({
  page: Number(page),
  limit: Number(limit),
})

describe('list pages', () => {
  it('sends the page and limit asked for, and the rows before it', () => {
    expect(pageWindow(260, asked('2', '50'), sizes)).toEqual({
      page: 2,
      pages: 6,
      limit: 50,
      skip: 50,
    })
  })

  it.each([
    [null, null],
    ['', ''],
    ['0', '0'],
    ['-2', '-5'],
    ['1.5', '2.5'],
    ['abc', 'xyz'],
    ['NaN', 'Infinity'],
    ['9007199254740993', '9007199254740993'],
  ])(
    'uses page 1 and the default limit for page %j and limit %j',
    (page, limit) => {
      expect(pageWindow(260, asked(page, limit), sizes)).toEqual({
        page: 1,
        pages: 11,
        limit: 25,
        skip: 0,
      })
    }
  )

  it('caps the limit at the maximum and the page at the last one', () => {
    expect(pageWindow(250, asked('9', '1000'), sizes)).toEqual({
      page: 3,
      pages: 3,
      limit: 100,
      skip: 200,
    })
    expect(
      pageWindow(26, asked('9007199254740991', '25'), sizes)
    ).toMatchObject({ page: 2, skip: 25 })
  })

  it('answers an empty list with page 1 of 0', () => {
    expect(pageWindow(0, asked('4', '10'), sizes)).toEqual({
      page: 1,
      pages: 0,
      limit: 10,
      skip: 0,
    })
  })

  it('keeps each list its own sizes', () => {
    expect(
      pageWindow(30, asked(null, null), { defaultLimit: 10, maxLimit: 100 })
    ).toMatchObject({ limit: 10, pages: 3 })
  })
})

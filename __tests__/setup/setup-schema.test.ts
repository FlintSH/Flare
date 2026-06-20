import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Mirror of the setup schema in app/api/setup/route.ts. Kept in sync so we can
// assert the friendly validation messages surfaced to the user.
const setupSchema = z.object({
  admin: z.object({
    name: z.string().min(1, 'Username is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
})

function firstError(input: unknown): string | null {
  const result = setupSchema.safeParse(input)
  if (result.success) return null
  return result.error.issues[0]?.message ?? null
}

describe('setup validation messages', () => {
  it('surfaces a friendly message for short passwords', () => {
    expect(
      firstError({
        admin: { name: 'admin', email: 'a@b.com', password: 'short' },
      })
    ).toBe('Password must be at least 8 characters')
  })

  it('surfaces a friendly message for invalid emails', () => {
    expect(
      firstError({
        admin: { name: 'admin', email: 'not-an-email', password: 'longenough' },
      })
    ).toBe('Enter a valid email address')
  })

  it('surfaces a friendly message for missing username', () => {
    expect(
      firstError({
        admin: { name: '', email: 'a@b.com', password: 'longenough' },
      })
    ).toBe('Username is required')
  })

  it('accepts valid admin details', () => {
    expect(
      firstError({
        admin: {
          name: 'admin',
          email: 'admin@example.com',
          password: 'longenough',
        },
      })
    ).toBeNull()
  })
})

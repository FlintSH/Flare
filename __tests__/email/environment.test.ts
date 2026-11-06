import { describe, expect, it } from 'vitest'

import defaults from '@/lib/email/defaults.json'
import { emailOverrides } from '@/lib/email/environment'
import { emailConfigSchema } from '@/lib/email/schema'

const names = (config: Record<string, unknown>) =>
  emailOverrides(config)
    .map(({ name }) => name)
    .sort()

describe('email environment overrides', () => {
  // The documentation coverage check can only read defaults.json; the app
  // reads the parsed settings.
  it('lists the same variables for defaults.json as for parsed settings', () => {
    expect(names(defaults)).toEqual(names(emailConfigSchema.parse({})))
  })
})

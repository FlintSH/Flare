import { describe, expect, it } from 'vitest'

import { auditQuerySchema } from '@/lib/audit/query'
import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { customizationSchema } from '@/lib/customization/schema'
import { uploadRequestOptionsSchema } from '@/lib/uploads/schema'
import { isoDateTimeWithOffset } from '@/lib/utils/iso-datetime'

describe('schema behavior kept across the Zod 4 upgrade', () => {
  it('accepts the ISO timestamps older API clients send', () => {
    for (const value of [
      '2026-10-24T22:08:27Z',
      '2026-10-24T22:08:27.123Z',
      '2026-10-24T22:08:27+02:00',
      '2026-10-24T22:08:27+0200',
      '2026-10-24T22:08:27.5-0730',
      '2026-10-24T22:08+02:00',
      '2026-10-24T22:08+0200',
      '2026-10-24T22:08:27-2359',
      '2028-02-29T00:00Z',
    ]) {
      expect(isoDateTimeWithOffset.safeParse(value).success, value).toBe(true)
      // Accepted values must convert to real dates before they reach a query.
      expect(Number.isNaN(Date.parse(value)), value).toBe(false)
    }
    for (const value of [
      '2026-10-24T22:08:27',
      '2026-10-24',
      '2026-02-29T00:00:00Z',
      '2026-10-24T24:00:00Z',
      '2026-10-24T22:08:27+02',
      '2026-10-24T22:08:27+24:00',
      '2026-10-24T22:08:27+02:60',
      '2026-10-24T22:08:27-2400',
    ])
      expect(isoDateTimeWithOffset.safeParse(value).success, value).toBe(false)
    expect(
      auditQuerySchema.safeParse({ from: '2026-10-24T22:08:27+24:00' }).success
    ).toBe(false)

    expect(
      uploadRequestOptionsSchema.parse({
        expiresAt: '2026-10-24T22:08:27+0200',
      })
    ).toEqual({ expiresAt: '2026-10-24T22:08:27+0200' })
    expect(
      auditQuerySchema.parse({
        from: '2026-10-24T08:00+0200',
        to: '2026-10-24T22:08:27Z',
      })
    ).toMatchObject({ from: '2026-10-24T08:00+0200', page: 1, limit: 50 })
  })

  it('fills nested defaults for settings sections older configs lack', () => {
    const legacy = structuredClone(DEFAULT_CONFIG)
    const settings = legacy.settings as Partial<typeof legacy.settings>
    delete settings.customization
    const general = legacy.settings.general as Partial<
      typeof legacy.settings.general
    >
    delete general.oidc
    delete (
      legacy.settings.general.registrations as Partial<
        typeof legacy.settings.general.registrations
      >
    ).inviteLimits

    const upgraded = configSchema.parse(legacy)
    expect(upgraded.settings.customization).toEqual(
      DEFAULT_CONFIG.settings.customization
    )
    expect(upgraded.settings.general.oidc).toEqual(
      DEFAULT_CONFIG.settings.general.oidc
    )
    expect(upgraded.settings.general.registrations.inviteLimits).toEqual({
      activeInvites: 5,
      usesPerInvite: 1,
      lifetimeDays: 30,
    })
  })

  it('gives each parse its own default appearance', () => {
    const first = customizationSchema.parse({})
    first.published.brand.name = 'Changed'
    expect(customizationSchema.parse({}).published.brand.name).not.toBe(
      'Changed'
    )
  })
})

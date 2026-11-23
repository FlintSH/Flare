import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ALL_PLACES, matchPlaces, placesFor } from '@/lib/navigation/places'
import type { Permission } from '@/lib/permissions/catalog'

const user = (...permissions: Permission[]) => ({ id: 'u', permissions })
const member = user(
  'files.read',
  'files.upload',
  'files.share',
  'pastes.create',
  'links.read',
  'links.create',
  'tokens.manage',
  'profile.update'
)
const admin = user(
  ...member.permissions,
  'settings.read',
  'settings.security',
  'users.read'
)
const ids = (places: { id: string }[]) => places.map((place) => place.id)

describe('placesFor', () => {
  it('offers only what the role can open', () => {
    const places = ids(placesFor(member, { agents: true }))
    expect(places).toContain('api-tokens')
    expect(places).not.toContain('settings')
    expect(places).not.toContain('users')
    expect(places).not.toContain('webhooks')
  })

  it('hides a feature the instance switched off from people who can’t switch it on', () => {
    expect(ids(placesFor(member, { agents: false }))).not.toContain('agents')
  })

  it('points administrators at the switch for a feature that is off', () => {
    const agents = placesFor(admin, { agents: false }).find(
      ({ id }) => id === 'agents'
    )
    expect(agents).toMatchObject({
      off: 'Settings › Access',
      href: '/dashboard/settings?section=access#mcp-server',
    })
  })

  it('sends people who manage every invite to Users, others to their own', () => {
    expect(ids(placesFor(user('invites.create'), { agents: true }))).toEqual(
      expect.arrayContaining(['my-invites'])
    )
    const manager = ids(
      placesFor(user('invites.create', 'invites.manage'), { agents: true })
    )
    expect(manager).toContain('invites')
    expect(manager).not.toContain('my-invites')
  })
})

describe('matchPlaces', () => {
  const places = placesFor(admin, { agents: true })

  it('finds settings by the words people use', () => {
    expect(ids(matchPlaces(places, 'sharex'))).toEqual(['screenshot-tools'])
    expect(ids(matchPlaces(places, '2fa'))).toEqual(['sign-in-security'])
    expect(ids(matchPlaces(places, 'vanity'))[0]).toBe('upload-defaults')
  })

  it('ranks a title that starts with the words first', () => {
    expect(ids(matchPlaces(places, 'set'))[0]).toBe('settings')
  })

  it('ignores case and accents', () => {
    expect(ids(matchPlaces(places, 'ÉMAIL'))).toContain('email')
  })
})

describe('every place lands somewhere', () => {
  // Each anchor Find links to is an element id some component renders.
  const sources: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.tsx')) sources.push(readFileSync(path, 'utf8'))
    }
  }
  walk(join(__dirname, '../../components'))
  const source = sources.join('\n')

  it.each(
    ALL_PLACES.filter(({ href }) => href.includes('#')).map(({ id, href }) => [
      id,
      href.split('#')[1],
    ])
  )('%s → #%s', (_id, anchor) => {
    expect(source).toMatch(
      new RegExp(`id=(?:"${anchor}"|\\{embedded \\? '${anchor}')`)
    )
  })
})
